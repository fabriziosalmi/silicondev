import { Suspense, lazy, useState } from 'react'
import { Check, X, Loader2 } from 'lucide-react'

const MonacoDiffEditor = lazy(() =>
  import('@monaco-editor/react').then(mod => ({ default: mod.DiffEditor }))
)

interface DiffEditorProps {
  filePath: string
  originalContent: string
  modifiedContent: string
  language: string
  onApprove: () => void
  onReject: (reason?: string) => void
}

function DiffFallback() {
  return (
    <div className="flex items-center justify-center h-full bg-[#1e1e1e]">
      <div className="flex items-center gap-2 text-gray-500 text-sm">
        <Loader2 size={16} className="animate-spin" />
        Loading diff editor...
      </div>
    </div>
  )
}

export function DiffEditor({ filePath, originalContent, modifiedContent, language, onApprove, onReject }: DiffEditorProps) {
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [deciding, setDeciding] = useState(false)

  const handleApprove = () => {
    if (deciding) return
    setDeciding(true)
    onApprove()
  }

  const handleReject = () => {
    if (deciding) return
    setDeciding(true)
    onReject(rejectReason.trim() || undefined)
  }

  const name = filePath.split('/').pop() || filePath

  return (
    <div className="h-full flex flex-col">
      {/* Diff header */}
      <div className="px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2 shrink-0">
        <span className="text-[11px] font-medium text-amber-400">Proposed changes to</span>
        <span className="text-[11px] font-mono text-amber-300">{name}</span>
      </div>

      {/* Monaco diff */}
      <div className="flex-1 min-h-0">
        <Suspense fallback={<DiffFallback />}>
          <MonacoDiffEditor
            height="100%"
            language={language}
            original={originalContent}
            modified={modifiedContent}
            theme="vs-dark"
            options={{
              readOnly: true,
              fontSize: 13,
              fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', monospace",
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              padding: { top: 8 },
              renderSideBySide: true,
              automaticLayout: true,
            }}
          />
        </Suspense>
      </div>

      {/* Action bar */}
      <div className="px-3 py-2 bg-black/30 border-t border-white/5 flex items-center gap-2 shrink-0">
        {showRejectInput ? (
          <>
            <input
              type="text"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleReject()
                if (e.key === 'Escape') { setShowRejectInput(false); setRejectReason('') }
              }}
              placeholder="Reason (optional, press Enter to reject)"
              className="flex-1 px-2 py-1 bg-black/40 border border-white/10 rounded text-[11px] text-gray-300 placeholder-gray-600 outline-none focus:border-red-500/40"
              autoFocus
            />
            <button
              type="button"
              onClick={handleReject}
              disabled={deciding}
              className="px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-[11px] font-medium rounded transition-colors disabled:opacity-50"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => { setShowRejectInput(false); setRejectReason('') }}
              className="px-2 py-1 text-gray-500 hover:text-gray-300 text-[11px] transition-colors"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={handleApprove}
              disabled={deciding}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/20 hover:bg-green-500/30 text-green-400 text-[11px] font-medium rounded transition-colors disabled:opacity-50"
            >
              <Check size={12} />
              Apply Changes
            </button>
            <button
              type="button"
              onClick={() => setShowRejectInput(true)}
              disabled={deciding}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[11px] font-medium rounded transition-colors disabled:opacity-50"
            >
              <X size={12} />
              Reject
            </button>
            <span className="ml-auto text-[10px] text-gray-600">Review the proposed changes above</span>
          </>
        )}
      </div>
    </div>
  )
}
