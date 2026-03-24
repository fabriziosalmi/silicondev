import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cleanModelName } from '../../api/client'
import type { ModelEntry } from '../../api/client'
import { Search, Trash2, Database, Play, LogOut, Zap, Loader2 } from 'lucide-react'
import { archColor, guessQuant, parseSizeGB } from './ModelsUtils'

interface MyModelsTabProps {
    models: ModelEntry[]
    downloading: Set<string>
    activeModelId: string | undefined
    loadingModelId: string | null
    searchQuery: string
    setSearchQuery: (q: string) => void
    onLoad: (model: ModelEntry) => void
    onEject: () => void
    onDelete: (id: string) => void
    onSwitchToDiscover: () => void
}

export function MyModelsTab({
    models, downloading, activeModelId, loadingModelId,
    searchQuery, setSearchQuery,
    onLoad, onEject, onDelete, onSwitchToDiscover,
}: MyModelsTabProps) {
    const { t } = useTranslation()
    const [sortBy, setSortBy] = useState<'name' | 'size' | 'arch'>('name')

    const displayedMyModels = useMemo(() => {
        const q = searchQuery.toLowerCase()
        const filtered = models.filter(m =>
            m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
        )
        if (sortBy === 'size') {
            filtered.sort((a, b) => parseSizeGB(b.size) - parseSizeGB(a.size))
        } else if (sortBy === 'arch') {
            filtered.sort((a, b) => (a.architecture || '').localeCompare(b.architecture || ''))
        } else {
            filtered.sort((a, b) => cleanModelName(a.name).localeCompare(cleanModelName(b.name)))
        }
        return filtered
    }, [models, searchQuery, sortBy])

    const { archGroups, sortedArchKeys } = useMemo(() => {
        const groups = new Map<string, ModelEntry[]>()
        for (const m of displayedMyModels) {
            const arch = m.architecture || 'Other'
            if (!groups.has(arch)) groups.set(arch, [])
            groups.get(arch)!.push(m)
        }
        const keys = Array.from(groups.keys()).sort((a, b) => {
            const aHasActive = groups.get(a)!.some(m => m.id === activeModelId)
            const bHasActive = groups.get(b)!.some(m => m.id === activeModelId)
            if (aHasActive && !bHasActive) return -1
            if (!aHasActive && bHasActive) return 1
            return a.localeCompare(b)
        })
        return { archGroups: groups, sortedArchKeys: keys }
    }, [displayedMyModels, activeModelId])

    return (
        <div className="h-full flex flex-col">
            {/* Search + Sort */}
            <div className="mb-4 flex items-center gap-3">
                <div className="relative max-w-sm flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                        type="text"
                        placeholder={t('models.search')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-lg pl-9 pr-4 py-2 text-white outline-none focus:border-blue-500 text-sm transition-colors"
                    />
                </div>
                <div className="flex items-center gap-1">
                    {(['name', 'size', 'arch'] as const).map(s => (
                        <button
                            key={s}
                            type="button"
                            onClick={() => setSortBy(s)}
                            className={`px-2.5 py-1.5 rounded text-[10px] font-medium transition-colors ${
                                sortBy === s
                                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                    : 'bg-white/[0.03] text-gray-500 border border-white/5 hover:text-gray-400'
                            }`}
                        >
                            {s === 'name' ? t('models.sortName') : s === 'size' ? t('models.sortSize') : t('models.sortArch')}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-auto">
                {models.length === 0 && !searchQuery ? (
                    <div className="flex flex-col items-center justify-center h-64">
                        <div className="max-w-md mx-auto text-center">
                            <Database className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                            <h3 className="text-lg font-semibold text-white mb-1">{t('models.noModels')}</h3>
                            <p className="text-sm text-gray-400 mb-4">{t('models.goToDiscover')}</p>
                            <button
                                type="button"
                                onClick={onSwitchToDiscover}
                                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
                            >
                                {t('models.discover')}
                            </button>
                        </div>
                    </div>
                ) : displayedMyModels.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64">
                        <div className="text-center text-gray-500">No models match your search.</div>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {sortedArchKeys.map(arch => {
                            const groupModels = archGroups.get(arch)!.slice().sort((a, b) => {
                                const aActive = activeModelId === a.id ? 0 : 1
                                const bActive = activeModelId === b.id ? 0 : 1
                                if (aActive !== bActive) return aActive - bActive
                                return cleanModelName(a.name).localeCompare(cleanModelName(b.name))
                            })
                            const colors = archColor(arch)
                            return (
                                <div key={arch}>
                                    <div className="flex items-center gap-2 mb-3">
                                        <div className={`w-2 h-2 rounded-full ${colors.dot}`} />
                                        <span className={`text-[11px] font-bold uppercase tracking-wider ${colors.text}`}>{arch}</span>
                                        <span className="text-[10px] text-gray-600">{groupModels.length} model{groupModels.length !== 1 ? 's' : ''}</span>
                                        <div className="flex-1 h-px bg-white/5" />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                        {groupModels.map(model => {
                                            const isActive = activeModelId === model.id
                                            const isLoading = loadingModelId === model.id
                                            const quant = model.quantization || guessQuant(model.name)
                                            return (
                                                <div
                                                    key={model.id}
                                                    className={`group relative rounded-xl border p-4 transition-all ${
                                                        isActive
                                                            ? `${colors.bg} ${colors.border} ring-1 ring-emerald-500/20`
                                                            : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/10'
                                                    }`}
                                                >
                                                    {isActive && (
                                                        <div className="absolute top-3 right-3 flex items-center gap-1.5">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                                            <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400">{t('models.active')}</span>
                                                        </div>
                                                    )}
                                                    <div className="flex items-start gap-3 mb-3">
                                                        <div className={`w-10 h-10 rounded-lg ${colors.bg} border ${colors.border} flex items-center justify-center shrink-0`}>
                                                            <Zap size={16} className={colors.text} />
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="font-semibold text-[13px] text-white truncate leading-tight flex items-center gap-2">
                                                                {cleanModelName(model.name)}
                                                                {model.is_finetuned && (
                                                                    <span className="text-[8px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/20 uppercase tracking-wide font-bold shrink-0">Tuned</span>
                                                                )}
                                                            </div>
                                                            <div className="text-[10px] text-gray-600 font-mono mt-0.5 truncate">{model.id.split('/').pop()}</div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                                                        {model.size && model.size !== '0.00GB' && (
                                                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 border border-white/[0.06] text-gray-400">{model.size}</span>
                                                        )}
                                                        {quant && (
                                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${colors.bg} border ${colors.border} ${colors.text} uppercase tracking-wide`}>{quant}</span>
                                                        )}
                                                        {model.context_window && model.context_window !== 'Unknown' && (
                                                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 border border-white/[0.06] text-gray-500">{model.context_window} ctx</span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {isActive ? (
                                                            <button
                                                                type="button"
                                                                onClick={onEject}
                                                                aria-label="Eject model"
                                                                className="flex-1 h-8 flex items-center justify-center gap-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors text-[11px] font-bold uppercase tracking-wide"
                                                            >
                                                                <LogOut size={12} />
                                                                {t('models.eject')}
                                                            </button>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={() => onLoad(model)}
                                                                disabled={isLoading}
                                                                aria-label={`Load ${cleanModelName(model.name)}`}
                                                                className="flex-1 h-8 flex items-center justify-center gap-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20 transition-colors text-[11px] font-bold uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed"
                                                            >
                                                                {isLoading ? (
                                                                    <><Loader2 size={12} className="animate-spin" /> {t('common.loading')}</>
                                                                ) : (
                                                                    <><Play size={12} className="fill-current" /> {t('models.load')}</>
                                                                )}
                                                            </button>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => onDelete(model.id)}
                                                            disabled={isActive || downloading.has(model.id)}
                                                            aria-label={`Delete ${cleanModelName(model.name)}`}
                                                            className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/[0.06] text-gray-600 hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                            title={downloading.has(model.id) ? t('models.downloading') : t('models.delete')}
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}
