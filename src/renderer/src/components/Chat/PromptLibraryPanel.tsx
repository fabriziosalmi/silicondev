import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Search, BookOpen, Check, Upload, Star, Trash2, Download, Pencil, Save } from 'lucide-react'
import {
    PROMPT_LIBRARY,
    CATEGORY_COLORS,
    type PromptCategory,
    type PromptTemplate,
} from '../../data/promptLibrary'

interface PromptLibraryPanelProps {
    onSelect: (prompt: string) => void
    onClose: () => void
}

type PromptLibraryFilter = 'all' | 'favorites' | 'imported' | PromptCategory

const FAVORITES_STORAGE_KEY = 'silicon-studio-prompt-library-favorites'
const IMPORTED_STORAGE_KEY = 'silicon-studio-prompt-library-imported'

const ALL_CATEGORIES: PromptLibraryFilter[] = [
    'all', 'favorites', 'imported', 'assistant', 'coding', 'writing', 'analysis', 'education', 'roleplay'
]

function loadFavoriteIds() {
    try {
        const raw = localStorage.getItem(FAVORITES_STORAGE_KEY)
        const parsed = raw ? JSON.parse(raw) : []
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
    } catch {
        return []
    }
}

function loadImportedPrompts(): PromptTemplate[] {
    try {
        const raw = localStorage.getItem(IMPORTED_STORAGE_KEY)
        const parsed = raw ? JSON.parse(raw) : []
        if (!Array.isArray(parsed)) return []

        return parsed.flatMap((item, index): PromptTemplate[] => {
            const prompt = normalizeImportedPrompt(item, `imported-restored-${index}`)
            return prompt ? [prompt] : []
        })
    } catch {
        return []
    }
}

function normalizeImportedPrompt(item: unknown, fallbackId: string): PromptTemplate | null {
    if (!item || typeof item !== 'object') return null

    const candidate = item as {
        id?: unknown
        title?: unknown
        description?: unknown
        prompt?: unknown
        tags?: unknown
    }

    if (
        typeof candidate.title !== 'string'
        || typeof candidate.description !== 'string'
        || typeof candidate.prompt !== 'string'
    ) {
        return null
    }

    return {
        id: typeof candidate.id === 'string' ? candidate.id : fallbackId,
        title: candidate.title,
        description: candidate.description,
        prompt: candidate.prompt,
        category: 'custom',
        tags: Array.isArray(candidate.tags)
            ? candidate.tags.filter((tag: unknown): tag is string => typeof tag === 'string')
            : ['imported'],
        source: 'imported',
    }
}

function isImportedPrompt(template: PromptTemplate) {
    return template.source === 'imported' || template.category === 'custom'
}

function buildImportedPrompt(fileName: string, prompt: string, fallbackTitle: string, importedFromLabel: string): PromptTemplate {
    const baseName = fileName.replace(/\.[^.]+$/, '').trim() || fallbackTitle
    const slug = baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'prompt'
    return {
        id: `imported-${Date.now()}-${slug}`,
        title: baseName,
        description: `${importedFromLabel} ${fileName}`,
        category: 'custom',
        prompt,
        tags: ['imported', 'custom'],
        source: 'imported',
    }
}

export function PromptLibraryPanel({ onSelect, onClose }: PromptLibraryPanelProps) {
    const { t } = useTranslation()
    const [activeCategory, setActiveCategory] = useState<PromptLibraryFilter>('all')
    const [search, setSearch] = useState('')
    const [expanded, setExpanded] = useState<string | null>(null)
    const [applied, setApplied] = useState<string | null>(null)
    const [favoriteIds, setFavoriteIds] = useState<string[]>(() => loadFavoriteIds())
    const [importedPrompts, setImportedPrompts] = useState<PromptTemplate[]>(() => loadImportedPrompts())
    const [editingId, setEditingId] = useState<string | null>(null)
    const [draftTitle, setDraftTitle] = useState('')
    const [draftDescription, setDraftDescription] = useState('')
    const [draftPrompt, setDraftPrompt] = useState('')

    const categoryLabels: Record<PromptCategory, string> = {
        assistant: t('promptLibrary.category.assistant'),
        coding: t('promptLibrary.category.coding'),
        writing: t('promptLibrary.category.writing'),
        analysis: t('promptLibrary.category.analysis'),
        education: t('promptLibrary.category.education'),
        roleplay: t('promptLibrary.category.roleplay'),
        custom: t('promptLibrary.category.custom'),
    }

    const categoryTabLabels: Record<PromptLibraryFilter, string> = {
        all: t('promptLibrary.category.all'),
        favorites: t('promptLibrary.category.favorites'),
        imported: t('promptLibrary.category.imported'),
        ...categoryLabels,
    }

    const favoriteSet = new Set(favoriteIds)
    const library = [...importedPrompts, ...PROMPT_LIBRARY]

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [onClose])

    useEffect(() => {
        try {
            localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoriteIds))
        } catch {
            // Ignore storage failures.
        }
    }, [favoriteIds])

    useEffect(() => {
        try {
            localStorage.setItem(IMPORTED_STORAGE_KEY, JSON.stringify(importedPrompts))
        } catch {
            // Ignore storage failures.
        }
    }, [importedPrompts])

    const filtered = library.filter(p => {
        const matchCat = activeCategory === 'all'
            || (activeCategory === 'favorites' && favoriteSet.has(p.id))
            || (activeCategory === 'imported' && isImportedPrompt(p))
            || (activeCategory !== 'favorites' && activeCategory !== 'imported' && p.category === activeCategory)
        const q = search.toLowerCase()
        const matchSearch = !q
            || p.title.toLowerCase().includes(q)
            || p.description.toLowerCase().includes(q)
            || p.tags?.some(tag => tag.toLowerCase().includes(q))
        return matchCat && matchSearch
    }).sort((left, right) => {
        const favoriteDelta = Number(favoriteSet.has(right.id)) - Number(favoriteSet.has(left.id))
        if (favoriteDelta !== 0) return favoriteDelta

        const importedDelta = Number(isImportedPrompt(right)) - Number(isImportedPrompt(left))
        if (importedDelta !== 0) return importedDelta

        return left.title.localeCompare(right.title)
    })

    useEffect(() => {
        setExpanded(null)
        setEditingId(null)
    }, [activeCategory, search])

    useEffect(() => {
        if (activeCategory === 'imported' && importedPrompts.length === 0) {
            setActiveCategory('all')
        }
    }, [activeCategory, importedPrompts.length])

    function apply(template: PromptTemplate) {
        onSelect(template.prompt)
        setApplied(template.id)
        setTimeout(() => { setApplied(null); onClose() }, 600)
    }

    function toggleFavorite(id: string) {
        setFavoriteIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [id, ...prev])
    }

    function removeImportedPrompt(id: string) {
        setImportedPrompts(prev => prev.filter(prompt => prompt.id !== id))
        setFavoriteIds(prev => prev.filter(item => item !== id))
        setExpanded(current => current === id ? null : current)
        setEditingId(current => current === id ? null : current)
    }

    function startEditing(template: PromptTemplate) {
        setEditingId(template.id)
        setDraftTitle(template.title)
        setDraftDescription(template.description)
        setDraftPrompt(template.prompt)
        setExpanded(template.id)
    }

    function cancelEditing() {
        setEditingId(null)
        setDraftTitle('')
        setDraftDescription('')
        setDraftPrompt('')
    }

    function saveImportedPrompt(id: string) {
        const nextTitle = draftTitle.trim()
        const nextDescription = draftDescription.trim()
        const nextPrompt = draftPrompt.trim()
        if (!nextTitle || !nextDescription || !nextPrompt) return

        setImportedPrompts(prev => prev.map(prompt => prompt.id === id ? {
            ...prompt,
            title: nextTitle,
            description: nextDescription,
            prompt: nextPrompt,
        } : prompt))
        cancelEditing()
    }

    function exportImportedPrompts() {
        if (importedPrompts.length === 0) return

        const blob = new Blob([
            JSON.stringify(importedPrompts, null, 2),
        ], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `silicondev-prompt-library-backup-${new Date().toISOString().slice(0, 10)}.json`
        link.click()
        URL.revokeObjectURL(url)
    }

    function getCategoryCount(category: PromptLibraryFilter) {
        if (category === 'all') return library.length
        if (category === 'favorites') return library.filter(prompt => favoriteSet.has(prompt.id)).length
        if (category === 'imported') return importedPrompts.length
        return library.filter(prompt => prompt.category === category).length
    }

    async function importMarkdown() {
        try {
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = '.md,.txt,.json'
            input.onchange = async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0]
                if (!file) return
                const text = await file.text()

                if (file.name.toLowerCase().endsWith('.json')) {
                    let importedFromJson: PromptTemplate[] = []

                    try {
                        const parsed = JSON.parse(text) as unknown
                        const rawItems = Array.isArray(parsed)
                            ? parsed
                            : parsed && typeof parsed === 'object' && Array.isArray((parsed as { prompts?: unknown }).prompts)
                                ? (parsed as { prompts: unknown[] }).prompts
                                : []

                        importedFromJson = rawItems.flatMap((item, index): PromptTemplate[] => {
                            const normalized = normalizeImportedPrompt(item, `imported-json-${Date.now()}-${index}`)
                            return normalized ? [normalized] : []
                        })
                    } catch {
                        importedFromJson = []
                    }

                    if (importedFromJson.length === 0) return

                    let firstImportedId = importedFromJson[0].id
                    setImportedPrompts(prev => {
                        const byPrompt = new Map(prev.map(prompt => [prompt.prompt, prompt]))
                        for (const prompt of importedFromJson) {
                            const existing = byPrompt.get(prompt.prompt)
                            if (existing) {
                                firstImportedId = existing.id
                                byPrompt.set(prompt.prompt, { ...existing, ...prompt, id: existing.id })
                            } else {
                                byPrompt.set(prompt.prompt, prompt)
                            }
                        }
                        return Array.from(byPrompt.values())
                    })

                    setActiveCategory('imported')
                    setSearch('')
                    setExpanded(firstImportedId)
                    return
                }

                const cleaned = text
                    .replace(/^---[\s\S]*?---\n/, '')
                    .replace(/^#{1,3} .+\n/gm, '')
                    .trim()

                if (!cleaned) return

                const existing = importedPrompts.find(prompt => prompt.prompt === cleaned)
                const imported = existing ?? buildImportedPrompt(
                    file.name,
                    cleaned,
                    t('promptLibrary.importedPromptDefaultTitle'),
                    t('promptLibrary.importedFromLabel'),
                )

                if (!existing) {
                    setImportedPrompts(prev => [imported, ...prev])
                }

                setActiveCategory('imported')
                setSearch('')
                setExpanded(imported.id)
            }
            input.click()
        } catch {
            // Ignore file picker failures.
        }
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onClose()
            }}
        >
            <div
                className="w-full max-w-5xl max-h-[80vh] flex flex-col bg-[#0f0f0f] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
                    <div className="flex items-center gap-2.5">
                        <BookOpen size={15} className="text-blue-400" />
                        <span className="text-sm font-semibold text-white">{t('promptLibrary.title')}</span>
                        <span className="text-[10px] text-gray-500 bg-white/5 px-1.5 py-0.5 rounded">
                            {t('promptLibrary.promptCount', { count: library.length })}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={importMarkdown}
                            title={t('promptLibrary.importTitle')}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium text-gray-400 bg-white/[0.03] border border-white/[0.06] hover:text-white hover:bg-white/[0.06] transition-colors"
                        >
                            <Upload size={11} />
                            {t('promptLibrary.import')}
                        </button>
                        <button
                            type="button"
                            onClick={exportImportedPrompts}
                            title={t('promptLibrary.backupTitle')}
                            disabled={importedPrompts.length === 0}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium text-gray-400 bg-white/[0.03] border border-white/[0.06] hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-40 disabled:hover:text-gray-400 disabled:hover:bg-white/[0.03]"
                        >
                            <Download size={11} />
                            {t('promptLibrary.backup')}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            title={t('common.close')}
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
                            placeholder={t('promptLibrary.searchPlaceholder')}
                            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder:text-gray-600 outline-none focus:border-white/20 transition-colors"
                            autoFocus
                        />
                    </div>
                </div>

                {/* Category tabs */}
                <div className="flex flex-wrap gap-2 px-5 pb-3">
                    {ALL_CATEGORIES.map(cat => (
                        <button
                            key={cat}
                            type="button"
                            onClick={() => setActiveCategory(cat)}
                            className={`shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors whitespace-nowrap border ${
                                activeCategory === cat
                                    ? 'bg-white/10 text-white border-white/20'
                                    : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-white/[0.04]'
                            }`}
                        >
                            {categoryTabLabels[cat]}
                            {cat !== 'all' && (
                                <span className="ml-1 opacity-50">
                                    {getCategoryCount(cat)}
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
                            <p className="text-xs">{t('promptLibrary.empty')}</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                            {filtered.map(template => {
                                const isExpanded = expanded === template.id
                                const isApplied = applied === template.id
                                const isEditing = editingId === template.id
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
                                            <div className="flex items-center gap-1.5 shrink-0">
                                                <button
                                                    type="button"
                                                    title={favoriteSet.has(template.id) ? t('promptLibrary.removeFavorite') : t('promptLibrary.addFavorite')}
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        toggleFavorite(template.id)
                                                    }}
                                                    className={`p-1 rounded-md border transition-colors ${
                                                        favoriteSet.has(template.id)
                                                            ? 'text-amber-300 bg-amber-500/10 border-amber-500/20'
                                                            : 'text-gray-500 border-white/[0.06] hover:text-amber-300 hover:border-amber-500/20'
                                                    }`}
                                                >
                                                    <Star size={11} fill={favoriteSet.has(template.id) ? 'currentColor' : 'none'} />
                                                </button>
                                                <span className={`shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded border ${catColor}`}>
                                                    {categoryLabels[template.category]}
                                                </span>
                                            </div>
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
                                                {isEditing ? (
                                                    <div className="space-y-2">
                                                        <input
                                                            type="text"
                                                            value={draftTitle}
                                                            onChange={(e) => setDraftTitle(e.target.value)}
                                                            placeholder={t('promptLibrary.promptTitlePlaceholder')}
                                                            className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-white/20"
                                                        />
                                                        <input
                                                            type="text"
                                                            value={draftDescription}
                                                            onChange={(e) => setDraftDescription(e.target.value)}
                                                            placeholder={t('promptLibrary.shortDescriptionPlaceholder')}
                                                            className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-white/20"
                                                        />
                                                        <textarea
                                                            value={draftPrompt}
                                                            onChange={(e) => setDraftPrompt(e.target.value)}
                                                            placeholder={t('promptLibrary.promptContentPlaceholder')}
                                                            className="w-full bg-black/40 border border-white/[0.08] rounded-lg p-3 min-h-32 text-[11px] text-gray-300 font-mono leading-relaxed resize-y outline-none focus:border-white/20"
                                                        />
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => saveImportedPrompt(template.id)}
                                                                disabled={!draftTitle.trim() || !draftDescription.trim() || !draftPrompt.trim()}
                                                                className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors disabled:opacity-40"
                                                            >
                                                                <Save size={11} />
                                                                {t('promptLibrary.saveChanges')}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={cancelEditing}
                                                                className="py-1.5 rounded-lg text-xs font-medium text-gray-300 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-colors"
                                                            >
                                                                {t('common.cancel')}
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <>
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
                                                                <><Check size={11} /> {t('promptLibrary.applied')}</>
                                                            ) : (
                                                                t('promptLibrary.usePrompt')
                                                            )}
                                                        </button>
                                                    </>
                                                )}
                                                {isImportedPrompt(template) && (
                                                    <div className="grid grid-cols-2 gap-2 mt-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => startEditing(template)}
                                                            className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium text-amber-300 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
                                                        >
                                                            <Pencil size={11} />
                                                            {t('promptLibrary.editPrompt')}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeImportedPrompt(template.id)}
                                                            className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium text-red-300 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                                                        >
                                                            <Trash2 size={11} />
                                                            {t('promptLibrary.removePrompt')}
                                                        </button>
                                                    </div>
                                                )}
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
