import { useState, useRef, useEffect } from 'react'
import { Sparkles, X, ArrowUp, Loader2 } from 'lucide-react'

interface InlineRewriteUIProps {
    selection: {
        startLine: number
        startColumn: number
        endLine: number
        endColumn: number
        text: string
    }
    onClose: () => void
    onSubmit: (prompt: string) => void
    isRunning: boolean
}

export function InlineRewriteUI({ selection, onClose, onSubmit, isRunning }: InlineRewriteUIProps) {
    const [value, setValue] = useState('')
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        inputRef.current?.focus()
    }, [])

    const handleSubmit = () => {
        const trimmed = value.trim()
        if (!trimmed || isRunning) return
        onSubmit(trimmed)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            handleSubmit()
        }
        if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
        }
    }

    return (
        <div className="flex flex-col gap-2 p-2 bg-[#1a1a1a] border border-blue-500/30 rounded-lg shadow-2xl glow-accent w-[400px]">
            <div className="flex items-center gap-2 px-2 py-1 border-b border-white/5">
                <Sparkles size={14} className="text-blue-400" />
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Inline Edit</span>
                <button
                    onClick={onClose}
                    className="ml-auto p-1 text-gray-500 hover:text-white transition-colors"
                >
                    <X size={14} />
                </button>
            </div>

            <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.06] rounded-md px-3 py-2 focus-within:border-blue-500/30 transition-colors">
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="What should I change?"
                    disabled={isRunning}
                    className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none disabled:opacity-50"
                />
                {isRunning ? (
                    <Loader2 size={16} className="text-blue-400 animate-spin" />
                ) : (
                    <button
                        onClick={handleSubmit}
                        disabled={!value.trim()}
                        className="p-1 rounded bg-blue-500 text-white hover:bg-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <ArrowUp size={14} />
                    </button>
                )}
            </div>

            <div className="px-2 pb-1 flex items-center justify-between">
                <span className="text-[10px] text-gray-500">
                    Lines {selection.startLine}-{selection.endLine}
                </span>
                <span className="text-[10px] text-gray-600">
                    Esc to cancel
                </span>
            </div>
        </div>
    )
}
