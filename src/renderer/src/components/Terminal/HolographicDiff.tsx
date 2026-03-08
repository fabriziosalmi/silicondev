import { useState, useEffect, useRef } from 'react'
import { Check, X, Send, ChevronRight } from 'lucide-react'
import { apiClient } from '../../api/client'
import type { DiffMetadata } from './types'

interface HolographicDiffProps {
  meta: DiffMetadata
  sessionId: string
  onDecided: (callId: string, approved: boolean, reason?: string) => void
}

export function HolographicDiff({ meta, sessionId, onDecided }: HolographicDiffProps) {
  const [deciding, setDeciding] = useState(false)
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const isPending = meta.status === 'pending'
  const [expanded, setExpanded] = useState(true)
  const prevStatusRef = useRef(meta.status)

  useEffect(() => {
    if (prevStatusRef.current === 'pending' && meta.status !== 'pending') {
      setExpanded(false)
    }
    prevStatusRef.current = meta.status
  }, [meta.status])

  const handleDecide = async (approved: boolean, reason: string = '') => {
    if (deciding) return
    setDeciding(true)
    try {
      await apiClient.terminal.decideDiff(sessionId, meta.callId, approved, reason)
      onDecided(meta.callId, approved, reason)
    } catch {
      onDecided(meta.callId, approved, reason)
    } finally {
      setDeciding(false)
      setShowRejectInput(false)
      setExpanded(false)
    }
  }

  const handleRejectClick = () => {
    setShowRejectInput(true)
  }

  const handleRejectSubmit = () => {
    handleDecide(false, rejectReason.trim())
  }

  const handleRejectKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleRejectSubmit()
    }
    if (e.key === 'Escape') {
      setShowRejectInput(false)
      setRejectReason('')
    }
  }

  const diffLines = meta.diff.split('\n')

  // Count additions and deletions for summary
  let additions = 0
  let deletions = 0
  for (const line of diffLines) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++
  }

  return (
    <div className={`rounded-[10px] border overflow-hidden ${
      isPending
        ? 'border-blue-500/30 shadow-[0_0_8px_rgba(59,130,246,0.08)]'
        : meta.status === 'approved'
          ? 'border-green-500/20'
          : 'border-red-500/20'
    }`}>
      {/* Header */}
      <div
        className={`flex items-center justify-between px-3 py-2 bg-white/[0.02] ${expanded ? 'border-b border-white/[0.04]' : ''} ${!isPending ? 'cursor-pointer hover:bg-white/[0.04]' : ''}`}
        onClick={() => { if (!isPending) setExpanded(!expanded) }}
        onKeyDown={!isPending ? (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded) } } : undefined}
      >
        <div className="flex items-center gap-2 min-w-0">
          {!isPending && (
            <ChevronRight
              size={11}
              className={`text-gray-600 transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`}
            />
          )}
          <span className="text-[11px] text-gray-300 font-mono truncate">{meta.filePath}</span>
          <span className="text-[9px] shrink-0 flex items-center gap-1">
            {additions > 0 && <span className="text-green-500">+{additions}</span>}
            {deletions > 0 && <span className="text-red-500">-{deletions}</span>}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {isPending && !showRejectInput ? (
            <>
              <button
                onClick={() => handleDecide(true)}
                disabled={deciding}
                className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide rounded-md bg-green-600/90 hover:bg-green-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check size={10} strokeWidth={3} /> Approve
              </button>
              <button
                onClick={handleRejectClick}
                disabled={deciding}
                className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide rounded-md bg-red-600/90 hover:bg-red-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X size={10} strokeWidth={3} /> Reject
              </button>
            </>
          ) : isPending && showRejectInput ? null : (
            <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md ${
              meta.status === 'approved' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
            }`}>
              {meta.status === 'approved' ? 'Approved' : 'Rejected'}
            </span>
          )}
        </div>
      </div>

      {/* Reject reason input */}
      {expanded && showRejectInput && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-500/[0.03] border-b border-red-500/10">
          <input
            type="text"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            onKeyDown={handleRejectKeyDown}
            placeholder="Why? (optional, Enter to send)"
            autoFocus
            className="flex-1 bg-black/30 border border-white/10 rounded-md px-2 py-1 text-[11px] font-mono text-white placeholder-gray-600 focus:outline-none focus:border-red-500/40"
          />
          <button
            onClick={handleRejectSubmit}
            disabled={deciding}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-md bg-red-600/80 hover:bg-red-500 text-white transition-colors disabled:opacity-50 shrink-0"
          >
            <Send size={9} /> Send
          </button>
          <button
            onClick={() => { setShowRejectInput(false); setRejectReason('') }}
            className="px-1.5 py-1 text-[10px] text-gray-500 hover:text-white transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Reject reason display */}
      {expanded && meta.status === 'rejected' && meta.rejectReason && (
        <div className="px-3 py-1.5 bg-red-500/[0.03] border-b border-red-500/10">
          <span className="text-[10px] text-red-400/70 font-mono">Reason: {meta.rejectReason}</span>
        </div>
      )}

      {/* Diff view */}
      {expanded && (
        <div className="overflow-x-auto max-h-[60vh] bg-black/40">
          <table className="w-full border-collapse">
            <tbody>
              {diffLines.map((line, i) => {
                let bg = ''
                let textColor = 'text-gray-500'
                let gutterColor = 'text-gray-700'
                let prefix = ' '
                if (line.startsWith('+++') || line.startsWith('---')) {
                  textColor = 'text-gray-600'
                  return null // skip file headers, we show the path in the card header
                } else if (line.startsWith('+')) {
                  bg = 'bg-green-500/[0.07]'
                  textColor = 'text-green-400/90'
                  gutterColor = 'text-green-600/60'
                  prefix = '+'
                } else if (line.startsWith('-')) {
                  bg = 'bg-red-500/[0.07]'
                  textColor = 'text-red-400/90'
                  gutterColor = 'text-red-600/60'
                  prefix = '-'
                } else if (line.startsWith('@@')) {
                  textColor = 'text-blue-400/70'
                  gutterColor = 'text-blue-500/40'
                  prefix = '@'
                }
                return (
                  <tr key={i} className={bg}>
                    <td className={`w-5 text-right pr-2 pl-2 select-none ${gutterColor} text-[9px] font-mono align-top leading-[15px]`}>
                      {prefix !== ' ' && prefix !== '@' ? prefix : ''}
                    </td>
                    <td className={`${textColor} text-[10px] font-mono pr-3 whitespace-pre select-text leading-[15px]`}>
                      {line.startsWith('@@') ? line : (line.slice(1) || ' ')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
