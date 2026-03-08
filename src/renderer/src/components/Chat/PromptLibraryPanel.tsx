import { useState, useEffect, useRef } from 'react'
import { X, Search, BookOpen, Check, Upload } from 'lucide-react'
import {
    PROMPT_LIBRARY,
    CATEGORY_LABELS,
    CATEGORY_COLORS,
    type PromptCategory,
    type PromptTemplate,
} from '../../data/promptLibrary'

interface PromptLibraryPanelProps {
    onSelect: (prompt: string) => void
    onClose: () => void
}

const ALL_CATEGORIES: ('all' | PromptCategory)[] = [
    'all', 'assistant', 'coding', 'writing', 'analysis', 'education', 'roleplay'
]

const CATEGORY_TAB_LABELS: Record<'all' | PromptCategory, string> = {
    all: 'All',
    ...CATEGORY_LABELS,
}

export function PromptLibraryPanel({ onSelect, onClose }: PromptLibraryPanelProps) {
    const [activeCategory, setActiveCategory] = useState<'all' | PromptCategory>('all')
    const [search, setSearch] = useState('')
    const [expanded, setExpanded] = useState<string | null>(null)
    const [applied, setApplied] = useState<string | null>(null)
    const panelRef = useRef<HTMLDivElement>(null)

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [onClose])

    // Close on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
        }
        // delay so the open-click doesn't immediately close
        const t = setTimeout(() => window.addEventListener('mousedown', handler), 50)
        return () => { clearTimeout(t); window.removeEventListener('mousedown', handler) }
    }, [onClose])

    const filtered = PROMPT_LIBRARY.filter(p => {
        const matchCat = activeCategory === 'all' || p.category === activeCategory
        const q = search.toLowerCase()
        const matchSearch = !q || p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.tags?.some(t => t.includes(q))
        return matchCat && matchSearch
    })

    function apply(template: PromptTemplate) {
        onSelect(template.prompt)
        setApplied(template.id)
        setTimeout(() => { setApplied(null); onClose() }, 600)
    }

    async function importMarkdown() {
        try {
            // Use Electron file dialog if available
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = '.md,.txt'
            input.onchange = async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0]
                if (!file) return
                const text = await file.text()
                // Strip frontmatter and markdown headings for a clean prompt
                const cleaned = text
                    .replace(/^---[\s\S]*?---\n/, '')   // YAML frontmatter
                    .replace(/^#{1,3} .+\n/gm, '')       // headings
                    .trim()
                onSelect(cleaned)
                onClose()
            }
            input.click()
        } catch {
            // No-op if file picker fails
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div
                ref={panelRef}
                className="w-full max-w-2xl max-h-[80vh] flex flex-col bg-[#0f0f0f] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
                    <div className="flex items-center gap-2.5">
                        <BookOpen size={15} className="text-blue-400" />
                        <span className="text-sm font-semibold text-white">Prompt Library</span>
                        <span className="text-[10px] text-gray-500 bg-white/5 px-1.5 py-0.5 rounded">
                            {PROMPT_LIBRARY.length} prompts
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={importMarkdown}
                            title="Import .md or .txt file"
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium text-gray-400 bg-white/[0.03] border border-white/[0.06] hover:text-white hover:bg-white/[0.06] transition-colors"
                        >
                            <Upload size={11} />
                            Import .md
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            title="Close"
                            className="text-gray-500 hover:text-white transition-colors p-1"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>

                {/* Search */}
                <div className="px-5 pt-3 pb-2">
                    <div className="relative">
                        <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search prompts..."
                            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder:text-gray-600 outline-none focus:border-white/20 transition-colors"
                            autoFocus
                        />
                    </div>
                </div>

                {/* Category tabs */}
                <div className="flex gap-1 px-5 pb-3 overflow-x-auto scrollbar-none">
                    {ALL_CATEGORIES.map(cat => (
                        <button
                            key={cat}
                            type="button"
                            onClick={() => setActiveCategory(cat)}
                            className={`shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors whitespace-nowrap ${
                                activeCategory === cat
                                    ? 'bg-white/10 text-white border border-white/20'
                                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.04]'
                            }`}
                        >
                            {CATEGORY_TAB_LABELS[cat]}
                            {cat !== 'all' && (
                                <span className="ml-1 opacity-50">
                                    {PROMPT_LIBRARY.filter(p => p.category === cat).length}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Cards grid */}
                <div className="flex-1 overflow-y-auto px-5 pb-5">
                    {filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-gray-600">
                            <BookOpen size={28} className="mb-3 opacity-30" />
                            <p className="text-xs">No prompts match your search</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-2.5">
                            {filtered.map(template => {
                                const isExpanded = expanded === template.id
                                const isApplied = applied === template.id
                                const catColor = CATEGORY_COLORS[template.category]

                                return (
                                    <div
                                        key={template.id}
                                        className={`flex flex-col gap-2 p-3.5 rounded-xl border transition-all cursor-pointer ${
                                            isExpanded
                                                ? 'border-white/20 bg-white/[0.06]'
                                                : 'border-white/[0.06] bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]'
                                        }`}
                                        onClick={() => setExpanded(isExpanded ? null : template.id)}
                                    >
                                        {/* Card header */}
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1 min-w-0">
                                                <div className="text-xs font-semibold text-white truncate">
                                                    {template.title}
                                                </div>
                                                <div className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">
                                                    {template.description}
                                                </div>
                                            </div>
                                            <span className={`shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded border ${catColor}`}>
                                                {CATEGORY_LABELS[template.category]}
                                            </span>
                                        </div>

                                        {/* Tags */}
                                        {template.tags && (
                                            <div className="flex flex-wrap gap-1">
                                                {template.tags.slice(0, 3).map(tag => (
                                                    <span
                                                        key={tag}
                                                        className="text-[9px] text-gray-600 bg-white/[0.03] border border-white/[0.05] px-1.5 py-0.5 rounded"
                                                    >
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        )}

                                        {/* Expanded prompt preview */}
                                        {isExpanded && (
                                            <div
                                                className="mt-1"
                                                onClick={e => e.stopPropagation()}
                                            >
                                                <div className="bg-black/40 border border-white/[0.06] rounded-lg p-2.5 max-h-36 overflow-y-auto">
                                                    <p className="text-[10px] text-gray-400 leading-relaxed font-mono whitespace-pre-wrap">
                                                        {template.prompt}
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => apply(template)}
                                                    className={`mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                                        isApplied
                                                            ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                                            : 'bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30'
                                                    }`}
                                                >
                                                    {isApplied ? (
                                                        <><Check size={11} /> Applied</>
                                                    ) : (
                                                        'Use this prompt'
                                                    )}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
