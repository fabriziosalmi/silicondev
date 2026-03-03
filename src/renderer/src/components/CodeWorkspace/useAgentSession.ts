import { useState, useCallback, useRef, useEffect } from 'react'
import { useGlobalState } from '../../context/GlobalState'
import { apiClient } from '../../api/client'
import type { FeedItem, TelemetryData, SSEEvent } from '../Terminal/types'

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

const STORAGE_KEY_FEED = 'nanocore-code-feed'
const STORAGE_KEY_TELEMETRY = 'nanocore-code-telemetry'

function loadPersistedFeed(): FeedItem[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_FEED)
    if (!raw) return []
    const items: FeedItem[] = JSON.parse(raw)
    return items.map((it) => {
      if (it.diffMeta?.status === 'pending') {
        return { ...it, diffMeta: { ...it.diffMeta, status: 'rejected', rejectReason: 'Session lost (page refreshed)' } }
      }
      if (it.escalationMeta?.status === 'pending') {
        return { ...it, escalationMeta: { ...it.escalationMeta, status: 'responded', userMessage: '(session lost)' } }
      }
      return it
    })
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

interface UseAgentSessionOptions {
  onDiffProposal?: (filePath: string) => void
}

export function useAgentSession(options?: UseAgentSessionOptions) {
  const { activeModel } = useGlobalState()
  const [feedItems, setFeedItems] = useState<FeedItem[]>(loadPersistedFeed)
  const [isRunning, setIsRunning] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [telemetry, setTelemetry] = useState<TelemetryData>(loadPersistedTelemetry)

  const aiTextIdRef = useRef<string | null>(null)
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

  // Persist telemetry
  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY_TELEMETRY, JSON.stringify(telemetry)) } catch { /* quota */ }
  }, [telemetry])

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

  const handleEscalationResponded = useCallback((escalationId: string, userMessage: string) => {
    setFeedItems((prev) =>
      prev.map((it) =>
        it.escalationMeta?.escalationId === escalationId
          ? { ...it, escalationMeta: { ...it.escalationMeta, status: 'responded', userMessage } }
          : it
      )
    )
  }, [])

  const clearHistory = useCallback(() => {
    setFeedItems([])
    setTelemetry(EMPTY_TELEMETRY)
    sessionStorage.removeItem(STORAGE_KEY_FEED)
    sessionStorage.removeItem(STORAGE_KEY_TELEMETRY)
  }, [])

  // SSE stream consumer
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
          const filePath = d.file_path as string
          addFeedItem({
            id: crypto.randomUUID(),
            type: 'diff_proposal',
            content: '',
            timestamp: Date.now(),
            diffMeta: {
              callId: d.call_id as string,
              filePath,
              oldContent: d.old as string,
              newContent: d.new as string,
              diff: d.diff as string,
              status: 'pending',
            },
          })
          options?.onDiffProposal?.(filePath)
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

        case 'human_escalation':
          addFeedItem({
            id: crypto.randomUUID(),
            type: 'human_escalation',
            content: (d.reason as string) || 'The agent is stuck and needs your help.',
            timestamp: Date.now(),
            escalationMeta: {
              escalationId: d.escalation_id as string,
              reason: d.reason as string,
              status: 'pending',
            },
          })
          break

        case 'auto_retry': {
          const status = d.status as string
          const attempt = d.attempt as number
          const maxAttempts = d.max_attempts as number
          const cmd = (d.command as string) || ''

          if (status === 'resolved') {
            setFeedItems((prev) => {
              const lastRetryIdx = [...prev].reverse().findIndex((it) => it.type === 'auto_retry' && it.autoRetryMeta?.status === 'retrying')
              if (lastRetryIdx === -1) return prev
              const idx = prev.length - 1 - lastRetryIdx
              return prev.map((it, i) =>
                i === idx ? { ...it, autoRetryMeta: { ...it.autoRetryMeta!, status: 'resolved' } } : it
              )
            })
          } else {
            addFeedItem({
              id: crypto.randomUUID(),
              type: 'auto_retry',
              content: cmd,
              timestamp: Date.now(),
              autoRetryMeta: { attempt, maxAttempts, command: cmd, status: status as 'retrying' | 'exhausted' },
            })
          }
          break
        }

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
  }, [addFeedItem, updateFeedItem, options])

  const handleSubmit = useCallback(async (input: string) => {
    if (isRunning) return

    addFeedItem({ id: crypto.randomUUID(), type: 'user', content: input, timestamp: Date.now() })
    setIsRunning(true)
    setTelemetry(EMPTY_TELEMETRY)
    aiTextIdRef.current = null
    toolOutputIdRef.current = null

    if (!activeModel) {
      addFeedItem({ id: crypto.randomUUID(), type: 'error', content: 'No model loaded. Load a model from the Models tab first.', timestamp: Date.now() })
      setIsRunning(false)
      return
    }

    const { url, body } = apiClient.terminal.runUrl(input, activeModel.id)
    await consumeSSE(url, body)

    setIsRunning(false)
    aiTextIdRef.current = null
    toolOutputIdRef.current = null
  }, [isRunning, activeModel, addFeedItem, consumeSSE])

  const handleStop = useCallback(async () => {
    abortRef.current?.abort()
    if (sessionId) {
      try {
        await apiClient.terminal.stop(sessionId)
      } catch {
        // ignore — session may already be done
      }
    }
  }, [sessionId])

  return {
    feedItems,
    isRunning,
    sessionId,
    telemetry,
    activeModel,
    handleSubmit,
    handleStop,
    handleDiffDecided,
    handleEscalationResponded,
    clearHistory,
  }
}
