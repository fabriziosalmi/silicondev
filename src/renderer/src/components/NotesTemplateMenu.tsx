import { useState, useRef, useEffect } from 'react'
import { Plus, ChevronDown, FileText, CalendarDays, Users, FolderKanban } from 'lucide-react'
import { apiClient } from '../api/client'
import { useToast } from './ui/Toast'

interface NotesTemplateMenuProps {
    onNoteCreated: (noteId: string) => void
    /** Called after a new note is created so the parent can refresh its list. */
    onAfterCreate?: () => void
    /** Quick blank-note action that doesn't hit the network — for parity with the old `+` button. */
    onBlankNote: () => void
}

interface Template {
    id: string
    label: string
    icon: typeof FileText
    /** Produces (title, content). Lazy so timestamps reflect the click time, not mount time. */
    build: () => { title: string; content: string }
}

function today(): string {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${dd}`
}

const TEMPLATES: Template[] = [
    {
        id: 'daily',
        label: 'Daily log',
        icon: CalendarDays,
        build: () => ({
            title: `Daily — ${today()}`,
            content: `# ${today()}\n\n## Tasks\n- [ ] \n\n## Notes\n\n## Wins\n\n## Tomorrow\n- [ ] \n`,
        }),
    },
    {
        id: 'meeting',
        label: 'Meeting',
        icon: Users,
        build: () => ({
            title: `Meeting — ${today()}`,
            content: `# Meeting — ${today()}\n\n**Attendees:** \n\n## Agenda\n1. \n\n## Discussion\n\n## Action items\n- [ ] \n\n## Decisions\n\n`,
        }),
    },
    {
        id: 'project',
        label: 'Project brief',
        icon: FolderKanban,
        build: () => ({
            title: 'Project — ',
            content: `# Project\n\n## Goal\n\n## Scope\n\n## Milestones\n- [ ] \n\n## Open questions\n\n## Risks\n\n`,
        }),
    },
]

export function NotesTemplateMenu({ onNoteCreated, onAfterCreate, onBlankNote }: NotesTemplateMenuProps) {
    const { toast } = useToast()
    const [open, setOpen] = useState(false)
    const [creating, setCreating] = useState<string | null>(null)
    const wrapperRef = useRef<HTMLDivElement>(null)

    // Close on outside click + Escape
    useEffect(() => {
        if (!open) return
        const onClickAway = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
        }
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', onClickAway)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onClickAway)
            document.removeEventListener('keydown', onKey)
        }
    }, [open])

    const handleTemplate = async (tpl: Template) => {
        if (creating) return
        setCreating(tpl.id)
        try {
            const { title, content } = tpl.build()
            const note = await apiClient.notes.create(title, content)
            onNoteCreated(note.id)
            onAfterCreate?.()
            setOpen(false)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Failed to create note from template', 'error')
        } finally {
            setCreating(null)
        }
    }

    return (
        <div ref={wrapperRef} className="relative flex items-center">
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onBlankNote() }}
                title="New blank note"
                className="p-1 text-foreground-muted hover:text-foreground hover:bg-active rounded-l transition-colors"
            >
                <Plus size={14} />
            </button>
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
                title="New from template"
                aria-expanded={open}
                className="p-1 -ml-0.5 text-foreground-muted hover:text-foreground hover:bg-active rounded-r transition-colors"
            >
                <ChevronDown size={10} />
            </button>
            {open && (
                <div
                    className="absolute top-full right-0 mt-1 w-44 bg-overlay border border-outline rounded-lg shadow-xl py-1 z-dropdown"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="px-2 py-1 text-[9px] font-bold tracking-wider uppercase text-foreground-subtle">From template</div>
                    {TEMPLATES.map(tpl => {
                        const Icon = tpl.icon
                        const isCreating = creating === tpl.id
                        return (
                            <button
                                key={tpl.id}
                                type="button"
                                onClick={() => handleTemplate(tpl)}
                                disabled={isCreating}
                                className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-foreground-secondary hover:bg-hover hover:text-foreground transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Icon size={11} className="text-foreground-muted shrink-0" />
                                <span>{tpl.label}</span>
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
