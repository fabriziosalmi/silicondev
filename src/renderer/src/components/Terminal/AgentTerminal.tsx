import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2, WifiOff, Wifi } from 'lucide-react'
import { apiClient } from '../../api/client'
import { MessageFeed } from './MessageFeed'
import { InputBar } from './InputBar'
import type { FeedItem, SSEEvent } from './types'

const STORAGE_KEY_FEED = 'nanocore-terminal-feed'
const MAX_PERSISTED_ITEMS = 500
const MAX_PERSISTED_ITEM_BYTES = 12_000

function loadPersistedFeed(): FeedItem[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_FEED)
    if (!raw) return []
    const items = JSON.parse(raw) as FeedItem[]
    return items.slice(-MAX_PERSISTED_ITEMS)
  } catch {
    return []
  }
}

function persistFeed(items: FeedItem[]) {
  try {
    // Trim old items + truncate large tool outputs before saving
    const toSave = items.slice(-MAX_PERSISTED_ITEMS).map((item) => {
      if (item.type === 'tool_output' && item.content.length > MAX_PERSISTED_ITEM_BYTES) {
        return { ...item, content: item.content.slice(-MAX_PERSISTED_ITEM_BYTES) }
      }
      return item
    })
    sessionStorage.setItem(STORAGE_KEY_FEED, JSON.stringify(toSave))
  } catch { /* quota exceeded — silently skip */ }
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
  const mountedRef = useRef(true)
  // Tracks the active /exec call_id so Ctrl+C can target the right process server-side.
  const activeCallIdRef = useRef<string | null>(null)

  // Check backend connectivity on mount + periodic health check every 30s
  useEffect(() => {
    const check = async () => {
      try {
        const res = await apiClient.apiFetch(`${apiClient.API_BASE}/api/monitor/stats`, { signal: AbortSignal.timeout(5000) })
        if (mountedRef.current) setBackendStatus(res.ok ? 'ok' : 'error')
      } catch {
        if (mountedRef.current) setBackendStatus('error')
      }
    }
    check()
    const timer = setInterval(check, 30_000)
    return () => clearInterval(timer)
  }, [])

  // Track mount state + abort stream on unmount
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  // Persist feed (trimmed + truncated)
  useEffect(() => {
    persistFeed(feedItems)
  }, [feedItems])

  const clearHistory = useCallback(() => {
    setFeedItems([])
    sessionStorage.removeItem(STORAGE_KEY_FEED)
  }, [])

  // Ctrl+L / Cmd+L — Unix convention: clear terminal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'l' && !isRunning) {
        e.preventDefault()
        clearHistory()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [clearHistory, isRunning])

  // Ctrl+C — send SIGINT to the running PTY process (Unix convention).
  // Skipped if there's a non-empty selection so copy still works.
  // On macOS we keep this Ctrl-only — Cmd+C is reserved for copy.
  useEffect(() => {
    if (!isRunning) return
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key !== 'c') return
      const callId = activeCallIdRef.current
      if (!callId) return
      const sel = window.getSelection()
      if (sel && sel.toString().length > 0) return
      e.preventDefault()
      apiClient.terminal.interrupt(callId).catch(() => { /* best-effort */ })
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isRunning])

  const addFeedItem = useCallback((item: FeedItem) => {
    setFeedItems((prev) => [...prev, item])
  }, [])

  const updateFeedItem = useCallback((id: string, updater: (item: FeedItem) => FeedItem) => {
    setFeedItems((prev) => {
      // Fast path: the item to update is almost always the last one
      const last = prev[prev.length - 1]
      if (last && last.id === id) {
        const updated = updater(last)
        if (updated === last) return prev
        const next = prev.slice(0, -1)
        next.push(updated)
        return next
      }
      return prev.map((it) => (it.id === id ? updater(it) : it))
    })
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

        case 'tool_start': {
          // Capture call_id so Ctrl+C can target this PTY process.
          activeCallIdRef.current = (d.call_id as string) ?? null
          break
        }

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
              viewMode: 'inline',
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
          activeCallIdRef.current = null
          break
        }

        case 'error':
          addFeedItem({ id: crypto.randomUUID(), type: 'error', content: d.message as string, timestamp: Date.now() })
          break

        case 'done': {
          // Inline terminal mode: skip the "Done — Ns" info badge. It used to
          // also gate the TaskRecapStrip ("N commands") in MessageFeed, so
          // dropping it here is what makes the feed look like a real shell.
          break
        }
      }
    }
  }, [addFeedItem, updateFeedItem])

  const handleSubmit = useCallback(async (input: string) => {
    if (isRunning) return

    // In terminal (inline) mode the command is rendered as the "~ $ <cmd>"
    // prompt line of the tool_output item, so we deliberately do NOT add a
    // separate `user` bubble — that would duplicate the command on screen.
    setIsRunning(true)
    toolOutputIdRef.current = null
    lastCommandRef.current = input

    const { url, body } = apiClient.terminal.execUrl(input)
    await consumeSSE(url, body)

    if (mountedRef.current) setIsRunning(false)
    toolOutputIdRef.current = null
  }, [isRunning, consumeSSE])

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
  const noopDiff = useCallback(() => {}, [])
  const noopEscalation = useCallback(() => {}, [])

  return (
    <div className="h-full flex flex-col">
      {/* Terminal header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-outline-subtle bg-input-bg shrink-0">
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-green-500">bash</span>
          <span className="text-foreground-subtle">~</span>
          <span className="text-foreground-subtle text-[10px] tracking-wide">limited shell · no $() · Ctrl+C to interrupt</span>
          {isRunning && <span className="inline-block w-1.5 h-3 bg-green-400 animate-pulse rounded-sm" />}
        </div>
        <div className="flex items-center gap-2">
          {backendStatus === 'error' && (
            <button
              type="button"
              onClick={() => { setBackendStatus('checking'); apiClient.apiFetch(`${apiClient.API_BASE}/api/monitor/stats`, { signal: AbortSignal.timeout(5000) }).then(r => setBackendStatus(r.ok ? 'ok' : 'error')).catch(() => setBackendStatus('error')) }}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-danger bg-danger-muted border border-danger/20 rounded-md hover:bg-danger/20 transition-colors"
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
              className="p-1.5 text-foreground-subtle hover:text-danger hover:bg-hover rounded-lg transition-colors"
              title={t('terminal.clear')}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Backend offline banner */}
      {backendStatus === 'error' && (
        <div className="px-4 py-2 bg-danger-muted border-b border-danger/20 text-xs text-danger flex items-center gap-2">
          <WifiOff size={12} />
          <span>Backend not reachable at <code className="text-danger">{apiClient.API_BASE}</code>. Make sure the server is running.</span>
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
