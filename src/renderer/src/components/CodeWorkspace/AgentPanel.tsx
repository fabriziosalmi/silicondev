import { useCallback, useEffect, useState, useMemo } from 'react'
import { Trash2, AlertCircle, Undo2, Eye, Pencil, Brain, Zap, Search, Shield } from 'lucide-react'
import { type ActiveFileContext } from './useAgentSession'
import { AgentInputBar } from './AgentInputBar'
import { PreLayerBar } from './PreLayerBar'
import { MessageFeed } from '../Terminal/MessageFeed'
import { TimelineRail, type Checkpoint } from '../Terminal/TimelineRail'
import { apiClient } from '../../api/client'
import type { DiffMetadata } from '../Terminal/types'

interface AgentPanelProps {
  onOpenFile: (path: string) => void
  onDiffProposal?: (filePath: string, meta: DiffMetadata) => void
  onDiffSynced?: (filePath: string, approved: boolean) => void
  onRegisterDiffDecider?: (decider: (callId: string, approved: boolean, reason?: string) => void) => void
  getActiveFile?: () => ActiveFileContext | null
  getWorkspaceDir?: () => string | null
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

const ROLE_ICONS = { architect: Brain, worker: Zap, inspector: Search } as const
const ROLE_COLORS = { architect: 'text-blue-400', worker: 'text-amber-400', inspector: 'text-emerald-400' } as const

export function AgentPanel({ onDiffSynced, onRegisterDiffDecider, session }: AgentPanelProps & { session: any }) {
  const {
    feedItems,
    isRunning,
    sessionId,
    telemetry,
    activeModel,
    handleSubmit,
    handlePlanSubmit,
    handlePlanDecision,
    handleStop,
    handleDiffDecided: rawHandleDiffDecided,
    handleEscalationResponded,
    handleUndo,
    agentMode,
    setAgentMode,
    clearHistory,
    activeAgencyRole,
    promptProfile,
  } = session

  // Cycling idle info (model name, context window, status)
  const [infoCycle, setInfoCycle] = useState(0)

  useEffect(() => {
    if (isRunning || !activeModel) { setInfoCycle(0); return }
    const id = setInterval(() => setInfoCycle(c => c + 1), 4000)
    return () => clearInterval(id)
  }, [isRunning, activeModel])

  const idleInfo = useMemo(() => {
    if (!activeModel) return [{ text: 'no model loaded', color: 'text-gray-500' }]
    const items: { text: string; color: string }[] = [
      { text: activeModel.name, color: 'text-gray-400' },
    ]
    if (activeModel.context_window) {
      items.push({ text: `${(activeModel.context_window / 1024).toFixed(0)}K context`, color: 'text-gray-500' })
    }
    if (feedItems.length > 0 && sessionId && !isRunning) {
      items.push({ text: 'ready', color: 'text-emerald-400/70' })
    }
    return items
  }, [activeModel, feedItems.length, sessionId, isRunning])

  const statusInfo = useMemo(() => {
    if (isRunning) {
      if (activeAgencyRole?.status) return { text: activeAgencyRole.status, color: 'text-blue-400' }
      return { text: 'working...', color: 'text-blue-400' }
    }
    return idleInfo[infoCycle % idleInfo.length]
  }, [isRunning, activeAgencyRole, idleInfo, infoCycle])

  // Wrap handleDiffDecided to also sync with CodeWorkspace (DiffEditor)
  const handleDiffDecided = useCallback((callId: string, approved: boolean, reason?: string) => {
    rawHandleDiffDecided(callId, approved, reason)
    // Find filePath from feed items
    const item = feedItems.find((it: any) => it.diffMeta?.callId === callId)
    if (item?.diffMeta?.filePath && onDiffSynced) {
      onDiffSynced(item.diffMeta.filePath, approved)
    }
  }, [rawHandleDiffDecided, feedItems, onDiffSynced])

  // Register diff decider so CodeWorkspace's DiffEditor can trigger approve/reject via the same backend API call
  useEffect(() => {
    onRegisterDiffDecider?.(handleDiffDecided)
  }, [handleDiffDecided, onRegisterDiffDecider])

  // Listen for context menu prompts from the Monaco editor
  useEffect(() => {
    const handler = (e: Event) => {
      const prompt = (e as CustomEvent).detail as string
      if (prompt && !isRunning && activeModel) {
        handleSubmit(prompt)
      }
    }
    window.addEventListener('nanocore-prompt', handler)
    return () => window.removeEventListener('nanocore-prompt', handler)
  }, [isRunning, activeModel, handleSubmit])

  // Commandment 8: Emergency Stop Shortcut (Cmd+Esc)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Escape') {
        if (isRunning) {
          e.preventDefault()
          handleStop()
        }
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [isRunning, handleStop])

  // Agency role icon for inline display
  const RoleIcon = activeAgencyRole?.role ? ROLE_ICONS[activeAgencyRole.role as keyof typeof ROLE_ICONS] : null
  const roleColor = activeAgencyRole?.role ? ROLE_COLORS[activeAgencyRole.role as keyof typeof ROLE_COLORS] : ''

  // Checkpoint timeline
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const prevRunningRef = useState(false)

  // Fetch checkpoints when a run finishes
  useEffect(() => {
    const wasRunning = prevRunningRef[0]
    prevRunningRef[0] = isRunning
    if (wasRunning && !isRunning && sessionId) {
      apiClient.terminal.getCheckpoints(sessionId)
        .then(setCheckpoints)
        .catch(() => {})
    }
  }, [isRunning, sessionId])

  // Clear checkpoints when history is cleared
  useEffect(() => {
    if (feedItems.length === 0) setCheckpoints([])
  }, [feedItems.length])

  const handleRollback = useCallback((_index: number, _files: string[]) => {
    // Refresh checkpoints after rollback
    if (sessionId) {
      apiClient.terminal.getCheckpoints(sessionId)
        .then(setCheckpoints)
        .catch(() => {})
    }
  }, [sessionId])

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-white/[0.04] bg-black/30 shrink-0">
        <div className="flex items-center justify-between px-3 py-1.5 gap-2">
          {/* Left: icon + dynamic status */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <img src="/icon.svg" alt="" className={`w-3.5 h-3.5 rounded-sm ${isRunning ? 'animate-pulse' : 'opacity-60'}`} />
            <span
              className={`text-[11px] font-mono truncate transition-colors duration-300 ${statusInfo.color}`}
              title={activeModel?.name ?? undefined}
            >
              {statusInfo.text}
            </span>
            {/* Inline role indicator when running */}
            {isRunning && RoleIcon && (
              <div className={`shrink-0 ${roleColor}`} title={activeAgencyRole?.role}>
                <RoleIcon size={11} />
              </div>
            )}
          </div>

          {/* Right: state indicators + actions */}
          <div className="flex items-center gap-1 shrink-0">
            <span title="Local execution"><Shield size={10} className="text-emerald-500/40" /></span>
            <button
              type="button"
              onClick={() => setAgentMode(agentMode === 'edit' ? 'review' : 'edit')}
              className={`p-1 rounded-md transition-colors ${agentMode === 'review'
                ? 'text-emerald-400 bg-emerald-500/10'
                : 'text-gray-600 hover:text-blue-400 hover:bg-white/5'
                }`}
              title={agentMode === 'review' ? 'Review mode' : 'Edit mode'}
            >
              {agentMode === 'review' ? <Eye size={11} /> : <Pencil size={11} />}
            </button>
            {feedItems.length > 0 && !isRunning && sessionId && (
              <button
                type="button"
                onClick={handleUndo}
                className="p-1 text-gray-600 hover:text-amber-400 hover:bg-white/5 rounded-md transition-colors"
                title="Undo last edit"
              >
                <Undo2 size={11} />
              </button>
            )}
            {feedItems.length > 0 && !isRunning && (
              <button
                type="button"
                onClick={clearHistory}
                className="p-1 text-gray-600 hover:text-red-400 hover:bg-white/5 rounded-md transition-colors"
                title="Clear history"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        </div>

        {/* Telemetry bar — visible when running or after a run */}
        {(isRunning || telemetry.tokensUsed > 0) && (
          <div className="flex items-center gap-2 px-3 py-1 border-t border-white/[0.03] text-[10px] text-gray-500 font-mono">
            <span>{telemetry.tokensUsed.toLocaleString()} tok</span>
            <span className="text-gray-700">&middot;</span>
            <span>{formatMs(telemetry.elapsedMs)}</span>
            {telemetry.iteration > 0 && (
              <>
                <span className="text-gray-700">&middot;</span>
                <span>iter {telemetry.iteration}</span>
              </>
            )}
            <div className="flex-1" />
            {telemetry.tokenBudget > 0 && (
              <div className="flex items-center gap-1">
                <div className="w-8 h-1 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${telemetry.budgetFraction > 0.9 ? 'bg-red-500' :
                      telemetry.budgetFraction > 0.7 ? 'bg-yellow-500' : 'bg-blue-500'
                      }`}
                    style={{ width: `${Math.min(100, telemetry.budgetFraction * 100)}%` }}
                  />
                </div>
              </div>
            )}
            {activeModel?.context_window && (
              <div className="flex items-center gap-1">
                <div className="w-8 h-1 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500/50 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (telemetry.tokensUsed / activeModel.context_window) * 100)}%` }}
                  />
                </div>
                <span className="text-[9px]">{Math.round((telemetry.tokensUsed / activeModel.context_window) * 100)}%</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* No model warning */}
      {!activeModel && (
        <div className="px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2 shrink-0">
          <AlertCircle size={12} className="text-amber-400 shrink-0" />
          <span className="text-[10px] text-amber-400">No model loaded — load one from the Models tab.</span>
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="flex-1 flex overflow-hidden min-h-0">
          <MessageFeed
            items={feedItems}
            sessionId={sessionId}
            onDiffDecided={handleDiffDecided}
            onEscalationResponded={handleEscalationResponded}
            onPlanDecision={handlePlanDecision}
          />
          {checkpoints.length > 0 && (
            <div className="border-l border-white/[0.04]">
              <TimelineRail
                checkpoints={checkpoints}
                sessionId={sessionId}
                onRollback={handleRollback}
              />
            </div>
          )}
        </div>
        {promptProfile && <PreLayerBar profile={promptProfile} />}
        <AgentInputBar
          onSubmit={handleSubmit}
          onPlanSubmit={handlePlanSubmit}
          onStop={handleStop}
          isRunning={isRunning}
          disabled={!activeModel}
        />
      </div>
    </div>
  )
}
