import { useEffect, useRef, useState } from 'react'
import { X, Send } from 'lucide-react'
import { apiClient } from '../api/client'
import { useToast } from './ui/Toast'
import { useFocusTrap } from '../hooks/useFocusTrap'

interface QuickCaptureModalProps {
    isOpen: boolean
    onClose: () => void
    /** Called when a note is saved so the host can refresh its list. */
    onSaved?: (noteId: string) => void
}

/**
 * Distraction-free scratchpad: opens anywhere with Cmd/Ctrl+Shift+N, saves
 * to the notes backend, then closes. Cmd/Ctrl+Enter submits, Esc cancels.
 */
export function QuickCaptureModal({ isOpen, onClose, onSaved }: QuickCaptureModalProps) {
    const { toast } = useToast()
    const [body, setBody] = useState('')
    const [saving, setSaving] = useState(false)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const trapRef = useFocusTrap(isOpen)

    // Reset + focus when opening
    useEffect(() => {
        if (!isOpen) return
        setBody('')
        setSaving(false)
        const t = setTimeout(() => textareaRef.current?.focus(), 30)
        return () => clearTimeout(t)
    }, [isOpen])

    // Esc to close
    useEffect(() => {
        if (!isOpen) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [isOpen, onClose])

    const handleSave = async () => {
        const text = body.trim()
        if (!text || saving) return
        setSaving(true)
        try {
            const firstLine = text.split('\n').find(l => l.trim().length > 0) || 'Quick note'
            const title = firstLine.replace(/^#+\s*/, '').slice(0, 80)
            const note = await apiClient.notes.create(title, text)
            toast('Captured', 'success')
            onSaved?.(note.id)
            onClose()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Failed to save quick note', 'error')
        } finally {
            setSaving(false)
        }
    }

    if (!isOpen) return null

    return (
        <div
            className="fixed inset-0 z-modal flex items-start justify-center pt-[15vh] px-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
        >
            <div
                ref={trapRef}
                tabIndex={-1}
                className="w-full max-w-xl bg-overlay border border-outline rounded-xl shadow-2xl shadow-black/60 overflow-hidden outline-none animate-in zoom-in-95 duration-150"
                role="dialog"
                aria-modal="true"
                aria-label="Quick capture"
            >
                <div className="flex items-center justify-between px-3.5 py-2 border-b border-outline-subtle">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">Quick capture</span>
                        <span className="text-[10px] text-foreground-subtle font-mono">⌘⏎ save · Esc close</span>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1 text-foreground-muted hover:text-foreground rounded transition-colors"
                        aria-label="Close"
                    >
                        <X size={14} />
                    </button>
                </div>
                <textarea
                    ref={textareaRef}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                            e.preventDefault()
                            handleSave()
                        }
                    }}
                    placeholder="Type anything. First non-empty line becomes the title."
                    rows={8}
                    className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground-subtle outline-none resize-none px-4 py-3 font-mono leading-relaxed"
                />
                <div className="flex items-center justify-between px-3.5 py-2 border-t border-outline-subtle bg-hover">
                    <span className="text-[10px] text-foreground-subtle font-mono tabular-nums">
                        {body.length} chars · {body.trim() ? body.trim().split(/\s+/).length : 0} words
                    </span>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={!body.trim() || saving}
                        className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded bg-accent hover:bg-accent-hover text-accent-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Send size={11} />
                        {saving ? 'Saving…' : 'Save note'}
                    </button>
                </div>
            </div>
        </div>
    )
}
