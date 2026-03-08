import { useState, useCallback, useRef, useEffect } from 'react'
import { useGlobalState } from '../../context/GlobalState'
import { apiClient } from '../../api/client'
import type { FeedItem, TelemetryData, SSEEvent, ScoutAlertMetadata, PlanStep } from '../Terminal/types'

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

interface DiffProposalMeta {
  callId: string
  filePath: string
  oldContent: string
  newContent: string
  diff: string
}

export interface ActiveFileContext {
  path: string
  content?: string
  language?: string
}

interface UseAgentSessionOptions {
  onDiffProposal?: (filePath: string, meta: DiffProposalMeta) => void
  onFileChanged?: (filePath: string, isNew: boolean) => void
  getActiveFile?: () => ActiveFileContext | null
  getWorkspaceDir?: () => string | null
  lowPowerMode?: boolean
}

export function useAgentSession(options?: UseAgentSessionOptions) {
  const { activeModel } = useGlobalState()
  const [feedItems, setFeedItems] = useState<FeedItem[]>(loadPersistedFeed)
  const [isRunning, setIsRunning] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [activeAgencyRole, setActiveAgencyRole] = useState<{ role: 'architect' | 'worker' | 'inspector'; status: string } | null>(null)
  const [telemetry, setTelemetry] = useState<TelemetryData>(loadPersistedTelemetry)
  const [agentMode, setAgentMode] = useState<'edit' | 'review'>('edit')
  const [pinnedItems, setPinnedItems] = useState<{ id: string; type: 'file' | 'text'; name: string; content: string }[]>([])
  const [scoutIssues, setScoutIssues] = useState<ScoutAlertMetadata['issues']>([])
  const [contextHealth, setContextHealth] = useState<{ used_tokens: number; max_tokens: number } | null>(null)
  const [promptProfile, setPromptProfile] = useState<{ intent: string; complexity: string; extracted_paths: string[] } | null>(null)

  const aiTextIdRef = useRef<string | null>(null)
  const toolOutputIdRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Abort stream on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  // Persist feed (debounced — avoid serializing megabytes per token during streaming)
  const persistFeedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (persistFeedTimer.current) clearTimeout(persistFeedTimer.current)
    persistFeedTimer.current = setTimeout(() => {
      try { sessionStorage.setItem(STORAGE_KEY_FEED, JSON.stringify(feedItems)) } catch { /* quota */ }
    }, 500)
    return () => { if (persistFeedTimer.current) clearTimeout(persistFeedTimer.current) }
  }, [feedItems])

  // Persist telemetry (debounced)
  const persistTelemetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (persistTelemetryTimer.current) clearTimeout(persistTelemetryTimer.current)
    persistTelemetryTimer.current = setTimeout(() => {
      try { sessionStorage.setItem(STORAGE_KEY_TELEMETRY, JSON.stringify(telemetry)) } catch { /* quota */ }
    }, 500)
    return () => { if (persistTelemetryTimer.current) clearTimeout(persistTelemetryTimer.current) }
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
    setPinnedItems([])
    sessionStorage.removeItem(STORAGE_KEY_FEED)
    sessionStorage.removeItem(STORAGE_KEY_TELEMETRY)
  }, [])

  const togglePin = useCallback((item: { id: string; type: 'file' | 'text'; name: string; content: string }) => {
    setPinnedItems((prev) => {
      const exists = prev.find((it) => it.id === item.id)
      if (exists) return prev.filter((it) => it.id !== item.id)
      return [...prev, item]
    })
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
          addFeedItem({ id: crypto.randomUUID(), type: 'info', content: `Session started. ${d.git_snapshot ? `Snapshot: ${d.git_snapshot}` : ''}`, timestamp: Date.now() })
          break

        case 'agency_status':
          setActiveAgencyRole({ role: d.role as 'architect' | 'worker' | 'inspector', status: d.status as string })
          break

        case 'context_health':
          setContextHealth({
            used_tokens: d.used_tokens as number,
            max_tokens: d.max_tokens as number,
          })
          break

        case 'prompt_profile':
          setPromptProfile({
            intent: d.intent as string,
            complexity: d.complexity as string,
            extracted_paths: (d.extracted_paths as string[]) || [],
          })
          break

        case 'file_changed':
          options?.onFileChanged?.(d.path as string, d.is_new as boolean)
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
          let label = tool === 'run_bash' ? `$ ${cmd}` : `${tool}`
          if (tool === 'ask_swarm_experts') {
            label = `Consulting Mixture of Agents (MoA)...`
          }
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
              toolMeta: { callId, tool: d.tool as string || 'system' },
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
          const callId = d.call_id as string
          const oldContent = d.old as string
          const newContent = d.new as string
          const diffText = d.diff as string
          addFeedItem({
            id: crypto.randomUUID(),
            type: 'diff_proposal',
            content: '',
            timestamp: Date.now(),
            diffMeta: {
              callId,
              filePath,
              oldContent,
              newContent,
              diff: diffText,
              status: 'pending',
            },
          })
          options?.onDiffProposal?.(filePath, { callId, filePath, oldContent, newContent, diff: diffText })
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

        case 'thinking':
          aiTextIdRef.current = null
          // Replace previous thinking block + remove step_label (only keep latest thinking)
          setFeedItems((prev) => {
            const filtered = prev.filter((it) => it.type !== 'thinking' && it.type !== 'step_label')
            return [...filtered, {
              id: crypto.randomUUID(),
              type: 'thinking' as const,
              content: (d.content as string) || '',
              timestamp: Date.now(),
            }]
          })
          break

        case 'step_label': {
          // Replace previous step_label with progress info
          const rawLabel = (d.label as string) || ''
          const iter = d.iteration as number
          const maxIter = d.max_iterations as number
          const budgetPct = d.budget_pct as number
          const progressSuffix = iter && maxIter ? ` (${iter}/${maxIter}, ${budgetPct ?? 0}%)` : ''
          const fullLabel = rawLabel + progressSuffix

          setFeedItems((prev) => {
            const filtered = prev.filter((it) => it.type !== 'step_label')
            return [...filtered, {
              id: crypto.randomUUID(),
              type: 'step_label' as const,
              content: fullLabel,
              timestamp: Date.now(),
            }]
          })
          break
        }

        case 'lint_result': {
          const filePath = d.file_path as string
          const errors = d.errors as string
          addFeedItem({
            id: crypto.randomUUID(),
            type: 'info' as const,
            content: `Lint: ${filePath}\n${errors}`,
            timestamp: Date.now(),
          })
          break
        }

        case 'agency_trace':
          addFeedItem({
            id: crypto.randomUUID(),
            type: 'agency_trace' as const,
            content: d.content as string,
            timestamp: Date.now(),
            agencyTraceMeta: {
              role: d.role as 'architect' | 'worker' | 'inspector',
              content: d.content as string,
              target: d.target as string
            }
          })
          break
        case 'rag_search':
          addFeedItem({
            id: crypto.randomUUID(),
            type: 'rag_search' as const,
            content: `Found ${((d.results as any[]) || []).length} relevant snippets`,
            timestamp: Date.now(),
            ragSearchMeta: {
              query: d.query as string,
              results: d.results as any[]
            }
          })
          break
        case 'scout_alert':
          if (options?.lowPowerMode) {
            console.log("Ignoring Scout Alert due to Low Power Mode")
            break
          }
          setScoutIssues((prev: ScoutAlertMetadata['issues']) => [...prev, ...(d.issues as any[])])
          addFeedItem({
            id: crypto.randomUUID(),
            type: 'scout_alert' as const,
            content: `Scout Agent found ${((d.issues as any[]) || []).length} potential issues`,
            timestamp: Date.now(),
            scoutAlertMeta: {
              issues: d.issues as any[]
            }
          })
          break
        case 'swarm_progress': {
          const expert = d.expert as string
          const phase = d.phase as string
          const status = d.status as string
          const label = status === 'started'
            ? `Swarm: ${phase === 'reduce' ? 'Synthesizing' : `Expert "${expert}"`} running...`
            : `Swarm: ${phase === 'reduce' ? 'Synthesis' : `Expert "${expert}"`} complete`
          // Replace previous swarm_progress item to avoid clutter
          setFeedItems((prev) => {
            const filtered = prev.filter((it) => it.type !== 'swarm_progress')
            return [...filtered, {
              id: crypto.randomUUID(),
              type: 'swarm_progress' as const,
              content: label,
              timestamp: Date.now(),
            }]
          })
          break
        }

        case 'plan_proposal': {
          const steps = (d.steps as PlanStep[]) || []
          const planSessionId = d.session_id as string
          addFeedItem({
            id: crypto.randomUUID(),
            type: 'plan_proposal',
            content: `Plan: ${steps.length} step(s)`,
            timestamp: Date.now(),
            planMeta: {
              sessionId: planSessionId,
              steps: steps.map(s => ({ ...s, status: 'pending' as const })),
              planTokens: (d.plan_tokens as number) || 0,
              status: 'pending',
            },
          })
          break
        }

        case 'plan_status': {
          const phase = d.phase as string
          const message = d.message as string
          if (phase === 'executing') {
            // Update plan_proposal item to 'executing' status
            setFeedItems((prev) =>
              prev.map((it) =>
                it.type === 'plan_proposal' && it.planMeta?.status === 'pending'
                  ? { ...it, planMeta: { ...it.planMeta!, status: 'executing' as const } }
                  : it
              )
            )
          } else if (phase === 'rejected') {
            setFeedItems((prev) =>
              prev.map((it) =>
                it.type === 'plan_proposal' && it.planMeta
                  ? { ...it, planMeta: { ...it.planMeta!, status: 'rejected' as const } }
                  : it
              )
            )
          } else if (phase === 'done') {
            setFeedItems((prev) =>
              prev.map((it) =>
                it.type === 'plan_proposal' && it.planMeta
                  ? { ...it, planMeta: { ...it.planMeta!, status: 'done' as const } }
                  : it
              )
            )
          }
          if (message) {
            addFeedItem({ id: crypto.randomUUID(), type: 'info', content: message, timestamp: Date.now() })
          }
          break
        }

        case 'plan_step_start': {
          const stepIndex = d.step_index as number
          // Update the plan step status to 'running'
          setFeedItems((prev) =>
            prev.map((it) => {
              if (it.type !== 'plan_proposal' || !it.planMeta) return it
              const updatedSteps = it.planMeta.steps.map((s, i) =>
                i === stepIndex ? { ...s, status: 'running' as const } : s
              )
              return { ...it, planMeta: { ...it.planMeta, steps: updatedSteps } }
            })
          )
          addFeedItem({
            id: crypto.randomUUID(),
            type: 'plan_step',
            content: `[${d.step_index as number + 1}/${d.total_steps as number}] ${d.action as string}: ${d.file as string}`,
            timestamp: Date.now(),
          })
          break
        }

        case 'plan_step_done': {
          const stepIndex = d.step_index as number
          const status = d.status as string
          setFeedItems((prev) =>
            prev.map((it) => {
              if (it.type !== 'plan_proposal' || !it.planMeta) return it
              const updatedSteps = it.planMeta.steps.map((s, i) =>
                i === stepIndex ? { ...s, status: status as PlanStep['status'], editTokens: d.edit_tokens as number } : s
              )
              return { ...it, planMeta: { ...it.planMeta, steps: updatedSteps } }
            })
          )
          break
        }

        case 'plan_step_progress':
          // Optional: could update a progress indicator. For now, ignore.
          break

        case 'error':
          addFeedItem({ id: crypto.randomUUID(), type: 'error', content: d.message as string, timestamp: Date.now() })
          break

        case 'done': {
          const tokens = d.total_tokens as number
          const ms = d.total_time_ms as number
          const iterations = d.iterations as number
          const edits = d.edits as number
          const parts: string[] = []
          if (tokens > 0) parts.push(`${tokens.toLocaleString()} tokens`)
          parts.push(`${Math.round(ms / 1000)}s`)
          if (iterations > 0) parts.push(`${iterations} iter`)
          if (edits > 0) parts.push(`${edits} edit${edits > 1 ? 's' : ''}`)
          // Remove step_label, thinking, and swarm_progress; add done info
          setFeedItems((prev) => [
            ...prev.filter((it) => it.type !== 'step_label' && it.type !== 'thinking' && it.type !== 'swarm_progress'),
            {
              id: crypto.randomUUID(),
              type: 'info' as const,
              content: `Done — ${parts.join(', ')}`,
              timestamp: Date.now(),
            },
          ])
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
    setActiveAgencyRole(null) // Reset active agency role on new submission
    setScoutIssues([]) // Reset scout issues on new submission
    setContextHealth(null) // Reset context health on new submission
    setPromptProfile(null)

    if (!activeModel) {
      addFeedItem({ id: crypto.randomUUID(), type: 'error', content: 'No model loaded. Load a model from the Models tab first.', timestamp: Date.now() })
      setIsRunning(false)
      return
    }

    // Build conversation history from previous feed items (multi-turn memory)
    const history: { role: string; content: string }[] = []

    // Inject pinned context as a special system instruction or early user message
    if (pinnedItems.length > 0) {
      const contextBlocks = pinnedItems.map(it => `[PINNED ${it.type.toUpperCase()}: ${it.name}]\n${it.content}`).join('\n\n---\n\n')
      history.push({
        role: 'system',
        content: `IMPORTANT CONTEXT (Pinned by user):\nThe following files/code snippets are critical for this task. Refer to them as ground truth:\n\n${contextBlocks}`
      })
    }

    for (const item of feedItems) {
      if (item.type === 'user') {
        history.push({ role: 'user', content: item.content })
      } else if (item.type === 'ai_text' && item.content.trim()) {
        history.push({ role: 'assistant', content: item.content })
      }
    }
    // Keep last 10 turns to avoid overloading context
    const recentHistory = history.slice(-10)

    const activeFile = options?.getActiveFile?.() ?? null
    const workspaceDir = options?.getWorkspaceDir?.() ?? undefined
    const chatSettings = JSON.parse(localStorage.getItem('silicon-studio-chat-settings') || '{}')

    const { url, body } = apiClient.terminal.runUrl(input, activeModel.id, {
      activeFile: activeFile ?? undefined,
      history: recentHistory.length > 0 ? recentHistory : undefined,
      mode: agentMode,
      workspaceDir,
      enableMoA: chatSettings.enableMoA ?? true,
      airGappedMode: chatSettings.airGappedMode ?? false,
      enablePythonSandbox: chatSettings.enablePythonSandbox ?? false,
    })
    await consumeSSE(url, body)

    setIsRunning(false)
    aiTextIdRef.current = null
    toolOutputIdRef.current = null
    setActiveAgencyRole(null) // Clear active agency role when session ends
  }, [isRunning, activeModel, addFeedItem, consumeSSE, agentMode])

  const handlePlanSubmit = useCallback(async (input: string) => {
    if (isRunning) return

    addFeedItem({ id: crypto.randomUUID(), type: 'user', content: `[Plan] ${input}`, timestamp: Date.now() })
    setIsRunning(true)
    setTelemetry(EMPTY_TELEMETRY)
    aiTextIdRef.current = null
    toolOutputIdRef.current = null
    setActiveAgencyRole(null)
    setContextHealth(null)

    if (!activeModel) {
      addFeedItem({ id: crypto.randomUUID(), type: 'error', content: 'No model loaded.', timestamp: Date.now() })
      setIsRunning(false)
      return
    }

    const workspaceDir = options?.getWorkspaceDir?.()
    if (!workspaceDir) {
      addFeedItem({ id: crypto.randomUUID(), type: 'error', content: 'No workspace directory set. Go to Settings → Codebase Index first.', timestamp: Date.now() })
      setIsRunning(false)
      return
    }

    const { url, body } = apiClient.terminal.planUrl(input, activeModel.id, workspaceDir)
    await consumeSSE(url, body)

    setIsRunning(false)
    aiTextIdRef.current = null
    toolOutputIdRef.current = null
    setActiveAgencyRole(null)
  }, [isRunning, activeModel, addFeedItem, consumeSSE, options])

  const handlePlanDecision = useCallback(async (sessionId: string, approved: boolean, modifications?: PlanStep[]) => {
    try {
      await apiClient.terminal.decidePlan(sessionId, approved, modifications)
    } catch {
      addFeedItem({ id: crypto.randomUUID(), type: 'error', content: 'Failed to send plan decision', timestamp: Date.now() })
    }
  }, [addFeedItem])

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

  const handleUndo = useCallback(async () => {
    if (!sessionId || isRunning) return
    try {
      const result = await apiClient.terminal.undo(sessionId)
      addFeedItem({
        id: crypto.randomUUID(),
        type: 'info' as const,
        content: `Undone: ${result.file_path}`,
        timestamp: Date.now(),
      })
    } catch {
      addFeedItem({
        id: crypto.randomUUID(),
        type: 'error' as const,
        content: 'Nothing to undo',
        timestamp: Date.now(),
      })
    }
  }, [sessionId, isRunning, addFeedItem])

  return {
    feedItems,
    isRunning,
    sessionId,
    telemetry,
    activeModel,
    agentMode,
    setAgentMode,
    handleSubmit,
    handlePlanSubmit,
    handlePlanDecision,
    handleStop,
    handleUndo,
    activeAgencyRole,
    handleDiffDecided,
    handleEscalationResponded,
    clearHistory,
    pinnedItems,
    togglePin,
    scoutIssues,
    contextHealth,
    promptProfile,
  }
}
