import { useMemo, useState } from 'react'
import { Pin, PinOff, Trash2, Edit3, Check, X, FileText, Search } from 'lucide-react'
import type { NoteSummary } from '../api/client'
import { formatTimeAgo } from '../utils/time'

interface NoteListPanelProps {
    notes: NoteSummary[]
    activeId: string | null
    onSelect: (id: string) => void
    onDelete: (id: string) => void
    onRename: (id: string, title: string) => void
    onTogglePin: (id: string, pinned: boolean) => void
    renamingId: string | null
    renameValue: string
    onStartRename: (id: string, title: string) => void
    onCancelRename: () => void
    onRenameValueChange: (value: string) => void
    loading: boolean
}

export function NoteListPanel({
    notes,
    activeId,
    onSelect,
    onDelete,
    onRename,
    onTogglePin,
    renamingId,
    renameValue,
    onStartRename,
    onCancelRename,
    onRenameValueChange,
    loading,
}: NoteListPanelProps) {
    const [search, setSearch] = useState('')
    const [selectedTag, setSelectedTag] = useState<string | null>(null)

    // Aggregate unique tags across all notes, most-used first, capped at 12 to
    // keep the chip row from blowing up.
    const topTags = useMemo(() => {
        const counts = new Map<string, number>()
        for (const n of notes) {
            for (const t of n.tags ?? []) {
                counts.set(t, (counts.get(t) ?? 0) + 1)
            }
        }
        return Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
    }, [notes])

    const filteredNotes = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q && !selectedTag) return notes
        return notes.filter(n => {
            if (selectedTag && !(n.tags ?? []).includes(selectedTag)) return false
            if (q && !n.title.toLowerCase().includes(q)) return false
            return true
        })
    }, [notes, search, selectedTag])

    const showSearch = notes.length >= 5 || search.length > 0 || selectedTag !== null

    return (
        <div className="w-full flex flex-col gap-2 overflow-hidden">
            {showSearch && (
                <div className="relative shrink-0">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground-subtle" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Filter notes…"
                        className="w-full bg-hover border border-outline-subtle rounded pl-7 pr-6 py-1 text-[11px] text-foreground placeholder:text-foreground-subtle outline-none focus:border-accent/40"
                    />
                    {search && (
                        <button
                            type="button"
                            onClick={() => setSearch('')}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-foreground-subtle hover:text-foreground-muted"
                            aria-label="Clear search"
                        >
                            <X className="w-2.5 h-2.5" />
                        </button>
                    )}
                </div>
            )}
            {topTags.length > 0 && (
                <div className="flex flex-wrap gap-1 shrink-0">
                    {topTags.map(([tag, count]) => {
                        const isActive = selectedTag === tag
                        return (
                            <button
                                key={tag}
                                type="button"
                                onClick={() => setSelectedTag(isActive ? null : tag)}
                                className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${
                                    isActive
                                        ? 'bg-accent-muted border-accent/40 text-accent'
                                        : 'bg-hover border-outline-subtle text-foreground-muted hover:text-foreground-secondary'
                                }`}
                                title={isActive ? `Clear #${tag} filter` : `Filter by #${tag}`}
                            >
                                #{tag} <span className="opacity-50">{count}</span>
                            </button>
                        )
                    })}
                </div>
            )}
            <div className="flex-1 overflow-y-auto space-y-1">
                {loading && notes.length === 0 && (
                    <div className="p-6 text-center">
                        <div className="w-4 h-4 border border-blue-400/40 border-t-blue-400 rounded-full animate-spin mx-auto" />
                    </div>
                )}
                {filteredNotes.map((note) => (
                    <div
                        key={note.id}
                        onClick={() => onSelect(note.id)}
                        className={`group/note flex items-center justify-between p-2.5 rounded-lg border transition-all cursor-pointer ${
                            activeId === note.id
                                ? 'bg-blue-500/10 border-blue-500/30'
                                : 'bg-transparent border-transparent hover:bg-hover hover:border-outline-subtle'
                        }`}
                    >
                        <div className="min-w-0 flex-1">
                            {renamingId === note.id ? (
                                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                    <input
                                        value={renameValue}
                                        onChange={(e) => onRenameValueChange(e.target.value)}
                                        className="flex-1 min-w-0 bg-hover border border-outline rounded px-1.5 py-0.5 text-xs text-white outline-none focus:border-blue-500/50"
                                        autoFocus
                                        maxLength={120}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') onRename(note.id, renameValue);
                                            if (e.key === 'Escape') onCancelRename();
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); onRename(note.id, renameValue); }}
                                        className="p-0.5 text-green-400 hover:text-green-300"
                                    >
                                        <Check className="w-3 h-3" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); onCancelRename(); }}
                                        className="p-0.5 text-foreground-muted hover:text-foreground-muted"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <div className="flex items-center gap-1.5">
                                        {note.pinned && <Pin className="w-3 h-3 text-blue-400 shrink-0" />}
                                        <span className="text-xs font-medium text-foreground-secondary truncate">{note.title}</span>
                                    </div>
                                    <div className="text-[10px] text-foreground-subtle mt-0.5 flex items-center gap-2">
                                        <span>{note.char_count} chars</span>
                                        <span>{formatTimeAgo(note.updated_at)}</span>
                                    </div>
                                </>
                            )}
                        </div>
                        {renamingId !== note.id && (
                            <div className="flex items-center gap-0.5 opacity-0 group-hover/note:opacity-100 transition-opacity shrink-0 ml-1">
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onTogglePin(note.id, note.pinned); }}
                                    className="p-1 text-foreground-subtle hover:text-blue-400 rounded transition-colors"
                                    title={note.pinned ? 'Unpin' : 'Pin'}
                                >
                                    {note.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                                </button>
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onStartRename(note.id, note.title); }}
                                    className="p-1 text-foreground-subtle hover:text-foreground rounded transition-colors"
                                    title="Rename"
                                >
                                    <Edit3 className="w-3 h-3" />
                                </button>
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onDelete(note.id); }}
                                    className="p-1 text-foreground-subtle hover:text-red-400 rounded transition-colors"
                                    title="Delete"
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        )}
                    </div>
                ))}
                {notes.length === 0 && !loading && (
                    <div className="p-6 text-center">
                        <FileText className="w-6 h-6 text-foreground-disabled mx-auto mb-2" />
                        <p className="text-xs text-foreground-subtle">No notes yet.</p>
                    </div>
                )}
                {notes.length > 0 && filteredNotes.length === 0 && !loading && (
                    <div className="p-4 text-center space-y-1">
                        <p className="text-xs text-foreground-subtle">
                            No notes match{selectedTag ? ` #${selectedTag}` : ''}{search && selectedTag ? ' and' : ''}{search ? ` "${search}"` : ''}.
                        </p>
                        {selectedTag && (
                            <button
                                type="button"
                                onClick={() => setSelectedTag(null)}
                                className="text-[10px] text-accent hover:underline"
                            >
                                Clear tag filter
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

