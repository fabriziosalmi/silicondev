import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { cleanModelName } from '../../api/client'
import type { ModelEntry } from '../../api/client'
import { Search, Download, FileText, Loader2, Globe, AlertCircle } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { archColor, parseSizeGB, RECOMMENDED_MODELS } from './ModelsUtils'

// HuggingFace API model result shape (minimal fields we use)
interface HFSearchResult {
    id: string;
    downloads?: number;
    likes?: number;
    modelId?: string;
}

// Order of family chips in the Discover filter bar — most popular first.
const FAMILY_ORDER = ['Qwen', 'Llama', 'Gemma', 'Mistral', 'Phi', 'NanoCoder', 'LFM', 'Other'] as const
type Family = typeof FAMILY_ORDER[number] | 'All'

function familyOf(model: ModelEntry): Exclude<Family, 'All'> {
    const arch = (model.architecture || '').toLowerCase()
    const id = model.id.toLowerCase()
    if (arch.includes('qwen') || id.includes('qwen')) return 'Qwen'
    if (arch.includes('llama') || id.includes('llama')) return 'Llama'
    if (arch.includes('gemma') || id.includes('gemma')) return 'Gemma'
    if (arch.includes('mistral') || arch.includes('mixtral') || id.includes('mistral') || id.includes('devstral')) return 'Mistral'
    if (arch.includes('phi') || id.includes('phi')) return 'Phi'
    if (arch.includes('lfm') || id.includes('lfm')) return 'LFM'
    if (id.includes('nanocoder')) return 'NanoCoder'
    return 'Other'
}

interface DiscoverTabProps {
    models: ModelEntry[]
    downloading: Set<string>
    downloadProgress: Map<string, number>
    /** F-5: speed (bytes/sec) + ETA (seconds) per model during download */
    downloadStats?: Map<string, { speed: number; eta: number }>
    availableRamBytes: number
    searchQuery: string
    setSearchQuery: (q: string) => void
    onDownload: (id: string) => void
}

export function DiscoverTab({
    models, downloading, downloadProgress, downloadStats, availableRamBytes,
    searchQuery, setSearchQuery, onDownload,
}: DiscoverTabProps) {
    const { t } = useTranslation()
    const [selectedModel, setSelectedModel] = useState<ModelEntry | null>(null)
    const [readmeContent, setReadmeContent] = useState("")
    const [readmeLoading, setReadmeLoading] = useState(false)
    const readmeAbortRef = useRef<AbortController | null>(null)
    const [familyFilter, setFamilyFilter] = useState<Family>('All')

    // Family chip counts for the filter bar (excludes models that won't fit RAM)
    const familyCounts = useMemo(() => {
        const counts = new Map<string, number>()
        for (const m of models) {
            const sizeGB = parseSizeGB(m.size)
            if (sizeGB > 0 && availableRamBytes > 0 && sizeGB * 1.07e9 > availableRamBytes) continue
            const fam = familyOf(m)
            counts.set(fam, (counts.get(fam) ?? 0) + 1)
        }
        return counts
    }, [models, availableRamBytes])

    const displayedModels = useMemo(() => {
        const q = searchQuery.toLowerCase()
        return models
            .filter(m => {
                const matchesSearch = m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
                if (!matchesSearch) return false
                const sizeGB = parseSizeGB(m.size)
                if (sizeGB > 0 && availableRamBytes > 0 && sizeGB * 1.07e9 > availableRamBytes) return false
                if (familyFilter !== 'All' && familyOf(m) !== familyFilter) return false
                return true
            })
            // Smaller models first — easier to pick when looking by RAM budget.
            .sort((a, b) => parseSizeGB(a.size) - parseSizeGB(b.size))
    }, [models, searchQuery, availableRamBytes, familyFilter])

    const fetchReadme = async (id: string) => {
        readmeAbortRef.current?.abort()
        setReadmeLoading(true)
        try {
            if (id.startsWith('mlx-community/') || id.includes('/')) {
                const controller = new AbortController()
                readmeAbortRef.current = controller
                const timeout = setTimeout(() => controller.abort(), 5000)
                try {
                    const response = await fetch(`https://huggingface.co/${id}/raw/main/README.md`, { signal: controller.signal })
                    clearTimeout(timeout)
                    if (response.ok) {
                        setReadmeContent(await response.text())
                    } else {
                        setReadmeContent("README not found or model is private.")
                    }
                } catch {
                    clearTimeout(timeout)
                    if (!controller.signal.aborted) {
                        setReadmeContent("Unable to fetch README. You may be offline.")
                    }
                }
            } else {
                setReadmeContent("No README available for custom local models.")
            }
        } catch {
            setReadmeContent("Unable to fetch README. Check your internet connection.")
        } finally {
            setReadmeLoading(false)
        }
    }

    const selectModelForDetails = (model: ModelEntry) => {
        setSelectedModel(model)
        fetchReadme(model.id)
    }

    // B-3: HuggingFace open search
    const [hfTab, setHfTab] = useState<'catalog' | 'hfsearch'>('catalog')
    const [hfQuery, setHfQuery] = useState('')
    const [hfResults, setHfResults] = useState<HFSearchResult[]>([])
    const [hfLoading, setHfLoading] = useState(false)
    const [hfError, setHfError] = useState('')
    const hfAbortRef = useRef<AbortController | null>(null)
    const hfDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const searchHuggingFace = useCallback(async (q: string) => {
        if (!q.trim()) { setHfResults([]); return; }
        hfAbortRef.current?.abort();
        const ctrl = new AbortController();
        hfAbortRef.current = ctrl;
        setHfLoading(true);
        setHfError('');
        try {
            const res = await fetch(
                `https://huggingface.co/api/models?search=${encodeURIComponent(q)}&filter=gguf&sort=downloads&direction=-1&limit=30`,
                { signal: ctrl.signal }
            );
            if (!res.ok) throw new Error(`HF API ${res.status}`);
            const data: HFSearchResult[] = await res.json();
            if (!ctrl.signal.aborted) setHfResults(data);
        } catch (e) {
            if (!(e instanceof DOMException && e.name === 'AbortError')) {
                setHfError('HuggingFace search failed. Check your connection.');
            }
        } finally {
            if (!ctrl.signal.aborted) setHfLoading(false);
        }
    }, []);

    useEffect(() => {
        if (hfDebounceRef.current) clearTimeout(hfDebounceRef.current);
        hfDebounceRef.current = setTimeout(() => searchHuggingFace(hfQuery), 400);
        return () => { if (hfDebounceRef.current) clearTimeout(hfDebounceRef.current); };
    }, [hfQuery, searchHuggingFace]);

    useEffect(() => {
        return () => { hfAbortRef.current?.abort(); };
    }, []);

    return (
        <div className="h-full flex gap-4 overflow-hidden">

            {/* Left Side: tabs + catalog/HF search */}
            <div className="w-2/5 flex flex-col bg-black/20 border border-white/10 rounded-xl overflow-hidden shrink-0">
                {/* Tab bar */}
                <div className="flex border-b border-white/10 bg-white/[0.01] shrink-0">
                    <button
                        type="button"
                        onClick={() => setHfTab('catalog')}
                        className={`flex-1 py-2 text-[11px] font-semibold transition-colors ${
                            hfTab === 'catalog' ? 'text-white border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-300'
                        }`}
                    >
                        {t('models.catalog', 'Catalog')}
                    </button>
                    <button
                        type="button"
                        onClick={() => setHfTab('hfsearch')}
                        className={`flex-1 py-2 text-[11px] font-semibold transition-colors flex items-center justify-center gap-1 ${
                            hfTab === 'hfsearch' ? 'text-white border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-300'
                        }`}
                    >
                        <Globe className="w-3 h-3" />
                        HuggingFace
                    </button>
                </div>

                {/* HF Search panel */}
                {hfTab === 'hfsearch' ? (
                    <div className="flex flex-col flex-1 overflow-hidden">
                        <div className="p-3 border-b border-white/10">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                                <input
                                    type="text"
                                    autoFocus
                                    placeholder="Search any GGUF model on HuggingFace..."
                                    value={hfQuery}
                                    onChange={e => setHfQuery(e.target.value)}
                                    className="w-full bg-black/40 border border-white/10 rounded-md pl-8 pr-3 h-8 text-white text-[12px] outline-none focus:border-blue-500 transition-colors"
                                />
                                {hfLoading && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 animate-spin" />}
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            {hfError && (
                                <div className="p-4 flex items-center gap-2 text-xs text-red-400">
                                    <AlertCircle className="w-4 h-4 shrink-0" />
                                    {hfError}
                                </div>
                            )}
                            {!hfError && hfResults.length === 0 && !hfLoading && hfQuery.trim() && (
                                <div className="p-6 text-center text-[11px] text-gray-600">No GGUF models found for "{hfQuery}"</div>
                            )}
                            {!hfQuery.trim() && (
                                <div className="p-6 text-center text-[11px] text-gray-600 leading-relaxed">
                                    Search any model on HuggingFace.<br />
                                    <span className="text-gray-700">Only GGUF-compatible models are shown.</span>
                                </div>
                            )}
                            <div className="divide-y divide-white/[0.04]">
                                {hfResults.map(result => (
                                    <div key={result.id} className="group flex items-center gap-2 px-3 h-10 hover:bg-white/[0.025] transition-colors">
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[11px] font-medium text-gray-200 truncate">{result.id}</div>
                                            <div className="text-[9px] text-gray-600 font-mono">
                                                {result.downloads ? `↓ ${result.downloads.toLocaleString()}` : ''}
                                                {result.likes ? ` · ♥ ${result.likes}` : ''}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => onDownload(result.id)}
                                            disabled={downloading.has(result.id)}
                                            aria-label={`Download ${result.id}`}
                                            className="h-6 w-6 flex items-center justify-center rounded text-gray-600 opacity-0 group-hover:opacity-100 hover:bg-blue-500/20 hover:text-blue-400 transition-all disabled:opacity-50 shrink-0"
                                            title={downloading.has(result.id) ? 'Downloading…' : 'Download'}
                                        >
                                            {downloading.has(result.id)
                                                ? <Loader2 size={11} className="animate-spin" />
                                                : <Download size={11} />}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                <>
                <div className="p-3 border-b border-white/10 bg-white/[0.02] space-y-2">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                        <input
                            type="text"
                            placeholder={t('models.search')}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded-md pl-8 pr-3 h-8 text-white text-[12px] outline-none focus:border-blue-500 transition-colors"
                        />
                    </div>
                    {/* Family filter chips */}
                    <div className="flex flex-wrap gap-1">
                        {(['All', ...FAMILY_ORDER] as const).map(fam => {
                            const count = fam === 'All'
                                ? Array.from(familyCounts.values()).reduce((a, b) => a + b, 0)
                                : (familyCounts.get(fam) ?? 0)
                            if (fam !== 'All' && count === 0) return null
                            const isActive = familyFilter === fam
                            return (
                                <button
                                    key={fam}
                                    type="button"
                                    onClick={() => setFamilyFilter(fam)}
                                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                                        isActive
                                            ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                                            : 'bg-white/[0.03] border-white/10 text-gray-500 hover:text-gray-300'
                                    }`}
                                >
                                    {fam} <span className="opacity-50">{count}</span>
                                </button>
                            )
                        })}
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto no-scrollbar">
                    {/* Recommended section — only when no filter is active */}
                    {!searchQuery && familyFilter === 'All' && (
                        <div className="p-3 border-b border-white/10">
                            <h3 className="text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-2">{t('models.recommended')}</h3>
                            <div className="grid grid-cols-2 gap-1.5">
                                {RECOMMENDED_MODELS.filter(rec => {
                                    if (availableRamBytes > 0 && rec.sizeGB * 1.07e9 > availableRamBytes) return false
                                    return true
                                }).map(rec => {
                                    const catalogModel = models.find(m => m.id === rec.id)
                                    if (!catalogModel) return null
                                    const isDownloading = downloading.has(rec.id)
                                    const colors = archColor(catalogModel.architecture)
                                    return (
                                        <button
                                            key={rec.id}
                                            type="button"
                                            onClick={() => onDownload(rec.id)}
                                            disabled={isDownloading}
                                            className={`${colors.bg} border ${colors.border} rounded-md p-2 flex flex-col gap-0.5 text-left hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed`}
                                            title={`${cleanModelName(catalogModel.name)} — ${catalogModel.size}`}
                                        >
                                            <div className="text-[11px] font-semibold text-white truncate">{cleanModelName(catalogModel.name)}</div>
                                            <div className="flex items-center justify-between gap-1">
                                                <span className={`text-[9px] ${colors.text} font-medium truncate`}>{rec.label}</span>
                                                <span className="text-[9px] text-gray-500 font-mono shrink-0">{catalogModel.size}</span>
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                    {/* Dense list — one ~32px row per model, smallest first */}
                    {displayedModels.length === 0 ? (
                        <div className="p-6 text-center text-[11px] text-gray-600">No models match.</div>
                    ) : (
                        <div className="divide-y divide-white/[0.04]">
                            {displayedModels.map(model => {
                                const colors = archColor(model.architecture)
                                const isSelected = selectedModel?.id === model.id
                                const isDownloading = downloading.has(model.id)
                                // F-2: VRAM/RAM fit badge
                                const sizeGB = parseSizeGB(model.size)
                                const vramGB = sizeGB * 1.15
                                const ramGB = availableRamBytes / 1e9
                                const fitLabel = ramGB <= 0 ? null
                                    : vramGB <= ramGB * 0.75 ? { label: 'Fits', cls: 'text-green-500/70' }
                                    : vramGB <= ramGB ? { label: 'Tight', cls: 'text-amber-500/70' }
                                    : { label: 'Too large', cls: 'text-red-500/60' }
                                return (
                                    <div
                                        key={model.id}
                                        className={`group flex items-center gap-2 px-3 h-9 transition-colors ${
                                            isSelected ? colors.bg : 'hover:bg-white/[0.025]'
                                        }`}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => selectModelForDetails(model)}
                                            className="flex-1 min-w-0 flex items-center gap-2 text-left h-full"
                                        >
                                            <div className={`w-1.5 h-1.5 rounded-full ${colors.dot} shrink-0`} />
                                            <span className="text-[12px] font-medium text-gray-200 truncate">{cleanModelName(model.name)}</span>
                                            <span className="text-[10px] text-gray-500 font-mono ml-auto tabular-nums shrink-0">{model.size}</span>
                                            {/* F-2: fit badge */}
                                            {fitLabel && (
                                                <span className={`text-[9px] font-bold uppercase tabular-nums shrink-0 ${fitLabel.cls}`}>
                                                    {fitLabel.label}
                                                </span>
                                            )}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onDownload(model.id)}
                                            disabled={isDownloading}
                                            aria-label={`Download ${cleanModelName(model.name)}`}
                                            className={`h-6 flex items-center justify-center rounded text-gray-600 hover:bg-blue-500/20 hover:text-blue-400 transition-all disabled:cursor-not-allowed shrink-0 ${
                                                isDownloading ? 'opacity-100 w-auto px-1' : 'opacity-0 group-hover:opacity-100 w-6'
                                            }`}
                                            title={isDownloading ? t('models.downloading') : t('models.download')}
                                        >
                                            {isDownloading ? (() => {
                                                const pct = downloadProgress.get(model.id) ?? 0
                                                const st = downloadStats?.get(model.id)
                                                const spdStr = st && st.speed > 0 ? ` ${(st.speed / 1e6).toFixed(1)}` : ''
                                                return (
                                                    <span className="text-[9px] font-mono text-blue-400 tabular-nums flex items-center gap-0.5">
                                                        {pct > 0 ? `${pct}%${spdStr}` : <Loader2 size={11} className="animate-spin" />}
                                                        {pct > 0 && spdStr && <span className="text-[8px] text-blue-500">MB/s</span>}
                                                    </span>
                                                )
                                            })() : <Download size={11} />}
                                        </button>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
                </>
                )}
            </div>

            {/* Right Side: Readme & Download */}
            <div className="flex-1 flex flex-col bg-black/20 border border-white/10 rounded-xl overflow-hidden">
                {selectedModel ? (
                    <>
                        <div className="p-6 border-b border-white/10 bg-white/[0.02] flex items-start justify-between shrink-0">
                            <div>
                                <h2 className="text-xl font-bold mb-1">{selectedModel.name}</h2>
                                <div className="flex items-center gap-2 mt-1">
                                    {(() => { const c = archColor(selectedModel.architecture); return (
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${c.bg} border ${c.border} ${c.text} font-bold uppercase`}>
                                            {selectedModel.architecture || 'Unknown'}
                                        </span>
                                    ); })()}
                                    <span className="text-sm text-gray-400 font-mono">{selectedModel.size}</span>
                                    {/* F-2: VRAM estimate in detail panel */}
                                    {(() => {
                                        const sizeGB = parseSizeGB(selectedModel.size)
                                        const vramGB = sizeGB * 1.15
                                        const ramGB = availableRamBytes / 1e9
                                        if (ramGB <= 0 || sizeGB <= 0) return null
                                        const pct = Math.round((vramGB / ramGB) * 100)
                                        const { label, cls } = vramGB <= ramGB * 0.75
                                            ? { label: '✓ Fits in RAM', cls: 'text-green-400 bg-green-500/10 border-green-500/20' }
                                            : vramGB <= ramGB
                                            ? { label: '⚡ Tight fit', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/20' }
                                            : { label: '✗ Too large', cls: 'text-red-400 bg-red-500/10 border-red-500/20' }
                                        return (
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold ${cls}`}
                                                title={`~${vramGB.toFixed(1)} GB RAM needed / ${ramGB.toFixed(1)} GB available (${pct}%)`}>
                                                {label}
                                            </span>
                                        )
                                    })()}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => onDownload(selectedModel.id)}
                                disabled={downloading.has(selectedModel.id)}
                                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-[140px] justify-center"
                            >
                                {downloading.has(selectedModel.id) ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        {(downloadProgress.get(selectedModel.id) ?? 0) > 0 ? (() => {
                                            const pct = downloadProgress.get(selectedModel.id) ?? 0
                                            const st = downloadStats?.get(selectedModel.id)
                                            const spdStr = st && st.speed > 0 ? ` · ${(st.speed / 1e6).toFixed(1)} MB/s` : ''
                                            const etaStr = st && st.eta > 60 ? ` · ${Math.round(st.eta / 60)}m` : st && st.eta > 0 ? ` · ${Math.round(st.eta)}s` : ''
                                            return `${pct}%${spdStr}${etaStr}`
                                        })() : t('models.downloading')}
                                    </>
                                ) : (
                                    <><Download className="w-4 h-4" /> {t('models.download')}</>
                                )}
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 bg-[#0E0E10]">
                            {readmeLoading ? (
                                <div className="flex items-center justify-center h-full text-gray-500 gap-3">
                                    <Loader2 size={20} className="animate-spin" />
                                    {t('common.loading')}
                                </div>
                            ) : (
                                <div className="prose prose-invert prose-sm max-w-none prose-pre:bg-black/50 prose-a:text-blue-400">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                                        {readmeContent}
                                    </ReactMarkdown>
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-gray-500">
                        <FileText className="w-12 h-12 mb-4 opacity-20" />
                        <p>{t('models.noReadme')}</p>
                    </div>
                )}
            </div>
        </div>
    )
}
