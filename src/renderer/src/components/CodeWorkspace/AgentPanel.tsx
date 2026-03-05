import { useCallback, useEffect } from 'react'
import { Trash2, AlertCircle, Bot, Cpu, Clock } from 'lucide-react'
import { useAgentSession, type ActiveFileContext } from './useAgentSession'
import { AgentInputBar } from './AgentInputBar'
import { MessageFeed } from '../Terminal/MessageFeed'
import type { DiffMetadata } from '../Terminal/types'

interface AgentPanelProps {
  onOpenFile: (path: string) => void
  onDiffProposal?: (filePath: string, meta: DiffMetadata) => void
  onDiffSynced?: (filePath: string, approved: boolean) => void
  getActiveFile?: () => ActiveFileContext | null
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

export function AgentPanel({ onOpenFile, onDiffProposal, onDiffSynced, getActiveFile }: AgentPanelProps) {
  const handleDiffProposal = useCallback((filePath: string, meta: { callId: string; filePath: string; oldContent: string; newContent: string; diff: string }) => {
    onOpenFile(filePath)
    onDiffProposal?.(filePath, {
      callId: meta.callId,
      filePath: meta.filePath,
      oldContent: meta.oldContent,
      newContent: meta.newContent,
      diff: meta.diff,
      status: 'pending',
    })
  }, [onOpenFile, onDiffProposal])

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
    clearHistory,
  } = useAgentSession({ onDiffProposal: handleDiffProposal, getActiveFile })

  // Wrap handleDiffDecided to also sync with CodeWorkspace (DiffEditor)
  const handleDiffDecided = useCallback((callId: string, approved: boolean, reason?: string) => {
    rawHandleDiffDecided(callId, approved, reason)
    // Find filePath from feed items
    const item = feedItems.find(it => it.diffMeta?.callId === callId)
    if (item?.diffMeta?.filePath && onDiffSynced) {
      onDiffSynced(item.diffMeta.filePath, approved)
    }
  }, [rawHandleDiffDecided, feedItems, onDiffSynced])

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
          <div className="flex items-center gap-0.5">
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
                <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden max-w-[60px]">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      telemetry.budgetFraction > 0.9 ? 'bg-red-500' :
                      telemetry.budgetFraction > 0.7 ? 'bg-yellow-500' :
                      'bg-blue-500'
                    }`}
                    style={{ width: `${Math.min(100, telemetry.budgetFraction * 100)}%` }}
                  />
                </div>
                <span>{Math.round(telemetry.budgetFraction * 100)}%</span>
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
