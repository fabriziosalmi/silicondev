import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2, WifiOff, Wifi } from 'lucide-react'
import { apiClient } from '../../api/client'
import { MessageFeed } from './MessageFeed'
import { InputBar } from './InputBar'
import type { FeedItem, SSEEvent } from './types'

const STORAGE_KEY_FEED = 'nanocore-terminal-feed'

function loadPersistedFeed(): FeedItem[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_FEED)
    if (!raw) return []
    return JSON.parse(raw) as FeedItem[]
  } catch {
    return []
  }
}

export function AgentTerminal() {
  const { t } = useTranslation()
  const [feedItems, setFeedItems] = useState<FeedItem[]>(loadPersistedFeed)
  const [isRunning, setIsRunning] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [backendStatus, setBackendStatus] = useState<'checking' | 'ok' | 'error'>('checking')

  const toolOutputIdRef = useRef<string | null>(null)
  const lastCommandRef = useRef<string>('')
  const abortRef = useRef<AbortController | null>(null)

  // Check backend connectivity on mount
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const res = await apiClient.apiFetch(`${apiClient.API_BASE}/api/monitor/stats`, { signal: AbortSignal.timeout(5000) })
        if (!cancelled) setBackendStatus(res.ok ? 'ok' : 'error')
      } catch {
        if (!cancelled) setBackendStatus('error')
      }
    }
    check()
    return () => { cancelled = true }
  }, [])

  // Abort stream on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  // Persist feed
  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY_FEED, JSON.stringify(feedItems)) } catch { /* quota */ }
  }, [feedItems])

  const clearHistory = useCallback(() => {
    setFeedItems([])
    sessionStorage.removeItem(STORAGE_KEY_FEED)
  }, [])

  const addFeedItem = useCallback((item: FeedItem) => {
    setFeedItems((prev) => [...prev, item])
  }, [])

  const updateFeedItem = useCallback((id: string, updater: (item: FeedItem) => FeedItem) => {
    setFeedItems((prev) => prev.map((it) => (it.id === id ? updater(it) : it)))
  }, [])

  // SSE stream consumer (bash only)
  const consumeSSE = useCallback(async (url: string, body: Record<string, unknown>) => {
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await apiClient.apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        addFeedItem({ id: crypto.randomUUID(), type: 'error', content: `Request failed: ${res.status}`, timestamp: Date.now() })
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const jsonStr = line.slice(6).trim()
          if (!jsonStr) continue

          try {
            processEvent(JSON.parse(jsonStr))
          } catch {
            continue
          }
        }
      }

      if (buffer.startsWith('data: ')) {
        try {
          processEvent(JSON.parse(buffer.slice(6).trim()))
        } catch { /* ignore */ }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        addFeedItem({ id: crypto.randomUUID(), type: 'info', content: 'Stopped.', timestamp: Date.now() })
      } else {
        addFeedItem({ id: crypto.randomUUID(), type: 'error', content: String(err), timestamp: Date.now() })
      }
    } finally {
      abortRef.current = null
    }

    function processEvent(evt: SSEEvent) {
      const d = evt.data

      switch (evt.event) {
        case 'session_start':
          setSessionId(d.session_id as string)
          break

        case 'tool_log': {
          const text = d.text as string
          const callId = d.call_id as string
          if (!toolOutputIdRef.current) {
            const id = crypto.randomUUID()
            toolOutputIdRef.current = id
            addFeedItem({
              id,
              type: 'tool_output',
              content: text,
              timestamp: Date.now(),
              toolMeta: { callId, tool: 'bash', command: lastCommandRef.current },
            })
          } else {
            updateFeedItem(toolOutputIdRef.current, (it) => ({ ...it, content: it.content + text }))
          }
          break
        }

        case 'tool_done': {
          const exitCode = d.exit_code as number
          const callId = d.call_id as string
          if (toolOutputIdRef.current) {
            updateFeedItem(toolOutputIdRef.current, (it) => ({
              ...it,
              toolMeta: { ...it.toolMeta!, callId, tool: it.toolMeta?.tool || 'bash', exitCode },
            }))
          }
          toolOutputIdRef.current = null
          break
        }

        case 'error':
          addFeedItem({ id: crypto.randomUUID(), type: 'error', content: d.message as string, timestamp: Date.now() })
          break

        case 'done': {
          const ms = d.total_time_ms as number
          if (ms > 0) {
            addFeedItem({
              id: crypto.randomUUID(),
              type: 'info',
              content: `Done — ${Math.round(ms / 1000)}s`,
              timestamp: Date.now(),
            })
          }
          break
        }
      }
    }
  }, [addFeedItem, updateFeedItem])

  const handleSubmit = useCallback(async (input: string) => {
    if (isRunning) return

    addFeedItem({ id: crypto.randomUUID(), type: 'user', content: input, timestamp: Date.now() })
    setIsRunning(true)
    toolOutputIdRef.current = null
    lastCommandRef.current = input

    const { url, body } = apiClient.terminal.execUrl(input)
    await consumeSSE(url, body)

    setIsRunning(false)
    toolOutputIdRef.current = null
  }, [isRunning, addFeedItem, consumeSSE])

  const handleStop = useCallback(async () => {
    abortRef.current?.abort()
    if (sessionId) {
      try {
        await apiClient.terminal.stop(sessionId)
      } catch {
        // ignore
      }
    }
  }, [sessionId])

  // No-op handlers — terminal has no diffs/escalations but MessageFeed requires them
  const noopDiff = useCallback((_callId: string, _approved: boolean, _reason?: string) => {}, [])
  const noopEscalation = useCallback((_id: string, _msg: string) => {}, [])

  return (
    <div className="h-full flex flex-col">
      {/* Terminal header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.04] bg-black/30 shrink-0">
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-green-500">bash</span>
          <span className="text-gray-600">~</span>
          {isRunning && <span className="inline-block w-1.5 h-3 bg-green-400 animate-pulse rounded-sm" />}
        </div>
        <div className="flex items-center gap-2">
          {backendStatus === 'error' && (
            <button
              type="button"
              onClick={() => { setBackendStatus('checking'); apiClient.apiFetch(`${apiClient.API_BASE}/api/monitor/stats`, { signal: AbortSignal.timeout(5000) }).then(r => setBackendStatus(r.ok ? 'ok' : 'error')).catch(() => setBackendStatus('error')) }}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-md hover:bg-red-500/20 transition-colors"
              title="Backend unreachable — click to retry"
            >
              <WifiOff size={10} />
              <span>offline</span>
            </button>
          )}
          {backendStatus === 'ok' && (
            <span className="flex items-center gap-1 text-[10px] text-green-500/60">
              <Wifi size={10} />
            </span>
          )}
          {feedItems.length > 0 && !isRunning && (
            <button
              type="button"
              onClick={clearHistory}
              className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-white/5 rounded-lg transition-colors"
              title={t('terminal.clear')}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Backend offline banner */}
      {backendStatus === 'error' && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-xs text-red-300 flex items-center gap-2">
          <WifiOff size={12} />
          <span>Backend not reachable at <code className="text-red-400">{apiClient.API_BASE}</code>. Make sure the server is running.</span>
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <MessageFeed
          items={feedItems}
          sessionId={sessionId}
          onDiffDecided={noopDiff}
          onEscalationResponded={noopEscalation}
          onFixError={(errorText, command) => {
            const prompt = command
              ? `The command \`${command}\` failed with this error:\n\n\`\`\`\n${errorText.slice(0, 2000)}\n\`\`\`\n\nAnalyze the error and fix it.`
              : `Fix this error:\n\n\`\`\`\n${errorText.slice(0, 2000)}\n\`\`\``;
            handleSubmit(prompt);
          }}
        />
        <InputBar
          onSubmit={handleSubmit}
          onStop={handleStop}
          isRunning={isRunning}
        />
      </div>
    </div>
  )
}
