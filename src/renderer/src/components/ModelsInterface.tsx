import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { apiClient, cleanModelName } from '../api/client'
import type { ModelEntry } from '../api/client'
import { PageHeader } from './ui/PageHeader'
import { useToast } from './ui/Toast'
import { useConfirm } from './ui/ConfirmDialog'
import { HardDrive, FolderOpen } from 'lucide-react'
import { useGlobalState } from '../context/GlobalState'
import { parseSizeGB } from './models/ModelsUtils'
import { MyModelsTab } from './models/MyModelsTab'
import { DiscoverTab } from './models/DiscoverTab'
import { AddModelModal } from './models/AddModelModal'

export function ModelsInterface() {
    const { t } = useTranslation()
    const { toast } = useToast()
    const { confirm } = useConfirm()
    const [models, setModels] = useState<ModelEntry[]>([])
    // Default tab is "my-models" once the user has any; first-time users land
    // on "discover" so the first thing they see is models they can install.
    const [activeTab, setActiveTab] = useState<'my-models' | 'discover'>('discover')
    const [tabAutoSwitched, setTabAutoSwitched] = useState(false)
    const [loading, setLoading] = useState(false)
    const [downloading, setDownloading] = useState<Set<string>>(new Set())
    const [error, setError] = useState<string | null>(null)
    const { setActiveModel, activeModel, systemStats } = useGlobalState()
    const [loadingModelId, setLoadingModelId] = useState<string | null>(null)
    const [showAddModal, setShowAddModal] = useState(false)
    const [searchQuery, setSearchQuery] = useState("")

    useEffect(() => { fetchModels() }, [])

    useEffect(() => {
        if (downloading.size === 0) return
        const interval = setInterval(() => fetchModels(true), 5000)
        return () => clearInterval(interval)
    }, [downloading.size])

    const fetchModels = async (silent = false) => {
        try {
            if (!silent) setLoading(true)
            const data = await apiClient.engine.getModels()
            setModels(data)
            setError(null) // M-2: clear stale error on successful refresh
            setDownloading(prev => {
                const next = new Set(prev)
                let changed = false
                for (const id of prev) {
                    const m = data.find(model => model.id === id)
                    if (m && (m.downloaded || !m.downloading)) {
                        next.delete(id)
                        changed = true
                    }
                }
                return changed ? next : prev
            })
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            if (!silent) setLoading(false)
        }
    }

    const handleDownload = async (modelId: string) => {
        try {
            setDownloading(prev => new Set(prev).add(modelId))
            await apiClient.engine.downloadModel(modelId)
        } catch (err: unknown) {
            toast(`Failed to start download: ${err instanceof Error ? err.message : String(err)}`, 'error')
            setDownloading(prev => {
                const next = new Set(prev)
                next.delete(modelId)
                return next
            })
        }
    }

    const handleDelete = async (modelId: string) => {
        // M-1: Block delete while the model is being downloaded
        if (downloading.has(modelId)) {
            toast(t('models.deleteWhileDownloading', { defaultValue: 'Cannot delete while download is in progress.' }), 'error')
            return
        }
        const ok = await confirm({
            title: t('models.deleteTitle', { defaultValue: 'Delete model' }),
            message: t('models.deleteConfirm'),
            confirmLabel: t('common.delete', { defaultValue: 'Delete' }),
            destructive: true,
        });
        if (!ok) return
        try {
            setLoading(true)
            if (activeModel?.id === modelId) await handleEject()
            await apiClient.engine.deleteModel(modelId)
            await fetchModels()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setLoading(false)
        }
    }

    const parseContextWindow = (cw: string | undefined): number | undefined => {
        if (!cw || cw === "Unknown") return undefined
        const match = cw.match(/^(\d+)k$/i)
        if (match) return parseInt(match[1], 10) * 1024
        const num = parseInt(cw, 10)
        return isNaN(num) ? undefined : num
    }

    const loadModelIntoMemory = async (model: ModelEntry) => {
        setLoadingModelId(model.id)
        try {
            const result = await apiClient.engine.loadModel(model.id)
            setActiveModel({
                id: model.id,
                name: cleanModelName(model.name),
                size: model.size,
                path: model.local_path || model.id,
                architecture: model.architecture,
                context_window: result.context_window ?? parseContextWindow(model.context_window),
                is_vision: result.is_vision,
            })
            if (result.warning) toast(result.warning, 'warning')
        } catch (e: unknown) {
            toast(`Failed to load model: ${e instanceof Error ? e.message : String(e)}`, 'error')
        } finally {
            setLoadingModelId(null)
        }
    }

    const handleEject = async () => {
        try { await apiClient.engine.unloadModel() } catch { /* best-effort */ }
        setActiveModel(null)
    }

    const availableRamBytes = systemStats?.memory.available ?? 0
    const diskFreeGB = systemStats ? (systemStats.disk.total - systemStats.disk.used) / (1024 * 1024 * 1024) : null

    const downloadedModels = useMemo(() =>
        models.filter(m => m.downloaded || downloading.has(m.id) || m.is_custom),
        [models, downloading]
    )

    // Once we know the user has at least one model, switch the default tab to
    // My Models — but only on first load, never after the user has manually
    // navigated.
    useEffect(() => {
        if (tabAutoSwitched) return
        if (downloadedModels.length > 0 && activeTab === 'discover') {
            setActiveTab('my-models')
        }
        if (models.length > 0) setTabAutoSwitched(true)
    }, [models.length, downloadedModels.length, activeTab, tabAutoSwitched])

    const discoverableModels = useMemo(() =>
        models.filter(m => !m.is_custom && !m.downloaded && !downloading.has(m.id)),
        [models, downloading]
    )

    // Only count models that are actually on disk (exclude in-progress downloads).
    const totalSizeGB = useMemo(() =>
        downloadedModels
            .filter(m => m.downloaded || m.is_custom)  // exclude downloading-in-progress
            .reduce((sum, m) => sum + parseSizeGB(m.size), 0),
        [downloadedModels]
    )

    return (
        <div className="h-full flex flex-col text-white overflow-hidden pb-4">
            <PageHeader>
                <button
                    type="button"
                    onClick={() => setShowAddModal(true)}
                    className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors border border-white/5 whitespace-nowrap flex items-center gap-2"
                >
                    <FolderOpen size={14} />
                    {t('models.addLocalFolder', { defaultValue: 'Add Local Folder' })}
                </button>
            </PageHeader>

            {/* Tabs + Stats bar */}
            <div className="flex items-center justify-between mb-5 border-b border-white/10 px-1">
                <div className="flex gap-6">
                    <button
                        type="button"
                        onClick={() => { setActiveTab('discover'); setSearchQuery(''); setTabAutoSwitched(true) }}
                        className={`pb-3 text-sm font-medium transition-colors relative ${activeTab === 'discover' ? 'text-blue-400' : 'text-gray-400 hover:text-white'}`}
                    >
                        {t('models.discover')}
                        {activeTab === 'discover' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-400 rounded-full" />}
                    </button>
                    <button
                        type="button"
                        onClick={() => { setActiveTab('my-models'); setSearchQuery(''); setTabAutoSwitched(true) }}
                        className={`pb-3 text-sm font-medium transition-colors relative ${activeTab === 'my-models' ? 'text-blue-400' : 'text-gray-400 hover:text-white'}`}
                    >
                        {t('models.myModels')} ({downloadedModels.length})
                        {activeTab === 'my-models' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-400 rounded-full" />}
                    </button>
                </div>
                <div className="flex items-center gap-4 pb-3 text-[11px] text-gray-500">
                    {activeTab === 'my-models' && downloadedModels.length > 0 && (
                        <>
                            <span>{downloadedModels.length} models</span>
                            {totalSizeGB > 0 && <span>{totalSizeGB.toFixed(1)} GB used</span>}
                        </>
                    )}
                    {diskFreeGB !== null && (
                        <span className={diskFreeGB < 5 ? 'text-red-400' : diskFreeGB < 20 ? 'text-amber-400' : ''}>
                            <HardDrive size={10} className="inline mr-1" />
                            {t('models.diskFree', { size: diskFreeGB.toFixed(0) })}
                        </span>
                    )}
                    {activeModel && (
                        <span className="flex items-center gap-1.5 text-emerald-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            {cleanModelName(activeModel.name)} loaded
                        </span>
                    )}
                </div>
            </div>

            {error && (
                <div className="mb-4 bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-lg text-sm flex justify-between items-center">
                    <span>{error}</span>
                    <button type="button" onClick={() => setError(null)} className="text-white/40 hover:text-white">✕</button>
                </div>
            )}

            <div className="flex-1 overflow-hidden min-h-0 relative">
                {activeTab === 'my-models' ? (
                    <MyModelsTab
                        models={loading && models.length === 0 ? [] : downloadedModels}
                        downloading={downloading}
                        activeModelId={activeModel?.id}
                        loadingModelId={loadingModelId}
                        searchQuery={searchQuery}
                        setSearchQuery={setSearchQuery}
                        onLoad={loadModelIntoMemory}
                        onEject={handleEject}
                        onDelete={handleDelete}
                        onSwitchToDiscover={() => { setActiveTab('discover'); setSearchQuery('') }}
                    />
                ) : (
                    <DiscoverTab
                        models={discoverableModels}
                        downloading={downloading}
                        downloadProgress={new Map(models.filter(m => m.downloading).map(m => [m.id, m.download_progress ?? 0]))}
                        availableRamBytes={availableRamBytes}
                        searchQuery={searchQuery}
                        setSearchQuery={setSearchQuery}
                        onDownload={handleDownload}
                    />
                )}
            </div>

            {showAddModal && (
                <AddModelModal
                    onClose={() => setShowAddModal(false)}
                    onModelsAdded={fetchModels}
                />
            )}
        </div>
    )
}
