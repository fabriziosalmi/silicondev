import { useState, useRef, useEffect } from 'react'
import { ArrowUp, Square } from 'lucide-react'

interface AgentInputBarProps {
  onSubmit: (prompt: string) => void
  onStop: () => void
  isRunning: boolean
  disabled?: boolean
}

export function AgentInputBar({ onSubmit, onStop, isRunning, disabled }: AgentInputBarProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [value])

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (!trimmed || isRunning || disabled) return
    onSubmit(trimmed)
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

  return (
    <div className="px-3 py-2.5 bg-black/20 border-t border-white/5">
      <div className="flex items-end gap-2 bg-white/[0.04] border border-white/[0.06] rounded-xl px-3 py-2 focus-within:border-blue-500/30 transition-colors">
        <span className="text-sm font-mono shrink-0 pb-0.5 select-none text-blue-400/60">
          &gt;
        </span>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onMouseDown={(e) => e.stopPropagation()}
          onFocus={(e) => e.stopPropagation()}
          placeholder={disabled ? 'Load a model first...' : 'Ask the agent to edit code...'}
          disabled={disabled || isRunning}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none disabled:opacity-50 select-text font-mono leading-relaxed"
        />

        {isRunning ? (
          <button
            type="button"
            onClick={onStop}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
            title="Stop"
          >
            <Square size={12} />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSend}
            className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-150 ${
              canSend
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
