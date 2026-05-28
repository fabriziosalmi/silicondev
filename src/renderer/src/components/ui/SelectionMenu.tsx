import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FilePlus2, Copy, Check, Loader2, X } from 'lucide-react'
import { apiClient } from '../../api/client'
import { useToast } from './Toast'

// Skip the menu when the user right-clicks inside one of these — native field
// menus or app-specific context menus take precedence.
const SKIP_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function getSelectionInfo(): { text: string; isCode: boolean; lang?: string } | null {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return null
    const text = sel.toString()
    if (!text.trim()) return null

    // Walk up from the anchor node looking for a CODE / PRE ancestor — if we
    // find one, treat the selection as code so it gets fenced in the note.
    let node: Node | null = sel.anchorNode
    let isCode = false
    let lang: string | undefined
    while (node && node !== document.body) {
        if (node.nodeType === 1) {
            const el = node as HTMLElement
            const tag = el.tagName
            if (tag === 'CODE' || tag === 'PRE') {
                isCode = true
                const cls = (el.className || '').match(/language-(\w+)/i)
                if (cls) lang = cls[1]
                break
            }
        }
        node = node.parentNode
    }
    return { text, isCode, lang }
}

function formatForNote(info: { text: string; isCode: boolean; lang?: string }): string {
    const ts = new Date().toISOString()
    const header = `> Saved from SiliconDev — ${ts}\n\n`
    if (info.isCode) {
        return header + '```' + (info.lang ?? '') + '\n' + info.text + '\n```\n'
    }
    return header + info.text + '\n'
}

function titleFromText(text: string): string {
    const firstLine = text.split('\n').find(l => l.trim().length > 0) || 'Snippet'
    const title = firstLine.trim().slice(0, 60)
    return title.length < firstLine.trim().length ? title + '…' : title
}

export function SelectionMenu() {
    const { toast } = useToast()
    const menuRef = useRef<HTMLDivElement | null>(null)
    const [open, setOpen] = useState(false)
    const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const [selection, setSelection] = useState<{ text: string; isCode: boolean; lang?: string } | null>(null)
    const [saving, setSaving] = useState(false)
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        const onContextMenu = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null
            if (target && SKIP_TAGS.has(target.tagName)) return
            // Allow inputs to keep their native context menu.
            if (target && target.isContentEditable) return

            const info = getSelectionInfo()
            if (!info) return

            e.preventDefault()
            // Pin the menu inside the viewport even at the right/bottom edges.
            const menuW = 220
            const menuH = 110
            const x = Math.min(e.clientX, window.innerWidth - menuW - 8)
            const y = Math.min(e.clientY, window.innerHeight - menuH - 8)
            setPos({ x, y })
            setSelection(info)
            setOpen(true)
            setCopied(false)
        }

        const onClickAnywhere = (e: MouseEvent) => {
            if (!open) return
            if (menuRef.current && menuRef.current.contains(e.target as Node)) return
            setOpen(false)
        }
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false)
        }

        document.addEventListener('contextmenu', onContextMenu)
        document.addEventListener('mousedown', onClickAnywhere)
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('contextmenu', onContextMenu)
            document.removeEventListener('mousedown', onClickAnywhere)
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [open])

    const handleSaveToNote = async () => {
        if (!selection) return
        setSaving(true)
        try {
            const note = await apiClient.notes.create(
                titleFromText(selection.text),
                formatForNote(selection)
            )
            toast(`Saved to note "${note.title}"`, 'success')
            setOpen(false)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Failed to save note', 'error')
        } finally {
            setSaving(false)
        }
    }

    const handleCopy = async () => {
        if (!selection) return
        try {
            await navigator.clipboard.writeText(selection.text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
        } catch {
            toast('Clipboard unavailable', 'error')
        }
    }

    if (!open || !selection) return null

    const charCount = selection.text.length
    return createPortal(
        <div
            ref={menuRef}
            style={{ left: pos.x, top: pos.y }}
            className="fixed z-dropdown w-[220px] bg-elevated border border-outline rounded-lg shadow-2xl shadow-black/40 overflow-hidden text-foreground text-[12px]"
        >
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-outline-subtle bg-hover text-[10px] text-foreground-muted uppercase tracking-wide">
                <span>{selection.isCode ? `Code · ${selection.lang ?? 'plain'}` : 'Selection'}</span>
                <div className="flex items-center gap-1">
                    <span className="font-mono text-foreground-subtle">{charCount} ch</span>
                    <button
                        type="button"
                        onClick={() => setOpen(false)}
                        aria-label="Close"
                        className="text-foreground-subtle hover:text-foreground-secondary"
                    >
                        <X size={11} />
                    </button>
                </div>
            </div>
            <button
                type="button"
                onClick={handleSaveToNote}
                disabled={saving}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {saving ? <Loader2 size={13} className="animate-spin text-accent" /> : <FilePlus2 size={13} className="text-accent" />}
                <span>Save to new note</span>
            </button>
            <button
                type="button"
                onClick={handleCopy}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-hover transition-colors"
            >
                {copied ? <Check size={13} className="text-success" /> : <Copy size={13} className="text-foreground-muted" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
        </div>,
        document.body
    )
}
