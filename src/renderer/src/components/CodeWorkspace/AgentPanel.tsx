import { useCallback, useEffect } from 'react'
import { Trash2, AlertCircle, Bot, Cpu, Clock, Undo2, Eye, Pencil, Brain, Zap, Search, ShieldCheck, Database } from 'lucide-react'
import { type ActiveFileContext } from './useAgentSession'
import { AgentInputBar } from './AgentInputBar'
import { MessageFeed } from '../Terminal/MessageFeed'
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

export function AgentPanel({ onDiffSynced, onRegisterDiffDecider, session }: AgentPanelProps & { session: any }) {
  const {
    feedItems,
    isRunning,
    sessionId,
    telemetry,
    activeModel,
    handleSubmit,
    handleStop,
    handleDiffDecided: rawHandleDiffDecided,
    handleEscalationResponded,
    handleUndo,
    agentMode,
    setAgentMode,
    clearHistory,
    activeAgencyRole,
    contextHealth,
  } = session

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

  return (
    <div className="h-full flex flex-col">
      {/* Header with inline telemetry */}
      <div className="border-b border-white/[0.04] bg-black/30 shrink-0">
        <div className="flex items-center justify-between px-3 py-1.5">
          <div className="flex items-center gap-2 font-mono text-xs">
            <Bot size={13} className="text-blue-400" />
            <span className="text-blue-400">nanocore</span>
            <span className="text-gray-600">@</span>
            <span className="text-gray-400 truncate max-w-[100px]">{activeModel?.name ?? '?'}</span>
            {isRunning && <span className="inline-block w-1.5 h-3 bg-blue-400 animate-pulse rounded-sm" />}
          </div>
          <div className="flex items-center gap-2">
            {contextHealth && (
              <div
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/40 border border-white/10"
                title={`Context Usage: ${contextHealth.used_tokens} / ${contextHealth.max_tokens} tokens`}
              >
                <Database size={10} className={contextHealth.used_tokens / contextHealth.max_tokens > 0.8 ? "text-red-400" : "text-gray-400"} />
                <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${contextHealth.used_tokens / contextHealth.max_tokens > 0.8 ? "bg-red-500" : "bg-blue-500"}`}
                    style={{ width: `${Math.min(100, Math.max(0, (contextHealth.used_tokens / contextHealth.max_tokens) * 100))}%` }}
                  />
                </div>
              </div>
            )}
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-bold text-emerald-400 uppercase tracking-tight">
              <ShieldCheck size={10} />
              <span>Local Execution Only</span>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setAgentMode(agentMode === 'edit' ? 'review' : 'edit')}
                className={`p-1 rounded-lg transition-colors ${agentMode === 'review'
                  ? 'text-emerald-400 bg-emerald-500/10'
                  : 'text-gray-600 hover:text-blue-400 hover:bg-white/5'
                  }`}
                title={agentMode === 'review' ? 'Review mode (read-only)' : 'Edit mode'}
              >
                {agentMode === 'review' ? <Eye size={12} /> : <Pencil size={12} />}
              </button>
              {feedItems.length > 0 && !isRunning && sessionId && (
                <button
                  type="button"
                  onClick={handleUndo}
                  className="p-1 text-gray-600 hover:text-amber-400 hover:bg-white/5 rounded-lg transition-colors"
                  title="Undo last edit"
                >
                  <Undo2 size={12} />
                </button>
              )}
              {feedItems.length > 0 && !isRunning && (
                <button
                  type="button"
                  onClick={clearHistory}
                  className="p-1 text-gray-600 hover:text-red-400 hover:bg-white/5 rounded-lg transition-colors"
                  title="Clear history"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
        {/* Compact telemetry bar — visible when running or after a run */}
        {(isRunning || telemetry.tokensUsed > 0) && (
          <div className="flex items-center gap-3 px-3 py-1 border-t border-white/[0.03] text-[10px] text-gray-500 font-mono">
            <div className="flex items-center gap-1">
              <Cpu size={9} className="shrink-0" />
              <span>{telemetry.tokensUsed.toLocaleString()} tok</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock size={9} className="shrink-0" />
              <span>{formatMs(telemetry.elapsedMs)}</span>
            </div>
            {telemetry.iteration > 0 && (
              <span>iter {telemetry.iteration}</span>
            )}
            {telemetry.tokenBudget > 0 && (
              <div className="flex-1 flex items-center gap-1.5 ml-auto">
                <span className="text-[9px] uppercase text-gray-600 font-bold">Budget</span>
                <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden max-w-[40px]">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${telemetry.budgetFraction > 0.9 ? 'bg-red-500' :
                      telemetry.budgetFraction > 0.7 ? 'bg-yellow-500' :
                        'bg-blue-500'
                      }`}
                    style={{ width: `${Math.min(100, telemetry.budgetFraction * 100)}%` }}
                  />
                </div>
              </div>
            )}
            {activeModel?.context_window && (
              <div className="flex items-center gap-1.5 border-l border-white/[0.05] pl-3">
                <span className="text-[9px] uppercase text-gray-600 font-bold">Context</span>
                <div className="w-[60px] h-1 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500/50 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (telemetry.tokensUsed / activeModel.context_window) * 100)}%` }}
                  />
                </div>
                <span>{Math.round((telemetry.tokensUsed / activeModel.context_window) * 100)}%</span>
              </div>
            )}
          </div>
        )}

        {/* Agency HUD */}
        {isRunning && activeAgencyRole && (
          <div className="px-3 py-2 border-t border-white/[0.03] bg-blue-500/[0.02]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold">Agency Status</span>
              <span className="text-[10px] text-blue-400 font-medium animate-pulse">{activeAgencyRole.status}</span>
            </div>
            <div className="flex items-center gap-4">
              <div className={`flex flex-col items-center gap-1 transition-opacity duration-300 ${activeAgencyRole.role === 'architetto' ? 'opacity-100' : 'opacity-30'}`}>
                <div className={`p-1.5 rounded-lg ${activeAgencyRole.role === 'architetto' ? 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30' : 'bg-white/5 text-gray-500'}`}>
                  <Brain size={14} />
                </div>
                <span className="text-[8px] font-medium uppercase tracking-tighter">Architetto</span>
              </div>
              <div className="h-4 w-[1px] bg-white/[0.05]" />
              <div className={`flex flex-col items-center gap-1 transition-opacity duration-300 ${activeAgencyRole.role === 'operaio' ? 'opacity-100' : 'opacity-30'}`}>
                <div className={`p-1.5 rounded-lg ${activeAgencyRole.role === 'operaio' ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30' : 'bg-white/5 text-gray-500'}`}>
                  <Zap size={14} />
                </div>
                <span className="text-[8px] font-medium uppercase tracking-tighter">Operaio</span>
              </div>
              <div className="h-4 w-[1px] bg-white/[0.05]" />
              <div className={`flex flex-col items-center gap-1 transition-opacity duration-300 ${activeAgencyRole.role === 'ispettore' ? 'opacity-100' : 'opacity-30'}`}>
                <div className={`p-1.5 rounded-lg ${activeAgencyRole.role === 'ispettore' ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30' : 'bg-white/5 text-gray-500'}`}>
                  <Search size={14} />
                </div>
                <span className="text-[8px] font-medium uppercase tracking-tighter">Ispettore</span>
              </div>
            </div>
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
        <MessageFeed
          items={feedItems}
          sessionId={sessionId}
          onDiffDecided={handleDiffDecided}
          onEscalationResponded={handleEscalationResponded}
        />
        <AgentInputBar
          onSubmit={handleSubmit}
          onStop={handleStop}
          isRunning={isRunning}
          disabled={!activeModel}
        />
      </div>
    </div>
  )
}
