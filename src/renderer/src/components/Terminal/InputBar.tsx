import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, Square } from 'lucide-react'

export type TerminalMode = 'terminal' | 'agent'

interface InputBarProps {
  onSubmit: (prompt: string) => void
  onStop: () => void
  isRunning: boolean
}

export function InputBar({ onSubmit, onStop, isRunning }: InputBarProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const savedInputRef = useRef('')

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [value])

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || isRunning) return
    // Add to history (avoid duplicating the last entry)
    if (historyRef.current[historyRef.current.length - 1] !== trimmed) {
      historyRef.current.push(trimmed)
    }
    historyIndexRef.current = -1
    savedInputRef.current = ''
    onSubmit(trimmed)
    setValue('')
    textareaRef.current?.focus()
  }, [value, isRunning, onSubmit])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
      return
    }

    // Command history: up/down arrows
    const history = historyRef.current
    if (e.key === 'ArrowUp' && !e.shiftKey) {
      if (history.length === 0) return
      e.preventDefault()
      if (historyIndexRef.current === -1) {
        savedInputRef.current = value
        historyIndexRef.current = history.length - 1
      } else if (historyIndexRef.current > 0) {
        historyIndexRef.current--
      }
      setValue(history[historyIndexRef.current])
    } else if (e.key === 'ArrowDown' && !e.shiftKey) {
      if (historyIndexRef.current === -1) return
      e.preventDefault()
      if (historyIndexRef.current < history.length - 1) {
        historyIndexRef.current++
        setValue(history[historyIndexRef.current])
      } else {
        historyIndexRef.current = -1
        setValue(savedInputRef.current)
      }
    }
  }

  const canSend = value.trim().length > 0 && !isRunning

  return (
    <div className="px-4 py-3 bg-black/20">
      <div className="flex items-end gap-2 bg-white/[0.04] border border-white/[0.06] rounded-xl px-3 py-2 focus-within:border-green-500/30 transition-colors">
        <span className="text-sm font-mono shrink-0 pb-0.5 select-none text-green-400/60">
          $
        </span>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => { setValue(e.target.value); historyIndexRef.current = -1 }}
          onKeyDown={handleKeyDown}
          placeholder={isRunning ? t('code.running') : t('terminal.placeholder')}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none select-text font-mono leading-relaxed"
        />

        {isRunning ? (
          <button
            type="button"
            onClick={onStop}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
            title={t('terminal.stop')}
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
                ? 'bg-green-500 text-white hover:bg-green-400'
                : 'bg-white/5 text-gray-600'
            }`}
            title={t('terminal.send')}
          >
            <ArrowUp size={14} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  )
}
