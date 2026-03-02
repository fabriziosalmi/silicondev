import { useState, useCallback, useRef, useEffect } from 'react'
import { PanelRightOpen, PanelRightClose, Trash2, TerminalSquare } from 'lucide-react'
import { useGlobalState } from '../../context/GlobalState'
import { apiClient } from '../../api/client'
import { MessageFeed } from './MessageFeed'
import { InputBar } from './InputBar'
import type { TerminalMode } from './InputBar'
import { TelemetrySidebar } from './TelemetrySidebar'
import { EmptyState } from '../ui/EmptyState'
import type { FeedItem, TelemetryData, SSEEvent } from './types'

const EMPTY_TELEMETRY: TelemetryData = {
  agent: '',
  state: 'idle',
  tokensUsed: 0,
  elapsedMs: 0,
  iteration: 0,
  actions: [],
  tokenBudget: 50000,
  budgetFraction: 0,
}

const STORAGE_KEY_FEED = 'nanocore-terminal-feed'
const STORAGE_KEY_TELEMETRY = 'nanocore-terminal-telemetry'
const STORAGE_KEY_MODE = 'nanocore-terminal-mode'

function loadPersistedFeed(): FeedItem[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_FEED)
    if (!raw) return []
    const items: FeedItem[] = JSON.parse(raw)
    return items.map((it) =>
      it.diffMeta?.status === 'pending'
        ? { ...it, diffMeta: { ...it.diffMeta, status: 'rejected', rejectReason: 'Session lost (page refreshed)' } }
        : it
    )
  } catch {
    return []
  }
}

function loadPersistedTelemetry(): TelemetryData {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_TELEMETRY)
    return raw ? JSON.parse(raw) : EMPTY_TELEMETRY
  } catch {
    return EMPTY_TELEMETRY
  }
}

function loadPersistedMode(): TerminalMode {
  const raw = localStorage.getItem(STORAGE_KEY_MODE)
  return raw === 'agent' ? 'agent' : 'terminal'
}

export function AgentTerminal() {
  const { activeModel } = useGlobalState()
  const [feedItems, setFeedItems] = useState<FeedItem[]>(loadPersistedFeed)
  const [isRunning, setIsRunning] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [telemetry, setTelemetry] = useState<TelemetryData>(loadPersistedTelemetry)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [mode, setMode] = useState<TerminalMode>(loadPersistedMode)

  // Abort any running stream on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY_FEED, JSON.stringify(feedItems)) } catch { /* quota */ }
  }, [feedItems])
  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY_TELEMETRY, JSON.stringify(telemetry)) } catch { /* quota */ }
  }, [telemetry])

  const handleModeChange = useCallback((m: TerminalMode) => {
    setMode(m)
    localStorage.setItem(STORAGE_KEY_MODE, m)
  }, [])

  const clearHistory = useCallback(() => {
    setFeedItems([])
    setTelemetry(EMPTY_TELEMETRY)
    sessionStorage.removeItem(STORAGE_KEY_FEED)
    sessionStorage.removeItem(STORAGE_KEY_TELEMETRY)
  }, [])

  const aiTextIdRef = useRef<string | null>(null)
  const toolOutputIdRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const addFeedItem = useCallback((item: FeedItem) => {
    setFeedItems((prev) => [...prev, item])
  }, [])

  const updateFeedItem = useCallback((id: string, updater: (item: FeedItem) => FeedItem) => {
    setFeedItems((prev) => prev.map((it) => (it.id === id ? updater(it) : it)))
  }, [])

  const handleDiffDecided = useCallback((callId: string, approved: boolean, reason?: string) => {
    setFeedItems((prev) =>
      prev.map((it) =>
        it.diffMeta?.callId === callId
          ? { ...it, diffMeta: { ...it.diffMeta, status: approved ? 'approved' : 'rejected', rejectReason: reason } }
          : it
      )
    )
  }, [])

  // --- SSE stream consumer (shared between both modes) ---
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

        case 'token_stream': {
          const text = d.text as string
          if (!aiTextIdRef.current) {
            const id = crypto.randomUUID()
            aiTextIdRef.current = id
            addFeedItem({ id, type: 'ai_text', content: text, timestamp: Date.now() })
          } else {
            updateFeedItem(aiTextIdRef.current, (it) => ({ ...it, content: it.content + text }))
          }
          toolOutputIdRef.current = null
          break
        }

        case 'tool_start': {
          aiTextIdRef.current = null
          toolOutputIdRef.current = null

          const tool = d.tool as string
          const cmd = (d.args as Record<string, string>)?.command || ''
          const callId = d.call_id as string
          const label = tool === 'run_bash' ? `$ ${cmd}` : `${tool}`
          addFeedItem({
            id: crypto.randomUUID(),
            type: 'tool_start',
            content: label,
            timestamp: Date.now(),
            toolMeta: { callId, tool, command: cmd },
          })

          setTelemetry((prev) => ({
            ...prev,
            actions: [...prev.actions, { timestamp: Date.now(), action: tool, detail: cmd }],
          }))
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

        case 'diff_proposal': {
          aiTextIdRef.current = null
          toolOutputIdRef.current = null
          addFeedItem({
            id: crypto.randomUUID(),
            type: 'diff_proposal',
            content: '',
            timestamp: Date.now(),
            diffMeta: {
              callId: d.call_id as string,
              filePath: d.file_path as string,
              oldContent: d.old as string,
              newContent: d.new as string,
              diff: d.diff as string,
              status: 'pending',
            },
          })
          break
        }

        case 'telemetry_update':
          setTelemetry((prev) => ({
            ...prev,
            agent: d.agent as string,
            state: d.state as string,
            tokensUsed: d.tokens_used as number,
            elapsedMs: d.elapsed_ms as number,
            iteration: d.iteration as number,
            tokenBudget: (d.token_budget as number) ?? prev.tokenBudget,
            budgetFraction: (d.budget_fraction as number) ?? prev.budgetFraction,
          }))
          break

        case 'budget_exhausted':
          addFeedItem({
            id: crypto.randomUUID(),
            type: 'info',
            content: `Token budget exhausted (${((d.total_tokens as number) || 0).toLocaleString()} / ${((d.budget as number) || 0).toLocaleString()})`,
            timestamp: Date.now(),
          })
          break

        case 'error':
          addFeedItem({ id: crypto.randomUUID(), type: 'error', content: d.message as string, timestamp: Date.now() })
          break

        case 'done': {
          const tokens = d.total_tokens as number
          const ms = d.total_time_ms as number
          const parts: string[] = []
          if (tokens > 0) parts.push(`${tokens.toLocaleString()} tokens`)
          parts.push(`${Math.round(ms / 1000)}s`)
          addFeedItem({
            id: crypto.randomUUID(),
            type: 'info',
            content: `Done — ${parts.join(', ')}`,
            timestamp: Date.now(),
          })
          break
        }
      }
    }
  }, [addFeedItem, updateFeedItem])

  const handleSubmit = useCallback(async (input: string) => {
    if (isRunning) return

    addFeedItem({ id: crypto.randomUUID(), type: 'user', content: input, timestamp: Date.now() })
    setIsRunning(true)
    setTelemetry(EMPTY_TELEMETRY)
    aiTextIdRef.current = null
    toolOutputIdRef.current = null

    if (mode === 'terminal') {
      // Direct bash execution — no model needed
      const { url, body } = apiClient.terminal.execUrl(input)
      await consumeSSE(url, body)
    } else {
      // Agent mode — requires a loaded model
      if (!activeModel) {
        addFeedItem({ id: crypto.randomUUID(), type: 'error', content: 'No model loaded. Switch to Terminal mode or load a model.', timestamp: Date.now() })
        setIsRunning(false)
        return
      }
      const { url, body } = apiClient.terminal.runUrl(input, activeModel.id)
      await consumeSSE(url, body)
    }

    setIsRunning(false)
    aiTextIdRef.current = null
    toolOutputIdRef.current = null
  }, [isRunning, mode, activeModel, addFeedItem, consumeSSE])

  const handleStop = useCallback(async () => {
    // Abort the SSE fetch stream (works for both terminal and agent modes)
    abortRef.current?.abort()

    // For agent mode, also tell the backend to stop the supervisor loop
    if (sessionId) {
      try {
        await apiClient.terminal.stop(sessionId)
      } catch {
        // ignore — session may already be done
      }
    }
  }, [sessionId])

  // Terminal mode works without a model, agent mode requires one
  if (mode === 'agent' && !activeModel) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={<TerminalSquare size={24} />}
            title="No model loaded"
            description="Load a model to use Agent mode, or switch to Terminal mode for direct bash access."
          />
        </div>
        <InputBar
          onSubmit={handleSubmit}
          onStop={handleStop}
          isRunning={isRunning}
          mode={mode}
          onModeChange={handleModeChange}
        />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Terminal header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.04] bg-black/30 shrink-0">
        <div className="flex items-center gap-2 font-mono text-xs">
          {mode === 'terminal' ? (
            <>
              <span className="text-green-500">bash</span>
              <span className="text-gray-600">~</span>
            </>
          ) : (
            <>
              <span className="text-green-500">nanocore</span>
              <span className="text-gray-600">@</span>
              <span className="text-blue-400">{activeModel?.name ?? '?'}</span>
              <span className="text-gray-600">~</span>
            </>
          )}
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
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 text-gray-600 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            title={sidebarOpen ? 'Hide telemetry' : 'Show telemetry'}
          >
            {sidebarOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0">
          <MessageFeed
            items={feedItems}
            sessionId={sessionId}
            onDiffDecided={handleDiffDecided}
          />
          <InputBar
            onSubmit={handleSubmit}
            onStop={handleStop}
            isRunning={isRunning}
            mode={mode}
            onModeChange={handleModeChange}
          />
        </div>
        <TelemetrySidebar telemetry={telemetry} isOpen={sidebarOpen} />
      </div>
    </div>
  )
}
