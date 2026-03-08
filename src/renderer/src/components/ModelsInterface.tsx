import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient, cleanModelName } from '../api/client';
import type { ModelEntry } from '../api/client';
import { PageHeader } from './ui/PageHeader';
import { useToast } from './ui/Toast';
import { Search, Download, Trash2, Database, HardDrive, FileText, Play, LogOut, Zap, Loader2, FolderOpen } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { useGlobalState } from '../context/GlobalState';

const RECOMMENDED_MODELS = [
    { id: 'mlx-community/Qwen3-0.6B-4bit', label: 'Tiny, fast', sizeGB: 0.4 },
    { id: 'mlx-community/Qwen2.5-3B-Instruct-4bit', label: 'Good default', sizeGB: 1.8 },
    { id: 'mlx-community/Llama-3.2-3B-Instruct-4bit', label: 'Meta Llama', sizeGB: 1.8 },
    { id: 'mlx-community/Gemma-3-4b-it-4bit', label: 'Google Gemma', sizeGB: 2.6 },
];

function parseSizeGB(size: string): number {
    const match = size.match(/([\d.]+)\s*GB/i);
    return match ? parseFloat(match[1]) : 0;
}

// Architecture-based color scheme
function archColor(arch: string | undefined): { bg: string; border: string; text: string; dot: string } {
    const a = (arch || '').toLowerCase();
    if (a.includes('qwen')) return { bg: 'bg-violet-500/10', border: 'border-violet-500/20', text: 'text-violet-400', dot: 'bg-violet-400' };
    if (a.includes('llama')) return { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-400', dot: 'bg-blue-400' };
    if (a.includes('gemma')) return { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400', dot: 'bg-emerald-400' };
    if (a.includes('phi')) return { bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', text: 'text-cyan-400', dot: 'bg-cyan-400' };
    if (a.includes('mistral') || a.includes('mixtral')) return { bg: 'bg-orange-500/10', border: 'border-orange-500/20', text: 'text-orange-400', dot: 'bg-orange-400' };
    if (a.includes('lfm')) return { bg: 'bg-pink-500/10', border: 'border-pink-500/20', text: 'text-pink-400', dot: 'bg-pink-400' };
    return { bg: 'bg-gray-500/10', border: 'border-gray-500/20', text: 'text-gray-400', dot: 'bg-gray-400' };
}

function guessQuant(name: string) {
    if (name.toLowerCase().includes('4-bit') || name.toLowerCase().includes('4bit')) return '4-BIT';
    if (name.toLowerCase().includes('8-bit') || name.toLowerCase().includes('8bit')) return '8-BIT';
    if (name.toLowerCase().includes('bf16')) return 'BF16';
    if (name.toLowerCase().includes('fp16')) return 'FP16';
    return '';
}

function guessPublisher(id: string) {
    return id.split('/')[0] || '-';
}

export function ModelsInterface() {
    const { t } = useTranslation();
    const { toast } = useToast();
    const [models, setModels] = useState<ModelEntry[]>([]);
    const [activeTab, setActiveTab] = useState<'my-models' | 'discover'>('my-models');
    const [loading, setLoading] = useState(false);
    const [downloading, setDownloading] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const { setActiveModel, activeModel, systemStats } = useGlobalState();
    const [loadingModelId, setLoadingModelId] = useState<string | null>(null);

    // Split-view State
    const [selectedModel, setSelectedModel] = useState<ModelEntry | null>(null);
    const [readmeContent, setReadmeContent] = useState<string>("");
    const [readmeLoading, setReadmeLoading] = useState(false);

    // Custom Model State
    const [showAddModal, setShowAddModal] = useState(false);
    const [customName, setCustomName] = useState("");
    const [customPath, setCustomPath] = useState("");
    const [foundModels, setFoundModels] = useState<ModelEntry[]>([]);
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    const [scanning, setScanning] = useState(false);

    // Filtering & sorting
    const [searchQuery, setSearchQuery] = useState("");
    const [sortBy, setSortBy] = useState<'name' | 'size' | 'arch'>('name');
    const readmeAbortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        fetchModels();
        return () => { readmeAbortRef.current?.abort(); };
    }, []);

    // Only poll while downloads are active
    useEffect(() => {
        if (downloading.size === 0) return;
        const interval = setInterval(() => fetchModels(true), 5000);
        return () => clearInterval(interval);
    }, [downloading.size]);

    const fetchModels = async (silent = false) => {
        try {
            if (!silent) setLoading(true);
            const data = await apiClient.engine.getModels();
            setModels(data);
            setDownloading(prev => {
                const next = new Set(prev);
                let changed = false;
                for (const id of prev) {
                    const m = data.find(model => model.id === id);
                    if (m && (m.downloaded || !m.downloading)) {
                        next.delete(id);
                        changed = true;
                    }
                }
                return changed ? next : prev;
            });
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            if (!silent) setLoading(false);
        }
    };

    const handleDownload = async (modelId: string) => {
        try {
            setDownloading(prev => new Set(prev).add(modelId));
            await apiClient.engine.downloadModel(modelId);
        } catch (err: unknown) {
            toast(`Failed to start download: ${err instanceof Error ? err.message : String(err)}`, 'error');
            setDownloading(prev => {
                const next = new Set(prev);
                next.delete(modelId);
                return next;
            });
        }
    };

    const handleDelete = async (modelId: string) => {
        if (!confirm(t('models.deleteConfirm'))) return;
        try {
            setLoading(true);
            if (activeModel?.id === modelId) {
                await handleEject();
            }
            await apiClient.engine.deleteModel(modelId);
            await fetchModels();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    };

    const parseContextWindow = (cw: string | undefined): number | undefined => {
        if (!cw || cw === "Unknown") return undefined;
        const match = cw.match(/^(\d+)k$/i);
        if (match) return parseInt(match[1], 10) * 1024;
        const num = parseInt(cw, 10);
        return isNaN(num) ? undefined : num;
    };

    const loadModelIntoMemory = async (model: ModelEntry) => {
        setLoadingModelId(model.id);
        try {
            const result = await apiClient.engine.loadModel(model.id);
            setActiveModel({
                id: model.id,
                name: cleanModelName(model.name),
                size: model.size,
                path: model.local_path || model.id,
                architecture: model.architecture,
                context_window: result.context_window ?? parseContextWindow(model.context_window),
                is_vision: result.is_vision,
            });
            if (result.warning) {
                toast(result.warning, 'warning');
            }
        } catch (e: unknown) {
            toast(`Failed to load model: ${e instanceof Error ? e.message : String(e)}`, 'error');
        } finally {
            setLoadingModelId(null);
        }
    };

    const handleEject = async () => {
        try { await apiClient.engine.unloadModel(); } catch { /* best-effort */ }
        setActiveModel(null);
    };

    const fetchReadme = async (id: string) => {
        readmeAbortRef.current?.abort();
        setReadmeLoading(true);
        try {
            if (id.startsWith('mlx-community/') || id.includes('/')) {
                const controller = new AbortController();
                readmeAbortRef.current = controller;
                const timeout = setTimeout(() => controller.abort(), 5000);
                try {
                    const response = await fetch(`https://huggingface.co/${id}/raw/main/README.md`, { signal: controller.signal });
                    clearTimeout(timeout);
                    if (response.ok) {
                        const text = await response.text();
                        setReadmeContent(text);
                    } else {
                        setReadmeContent("README not found or model is private.");
                    }
                } catch {
                    clearTimeout(timeout);
                    if (!controller.signal.aborted) {
                        setReadmeContent("Unable to fetch README. You may be offline.");
                    }
                }
            } else {
                setReadmeContent("No README available for custom local models.");
            }
        } catch {
            setReadmeContent("Unable to fetch README. Check your internet connection.");
        } finally {
            setReadmeLoading(false);
        }
    };

    const selectModelForDetails = (model: ModelEntry) => {
        setSelectedModel(model);
        fetchReadme(model.id);
    };

    const handleScan = async (path: string) => {
        if (!path) return;
        setScanning(true);
        setError(null);
        try {
            const found = await apiClient.engine.scanModels(path);
            setFoundModels(found);
            setSelectedPaths(new Set(found.map(m => m.path || m.local_path).filter((p): p is string => p !== null)));
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setScanning(false);
        }
    };

    const handleRegister = async () => {
        if (foundModels.length > 0) {
            if (selectedPaths.size === 0) return;
            try {
                setLoading(true);
                for (const path of Array.from(selectedPaths)) {
                    const found = foundModels.find(m => (m.path || m.local_path) === path);
                    const name = found?.name || path.split('/').pop() || customName;
                    await apiClient.engine.registerModel(name, path, "");
                }
                await fetchModels();
                resetAddModal();
            } catch (e: unknown) {
                setError(e instanceof Error ? e.message : String(e));
            } finally {
                setLoading(false);
            }
        } else {
            if (!customName || !customPath) return;
            try {
                setLoading(true);
                await apiClient.engine.registerModel(customName, customPath, "");
                await fetchModels();
                resetAddModal();
            } catch (e: unknown) {
                setError(e instanceof Error ? e.message : String(e));
            } finally {
                setLoading(false);
            }
        }
    }

    const resetAddModal = () => {
        setShowAddModal(false);
        setCustomName("");
        setCustomPath("");
        setFoundModels([]);
        setSelectedPaths(new Set());
    }

    const togglePathSelection = (path: string) => {
        const next = new Set(selectedPaths);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        setSelectedPaths(next);
    };

    // Filter Logic (memoized)
    const availableRamBytes = systemStats?.memory.available ?? 0;
    const diskFreeGB = systemStats ? (systemStats.disk.total - systemStats.disk.used) / (1024 * 1024 * 1024) : null;

    const downloadedModels = useMemo(() =>
        models.filter(m => m.downloaded || downloading.has(m.id) || m.is_custom),
        [models, downloading]
    );

    const discoverableModels = useMemo(() =>
        models.filter(m => !m.is_custom && !m.downloaded && !downloading.has(m.id)),
        [models, downloading]
    );

    const displayedMyModels = useMemo(() => {
        const q = searchQuery.toLowerCase();
        const filtered = downloadedModels.filter(m =>
            m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
        );
        if (sortBy === 'size') {
            filtered.sort((a, b) => parseSizeGB(b.size) - parseSizeGB(a.size));
        } else if (sortBy === 'arch') {
            filtered.sort((a, b) => (a.architecture || '').localeCompare(b.architecture || ''));
        } else {
            filtered.sort((a, b) => cleanModelName(a.name).localeCompare(cleanModelName(b.name)));
        }
        return filtered;
    }, [downloadedModels, searchQuery, sortBy]);

    const displayedDiscoverModels = useMemo(() =>
        discoverableModels.filter(m => {
            const q = searchQuery.toLowerCase();
            const matchesSearch = m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
            if (!matchesSearch) return false;
            const sizeGB = parseSizeGB(m.size);
            if (sizeGB > 0 && availableRamBytes > 0 && sizeGB * 1.07e9 > availableRamBytes) return false;
            return true;
        }),
        [discoverableModels, searchQuery, availableRamBytes]
    );

    // Group models by architecture for "My Models"
    const { archGroups, sortedArchKeys } = useMemo(() => {
        const groups = new Map<string, ModelEntry[]>();
        for (const m of displayedMyModels) {
            const arch = m.architecture || 'Other';
            if (!groups.has(arch)) groups.set(arch, []);
            groups.get(arch)!.push(m);
        }
        const keys = Array.from(groups.keys()).sort((a, b) => {
            const aHasActive = groups.get(a)!.some(m => m.id === activeModel?.id);
            const bHasActive = groups.get(b)!.some(m => m.id === activeModel?.id);
            if (aHasActive && !bHasActive) return -1;
            if (!aHasActive && bHasActive) return 1;
            return a.localeCompare(b);
        });
        return { archGroups: groups, sortedArchKeys: keys };
    }, [displayedMyModels, activeModel?.id]);

    const totalSizeGB = useMemo(() =>
        downloadedModels.reduce((sum, m) => sum + parseSizeGB(m.size), 0),
        [downloadedModels]
    );

    return (
        <div className="h-full flex flex-col text-white overflow-hidden pb-4">
            <PageHeader>
                <button
                    type="button"
                    onClick={() => { resetAddModal(); setShowAddModal(true); }}
                    className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors border border-white/5 whitespace-nowrap flex items-center gap-2"
                >
                    <FolderOpen size={14} />
                    Add Local Folder
                </button>
            </PageHeader>

            {/* Tabs + Stats bar */}
            <div className="flex items-center justify-between mb-5 border-b border-white/10 px-1">
                <div className="flex gap-6">
                    <button
                        type="button"
                        onClick={() => { setActiveTab('my-models'); setSearchQuery(''); }}
                        className={`pb-3 text-sm font-medium transition-colors relative ${activeTab === 'my-models' ? 'text-blue-400' : 'text-gray-400 hover:text-white'}`}
                    >
                        {t('models.myModels')} ({downloadedModels.length})
                        {activeTab === 'my-models' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-400 rounded-full" />}
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('discover')}
                        className={`pb-3 text-sm font-medium transition-colors relative ${activeTab === 'discover' ? 'text-blue-400' : 'text-gray-400 hover:text-white'}`}
                    >
                        {t('models.discover')}
                        {activeTab === 'discover' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-400 rounded-full" />}
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

                {/* --- MY MODELS VIEW (Card Grid) --- */}
                {activeTab === 'my-models' && (
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
                            {loading && models.length === 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                    {[1,2,3,4,5,6].map(i => (
                                        <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-3">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-lg bg-white/5 animate-pulse" />
                                                <div className="flex-1 space-y-2">
                                                    <div className="h-3 w-32 bg-white/5 rounded animate-pulse" />
                                                    <div className="h-2 w-20 bg-white/[0.03] rounded animate-pulse" />
                                                </div>
                                            </div>
                                            <div className="flex gap-2">
                                                <div className="h-5 w-12 bg-white/5 rounded animate-pulse" />
                                                <div className="h-5 w-12 bg-white/5 rounded animate-pulse" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : displayedMyModels.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-64">
                                    {searchQuery ? (
                                        <div className="text-center text-gray-500">No models match your search.</div>
                                    ) : (
                                        <div className="max-w-md mx-auto text-center">
                                            <Database className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                                            <h3 className="text-lg font-semibold text-white mb-1">{t('models.noModels')}</h3>
                                            <p className="text-sm text-gray-400 mb-4">
                                                {t('models.goToDiscover')}
                                            </p>
                                            <button
                                                type="button"
                                                onClick={() => { setActiveTab('discover'); setSearchQuery(''); }}
                                                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
                                            >
                                                {t('models.discover')}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    {sortedArchKeys.map(arch => {
                                        const groupModels = archGroups.get(arch)!.slice().sort((a, b) => {
                                            const aActive = activeModel?.id === a.id ? 0 : 1;
                                            const bActive = activeModel?.id === b.id ? 0 : 1;
                                            if (aActive !== bActive) return aActive - bActive;
                                            return cleanModelName(a.name).localeCompare(cleanModelName(b.name));
                                        });
                                        const colors = archColor(arch);
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
                                                        const isActive = activeModel?.id === model.id;
                                                        const isLoading = loadingModelId === model.id;
                                                        const quant = model.quantization || guessQuant(model.name);
                                                        return (
                                                            <div
                                                                key={model.id}
                                                                className={`group relative rounded-xl border p-4 transition-all ${
                                                                    isActive
                                                                        ? `${colors.bg} ${colors.border} ring-1 ring-emerald-500/20`
                                                                        : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/10'
                                                                }`}
                                                            >
                                                                {/* Active indicator */}
                                                                {isActive && (
                                                                    <div className="absolute top-3 right-3 flex items-center gap-1.5">
                                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                                                        <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400">{t('models.active')}</span>
                                                                    </div>
                                                                )}

                                                                {/* Model info */}
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

                                                                {/* Badges */}
                                                                <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                                                                    {model.size && model.size !== '0.00GB' && (
                                                                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 border border-white/[0.06] text-gray-400">
                                                                            {model.size}
                                                                        </span>
                                                                    )}
                                                                    {quant && (
                                                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${colors.bg} border ${colors.border} ${colors.text} uppercase tracking-wide`}>
                                                                            {quant}
                                                                        </span>
                                                                    )}
                                                                    {model.context_window && model.context_window !== 'Unknown' && (
                                                                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 border border-white/[0.06] text-gray-500">
                                                                            {model.context_window} ctx
                                                                        </span>
                                                                    )}
                                                                </div>

                                                                {/* Actions — always visible */}
                                                                <div className="flex items-center gap-2">
                                                                    {isActive ? (
                                                                        <button
                                                                            type="button"
                                                                            onClick={handleEject}
                                                                            aria-label="Eject model"
                                                                            className="flex-1 h-8 flex items-center justify-center gap-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors text-[11px] font-bold uppercase tracking-wide"
                                                                        >
                                                                            <LogOut size={12} />
                                                                            {t('models.eject')}
                                                                        </button>
                                                                    ) : (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => loadModelIntoMemory(model)}
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
                                                                        onClick={() => handleDelete(model.id)}
                                                                        disabled={isActive || downloading.has(model.id)}
                                                                        aria-label={`Delete ${cleanModelName(model.name)}`}
                                                                        className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/[0.06] text-gray-600 hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                                        title={downloading.has(model.id) ? t('models.downloading') : t('models.delete')}
                                                                    >
                                                                        <Trash2 size={13} />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* --- DISCOVER VIEW (Split-View) --- */}
                {activeTab === 'discover' && (
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
                                                if (availableRamBytes > 0 && rec.sizeGB * 1.07e9 > availableRamBytes) return false;
                                                return true;
                                            }).map(rec => {
                                                const catalogModel = discoverableModels.find(m => m.id === rec.id);
                                                if (!catalogModel) return null;
                                                const isDownloading = downloading.has(rec.id);
                                                const colors = archColor(catalogModel.architecture);
                                                return (
                                                    <div key={rec.id} className={`${colors.bg} border ${colors.border} rounded-lg p-3 flex flex-col gap-1.5`}>
                                                        <div className="text-xs font-semibold text-white truncate">{cleanModelName(catalogModel.name)}</div>
                                                        <div className="flex items-center gap-1.5">
                                                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${colors.text} font-medium`}>{rec.label}</span>
                                                            <span className="text-[10px] text-gray-500">{catalogModel.size}</span>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDownload(rec.id)}
                                                            disabled={isDownloading}
                                                            className="mt-1 w-full text-center text-[10px] font-bold uppercase tracking-wide py-1.5 rounded bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                        >
                                                            {isDownloading ? t('models.downloading') : t('models.download')}
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                {displayedDiscoverModels.map(model => {
                                    const colors = archColor(model.architecture);
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
                                    );
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
                                            onClick={() => handleDownload(selectedModel.id)}
                                            disabled={downloading.has(selectedModel.id)}
                                            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {downloading.has(selectedModel.id) ? (
                                                <>
                                                    <Loader2 size={16} className="animate-spin" />
                                                    {t('models.downloading')}
                                                </>
                                            ) : (
                                                <>
                                                    <Download className="w-4 h-4" />
                                                    {t('models.download')}
                                                </>
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
                )}
            </div>

            {/* Add Custom Local Folder Modal */}
            {showAddModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => resetAddModal()}>
                    <div className="bg-[#18181B] border border-white/10 rounded-xl max-w-md w-full p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                            <HardDrive className="w-5 h-5 text-blue-400" />
                            Add Local Model Directory
                        </h3>

                        {error && (
                            <div className="mb-4 bg-red-500/10 border border-red-500/20 text-red-400 px-3 py-2 rounded-lg text-xs flex justify-between items-center">
                                <span>{error}</span>
                                <button type="button" onClick={() => setError(null)} className="text-red-400/60 hover:text-red-400 ml-2 shrink-0" aria-label="Dismiss error">✕</button>
                            </div>
                        )}

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs uppercase text-gray-500 font-semibold mb-1.5">Model Alias</label>
                                <input
                                    type="text"
                                    value={customName}
                                    onChange={(e) => setCustomName(e.target.value)}
                                    placeholder="e.g. My Meta Llama Finetune"
                                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-blue-500 text-sm"
                                />
                            </div>

                            <div>
                                <label className="block text-xs uppercase text-gray-500 font-semibold mb-1.5">Local Directory Path</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={customPath}
                                        onChange={(e) => setCustomPath(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter' && customPath) handleScan(customPath); }}
                                        placeholder="/Users/name/models/llama-3 or ~/.lmstudio/models"
                                        className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-blue-500 text-sm"
                                    />
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            try {
                                                const path = await window.electronAPI?.selectDirectory?.();
                                                if (path) {
                                                    setCustomPath(path);
                                                    handleScan(path);
                                                }
                                            } catch {
                                                if (customPath) handleScan(customPath);
                                            }
                                        }}
                                        className="bg-white/10 hover:bg-blue-500 hover:text-white text-gray-300 px-4 py-2 rounded-lg transition-colors text-sm font-medium"
                                    >
                                        Browse
                                    </button>
                                    {!foundModels.length && customPath && !scanning && (
                                        <button
                                            type="button"
                                            onClick={() => handleScan(customPath)}
                                            className="bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 px-4 py-2 rounded-lg transition-colors text-sm font-medium border border-blue-500/20"
                                        >
                                            Scan
                                        </button>
                                    )}
                                </div>
                                <div className="flex gap-2 mt-3">
                                    {[
                                        { label: 'LM Studio', path: '~/.lmstudio/models', name: 'LM Studio Models' },
                                        { label: 'Ollama', path: '~/.ollama/models', name: 'Ollama Models' },
                                        { label: 'HF Cache', path: '~/.cache/huggingface/hub', name: 'HF Hub Cache' },
                                    ].map(preset => (
                                        <button
                                            key={preset.label}
                                            type="button"
                                            onClick={() => {
                                                setCustomName(preset.name);
                                                setCustomPath(preset.path);
                                                handleScan(preset.path);
                                            }}
                                            className="text-[10px] font-bold bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                                        >
                                            <div className="w-1 h-1 rounded-full bg-blue-400" />
                                            {preset.label}
                                        </button>
                                    ))}
                                </div>

                                {scanning && (
                                    <div className="mt-4 flex items-center gap-2 text-xs text-gray-400">
                                        <Loader2 size={12} className="animate-spin" />
                                        Scanning directory for MLX models...
                                    </div>
                                )}

                                {foundModels.length > 0 && (
                                    <div className="mt-6 border border-white/10 rounded-lg overflow-hidden bg-black/40 max-h-48 overflow-y-auto">
                                        <div className="bg-white/5 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-400 border-b border-white/5 flex justify-between">
                                            <span>Found Models ({foundModels.length})</span>
                                            <span>Select</span>
                                        </div>
                                        {foundModels.map(m => (
                                            <div key={m.path} className="flex items-center justify-between px-3 py-2 border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                                                <div className="min-w-0 flex-1 mr-3">
                                                    <div className="text-xs font-medium text-white truncate">{m.name}</div>
                                                    <div className="text-[10px] text-gray-500 flex gap-2">
                                                        <span>{m.architecture}</span>
                                                        <span>{m.size}</span>
                                                    </div>
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    title={`Select ${m.name}`}
                                                    checked={selectedPaths.has(m.path || '')}
                                                    onChange={() => togglePathSelection(m.path || '')}
                                                    className="w-4 h-4 rounded border-white/10 bg-black/40 text-blue-500"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {foundModels.length === 0 && !scanning && customPath && (
                                    <p className="text-[11px] text-gray-500 mt-2">
                                        Supported formats: MLX safetensors. The directory must contain `config.json`.
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 mt-8 pt-4 border-t border-white/5">
                            <button
                                type="button"
                                onClick={() => resetAddModal()}
                                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:bg-white/5 transition-colors"
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={handleRegister}
                                disabled={(!customName || (!customPath && selectedPaths.size === 0)) || loading || scanning}
                                className="px-5 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {foundModels.length > 0 ? `${t('models.addModel')} (${selectedPaths.size})` : t('models.addModel')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
