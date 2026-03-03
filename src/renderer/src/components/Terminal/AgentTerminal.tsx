import { useState, useCallback, useRef, useEffect } from 'react'
import { Trash2 } from 'lucide-react'
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
  const [feedItems, setFeedItems] = useState<FeedItem[]>(loadPersistedFeed)
  const [isRunning, setIsRunning] = useState(false)
  const [sessionId, setSessionId] = useState('')

  const toolOutputIdRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

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
      const res = await fetch(url, {
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
              toolMeta: { callId, tool: 'bash' },
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
        <div className="flex items-center gap-1">
          {feedItems.length > 0 && !isRunning && (
            <button
              type="button"
              onClick={clearHistory}
              className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-white/5 rounded-lg transition-colors"
              title="Clear history"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <MessageFeed
          items={feedItems}
          sessionId={sessionId}
          onDiffDecided={noopDiff}
          onEscalationResponded={noopEscalation}
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
