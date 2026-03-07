import { useState, useRef, useEffect } from 'react'
import { ArrowUp, Square } from 'lucide-react'

interface AgentInputBarProps {
  onSubmit: (prompt: string) => void
  onPlanSubmit?: (prompt: string) => void
  onStop: () => void
  isRunning: boolean
  disabled?: boolean
}

export function AgentInputBar({ onSubmit, onPlanSubmit, onStop, isRunning, disabled }: AgentInputBarProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [value])

  const isPlanMode = value.trimStart().startsWith('/plan ')

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (!trimmed || isRunning || disabled) return
    if (isPlanMode && onPlanSubmit) {
      onPlanSubmit(trimmed.replace(/^\/plan\s+/, ''))
    } else {
      onSubmit(trimmed)
    }
    setValue('')
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const canSend = value.trim().length > 0 && !disabled && !isRunning

  // Block all pointer/mouse events from reaching Monaco in capture phase
  const blockPropagation = (e: React.SyntheticEvent) => {
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
  }

  return (
    <div
      className="shrink-0 px-3 py-2.5 bg-black/20 border-t border-white/5"
      onPointerDownCapture={blockPropagation}
      onMouseDownCapture={blockPropagation}
      onClick={() => {
        if (!disabled && !isRunning) {
          textareaRef.current?.focus()
        }
      }}
    >
      <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.06] rounded-xl px-3 py-2 focus-within:border-blue-500/30 transition-colors">
        <span className={`text-[11px] font-mono shrink-0 select-none ${isPlanMode ? 'text-amber-400/80' : 'text-blue-400/60'}`}>
          {isPlanMode ? '⚡' : '>'}
        </span>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder={disabled ? 'Load a model first...' : 'Edit code... /plan for multi-file'}
          disabled={disabled || isRunning}
          rows={1}
          style={{ WebkitAppRegion: 'no-drag', WebkitUserSelect: 'text' } as React.CSSProperties}
          className="flex-1 resize-none bg-transparent text-[11px] text-white placeholder-gray-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed select-text font-mono leading-relaxed"
        />

        {isRunning ? (
          <button
            type="button"
            onClick={onStop}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/20 transition-all active:scale-95 animate-in fade-in zoom-in duration-200"
            title="Stop Generation (Cmd+Esc)"
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSend}
            className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-150 ${canSend
              ? 'bg-blue-500 text-white hover:bg-blue-400'
              : 'bg-white/5 text-gray-600'
              }`}
            title="Send (Enter)"
          >
            <ArrowUp size={14} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  )
}
