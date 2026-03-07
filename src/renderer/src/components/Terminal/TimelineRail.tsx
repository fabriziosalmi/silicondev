import { useState, useCallback } from 'react'
import { RotateCcw } from 'lucide-react'
import { apiClient } from '../../api/client'

export interface Checkpoint {
  index: number
  file_path: string
  tool: string
  timestamp: number
}

interface TimelineRailProps {
  checkpoints: Checkpoint[]
  sessionId: string
  onRollback: (index: number, files: string[]) => void
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function shortPath(p: string): string {
  const parts = p.split('/')
  return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : p
}

export function TimelineRail({ checkpoints, sessionId, onRollback }: TimelineRailProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null)
  const [rolling, setRolling] = useState(false)

  const handleRollback = useCallback(async (index: number) => {
    if (rolling) return
    setRolling(true)
    try {
      const result = await apiClient.terminal.rollbackTo(sessionId, index)
      onRollback(index, result.files)
      setConfirmIdx(null)
    } catch {
      // ignore
    } finally {
      setRolling(false)
    }
  }, [sessionId, rolling, onRollback])

  if (checkpoints.length === 0) return null

  return (
    <div className="w-8 shrink-0 flex flex-col items-center py-3 relative select-none">
      {/* Vertical line */}
      <div className="absolute top-3 bottom-3 w-px bg-white/[0.06]" />

      {checkpoints.map((cp, i) => {
        const isLast = i === checkpoints.length - 1
        const isHovered = hoveredIdx === i
        const isConfirming = confirmIdx === i

        return (
          <div
            key={cp.index}
            className="relative flex items-center justify-center mb-auto first:mt-0"
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => { setHoveredIdx(null); if (!isConfirming) setConfirmIdx(null) }}
          >
            {/* Dot */}
            <button
              type="button"
              onClick={() => {
                if (isConfirming) {
                  handleRollback(cp.index)
                } else {
                  setConfirmIdx(i)
                }
              }}
              disabled={rolling || isLast}
              className={`
                relative z-10 rounded-full transition-all duration-200
                ${isLast
                  ? 'w-2.5 h-2.5 bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.3)]'
                  : isConfirming
                    ? 'w-3 h-3 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.3)]'
                    : isHovered
                      ? 'w-2.5 h-2.5 bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.2)]'
                      : 'w-1.5 h-1.5 bg-gray-600 hover:bg-gray-500'
                }
                ${!isLast && !rolling ? 'cursor-pointer' : 'cursor-default'}
              `}
              title={isLast ? 'Current state' : `Rollback to checkpoint ${cp.index}`}
            />

            {/* Tooltip — positioned to the left of the dot */}
            {(isHovered || isConfirming) && (
              <div className="absolute right-full mr-2 whitespace-nowrap z-20">
                <div className={`
                  rounded-md px-2 py-1.5 text-[9px] font-mono
                  border backdrop-blur-sm shadow-lg
                  ${isConfirming
                    ? 'bg-amber-950/90 border-amber-500/30 text-amber-200'
                    : 'bg-gray-950/90 border-white/10 text-gray-300'
                  }
                `}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-500">{formatTime(cp.timestamp)}</span>
                    <span className="text-white/40">&middot;</span>
                    <span>{cp.tool.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="text-[8px] text-gray-500 mt-0.5 max-w-[180px] truncate">
                    {shortPath(cp.file_path)}
                  </div>
                  {isConfirming && !isLast && (
                    <div className="flex items-center gap-1 mt-1 pt-1 border-t border-amber-500/20 text-amber-300">
                      <RotateCcw size={8} />
                      <span>{rolling ? 'rolling back...' : 'click to confirm rollback'}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
