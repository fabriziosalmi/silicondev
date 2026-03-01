import { useState, useRef, useEffect } from 'react'
import { ArrowUp, Square, Terminal, Bot } from 'lucide-react'

export type TerminalMode = 'terminal' | 'agent'

interface InputBarProps {
  onSubmit: (prompt: string) => void
  onStop: () => void
  isRunning: boolean
  disabled?: boolean
  mode: TerminalMode
  onModeChange: (mode: TerminalMode) => void
}

export function InputBar({ onSubmit, onStop, isRunning, disabled, mode, onModeChange }: InputBarProps) {
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
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const canSend = value.trim().length > 0 && !disabled && !isRunning

  return (
    <div className="px-4 py-3 bg-black/20 space-y-2">
      {/* Mode toggle */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onModeChange('terminal')}
          disabled={isRunning}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
            mode === 'terminal'
              ? 'bg-white/10 text-white'
              : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
          } ${isRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <Terminal size={12} />
          Terminal
        </button>
        <button
          type="button"
          onClick={() => onModeChange('agent')}
          disabled={isRunning}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
            mode === 'agent'
              ? 'bg-blue-500/20 text-blue-400'
              : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
          } ${isRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <Bot size={12} />
          Agent
        </button>
      </div>

      {/* Input */}
      <div className="flex items-end gap-2 bg-white/[0.04] border border-white/[0.06] rounded-xl px-3 py-2 focus-within:border-blue-500/30 transition-colors">
        <span className={`text-sm font-mono shrink-0 pb-0.5 select-none ${mode === 'terminal' ? 'text-green-400/60' : 'text-blue-400/60'}`}>
          {mode === 'terminal' ? '$' : '>'}
        </span>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Load a model first...' : mode === 'terminal' ? 'Enter command...' : 'Ask NanoCore...'}
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
                ? mode === 'terminal' ? 'bg-green-500 text-white hover:bg-green-400' : 'bg-blue-500 text-white hover:bg-blue-400'
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
