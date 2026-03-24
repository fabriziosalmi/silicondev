import { useState, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cleanModelName } from '../../api/client'
import type { ModelEntry } from '../../api/client'
import { Search, Download, FileText, Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { archColor, guessPublisher, RECOMMENDED_MODELS } from './ModelsUtils'

interface DiscoverTabProps {
    models: ModelEntry[]
    downloading: Set<string>
    availableRamBytes: number
    searchQuery: string
    setSearchQuery: (q: string) => void
    onDownload: (id: string) => void
}

export function DiscoverTab({
    models, downloading, availableRamBytes,
    searchQuery, setSearchQuery, onDownload,
}: DiscoverTabProps) {
    const { t } = useTranslation()
    const [selectedModel, setSelectedModel] = useState<ModelEntry | null>(null)
    const [readmeContent, setReadmeContent] = useState("")
    const [readmeLoading, setReadmeLoading] = useState(false)
    const readmeAbortRef = useRef<AbortController | null>(null)

    const displayedModels = useMemo(() =>
        models.filter(m => {
            const q = searchQuery.toLowerCase()
            const matchesSearch = m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
            if (!matchesSearch) return false
            const sizeGB = parseFloat(m.size.match(/([\d.]+)\s*GB/i)?.[1] || '0')
            if (sizeGB > 0 && availableRamBytes > 0 && sizeGB * 1.07e9 > availableRamBytes) return false
            return true
        }),
        [models, searchQuery, availableRamBytes]
    )

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

    return (
        <div className="h-full flex gap-4 overflow-hidden">

            {/* Left Side: Search & List */}
            <div className="w-1/3 flex flex-col bg-black/20 border border-white/10 rounded-xl overflow-hidden shrink-0">
                <div className="p-4 border-b border-white/10 bg-white/[0.02]">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <input
                            type="text"
                            placeholder={t('models.search')}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded-lg pl-9 pr-4 py-2 text-white outline-none focus:border-blue-500 text-sm transition-colors"
                        />
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto no-scrollbar">
                    {/* Recommended section */}
                    {!searchQuery && (
                        <div className="p-4 border-b border-white/10">
                            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-3">{t('models.recommended')}</h3>
                            <div className="grid grid-cols-2 gap-2">
                                {RECOMMENDED_MODELS.filter(rec => {
                                    if (availableRamBytes > 0 && rec.sizeGB * 1.07e9 > availableRamBytes) return false
                                    return true
                                }).map(rec => {
                                    const catalogModel = models.find(m => m.id === rec.id)
                                    if (!catalogModel) return null
                                    const isDownloading = downloading.has(rec.id)
                                    const colors = archColor(catalogModel.architecture)
                                    return (
                                        <div key={rec.id} className={`${colors.bg} border ${colors.border} rounded-lg p-3 flex flex-col gap-1.5`}>
                                            <div className="text-xs font-semibold text-white truncate">{cleanModelName(catalogModel.name)}</div>
                                            <div className="flex items-center gap-1.5">
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${colors.text} font-medium`}>{rec.label}</span>
                                                <span className="text-[10px] text-gray-500">{catalogModel.size}</span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => onDownload(rec.id)}
                                                disabled={isDownloading}
                                                className="mt-1 w-full text-center text-[10px] font-bold uppercase tracking-wide py-1.5 rounded bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {isDownloading ? t('models.downloading') : t('models.download')}
                                            </button>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                    {displayedModels.map(model => {
                        const colors = archColor(model.architecture)
                        return (
                            <button
                                type="button"
                                key={model.id}
                                onClick={() => selectModelForDetails(model)}
                                className={`w-full text-left p-4 border-b border-white/5 hover:bg-white/5 transition-colors ${
                                    selectedModel?.id === model.id ? `${colors.bg} border-l-2 ${colors.border}` : ''
                                }`}
                            >
                                <div className="font-semibold text-white truncate text-sm mb-1">{cleanModelName(model.name)}</div>
                                <div className="flex items-center gap-2 mt-1.5">
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${colors.bg} border ${colors.border} ${colors.text} font-medium`}>
                                        {model.architecture || guessPublisher(model.id)}
                                    </span>
                                    <span className="text-[10px] px-1.5 py-0.5 bg-white/5 rounded text-gray-400 border border-white/5">{model.size}</span>
                                    {model.context_window && model.context_window !== 'Unknown' && (
                                        <span className="text-[10px] text-gray-600">{model.context_window}</span>
                                    )}
                                </div>
                            </button>
                        )
                    })}
                </div>
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
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => onDownload(selectedModel.id)}
                                disabled={downloading.has(selectedModel.id)}
                                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {downloading.has(selectedModel.id) ? (
                                    <><Loader2 size={16} className="animate-spin" /> {t('models.downloading')}</>
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
