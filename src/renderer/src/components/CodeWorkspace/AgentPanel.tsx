import { useCallback, useState } from 'react'
import { Trash2, AlertCircle, Bot, PanelRightOpen, PanelRightClose } from 'lucide-react'
import { useAgentSession, type ActiveFileContext } from './useAgentSession'
import { AgentInputBar } from './AgentInputBar'
import { MessageFeed } from '../Terminal/MessageFeed'
import { TelemetrySidebar } from '../Terminal/TelemetrySidebar'
import type { DiffMetadata } from '../Terminal/types'

interface AgentPanelProps {
  onOpenFile: (path: string) => void
  onDiffProposal?: (filePath: string, meta: DiffMetadata) => void
  getActiveFile?: () => ActiveFileContext | null
}

export function AgentPanel({ onOpenFile, onDiffProposal, getActiveFile }: AgentPanelProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
    handleDiffDecided,
    handleEscalationResponded,
    clearHistory,
  } = useAgentSession({ onDiffProposal: handleDiffProposal, getActiveFile })

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.04] bg-black/30 shrink-0">
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
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1 text-gray-600 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            title={sidebarOpen ? 'Hide telemetry' : 'Show telemetry'}
          >
            {sidebarOpen ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
          </button>
        </div>
      </div>

      {/* No model warning */}
      {!activeModel && (
        <div className="px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2 shrink-0">
          <AlertCircle size={12} className="text-amber-400 shrink-0" />
          <span className="text-[10px] text-amber-400">No model loaded — load one from the Models tab.</span>
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
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
        <TelemetrySidebar telemetry={telemetry} isOpen={sidebarOpen} />
      </div>
    </div>
  )
}
