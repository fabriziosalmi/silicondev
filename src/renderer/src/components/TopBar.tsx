import { useState, useEffect, useRef } from 'react';
import { useGlobalState } from '../context/GlobalState';
import { apiClient, cleanModelName } from '../api/client';
import type { ModelEntry } from '../api/client';
import { DatabaseZap, LogOut, ChevronDown, Loader2, Zap, HardDrive, Search, Cpu, MemoryStick } from 'lucide-react';

const TOPBAR_SETTINGS_KEY = 'silicon-studio-topbar-settings';

function getThresholds(): { warn: number; critical: number } {
    try {
        const saved = localStorage.getItem(TOPBAR_SETTINGS_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            return { warn: parsed.warn ?? 60, critical: parsed.critical ?? 85 };
        }
    } catch { /* ignore */ }
    return { warn: 60, critical: 85 };
}

function MiniBar({ percent }: { percent: number; thresholds: { warn: number; critical: number }; width?: string }) {
    // 5 vertical bars: 1-3 green, 4 amber, 5 red
    const level = Math.round((Math.min(percent, 100) / 100) * 5)
    const heights = [4, 6, 8, 10, 12]
    const barColors = ['bg-emerald-500', 'bg-emerald-500', 'bg-emerald-500', 'bg-amber-500', 'bg-red-500']
    return (
        <div className="flex items-end gap-[2px] h-3">
            {heights.map((h, i) => (
                <div
                    key={i}
                    className={`w-[3.5px] rounded-[1px] transition-all duration-500 ${
                        i < level ? barColors[i] : 'bg-white/10'
                    }`}
                    style={{ height: `${h}px` }}
                />
            ))}
        </div>
    );
}

function StatGroup({ icon, percent, thresholds, detail }: {
    icon: React.ReactNode; percent: number; thresholds: { warn: number; critical: number }; detail: string
}) {
    return (
        <div className="flex items-center gap-1.5 group cursor-default" title={detail}>
            {icon}
            <MiniBar percent={percent} thresholds={thresholds} />
        </div>
    );
}

export function TopBar() {
    const { backendReady, systemStats, activeModel, setActiveModel, isTraining, isGenerating } = useGlobalState();
    const thresholds = getThresholds();
    const [showModelMenu, setShowModelMenu] = useState(false);
    const [models, setModels] = useState<ModelEntry[]>([]);
    const [loadingModelId, setLoadingModelId] = useState<string | null>(null);
    const [modelFilter, setModelFilter] = useState('');
    const menuRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    const handleEject = async () => {
        try { await apiClient.engine.unloadModel(); } catch { /* best-effort */ }
        setActiveModel(null);
    };

    const handleLoadModel = async (model: ModelEntry) => {
        if (isGenerating) return;
        setLoadingModelId(model.id);
        try {
            const result = await apiClient.engine.loadModel(model.id);
            setActiveModel({
                id: model.id,
                name: cleanModelName(model.name),
                size: model.size,
                path: model.local_path || model.id,
                architecture: model.architecture,
                context_window: result.context_window,
                is_vision: result.is_vision,
            });
            setShowModelMenu(false);
            setModelFilter('');
        } catch (err) {
            console.error('Failed to load model from top bar:', err)
        } finally { setLoadingModelId(null); }
    };

    const toggleMenu = async () => {
        if (!showModelMenu) {
            try {
                const all = await apiClient.engine.getModels();
                setModels(all.filter(m => m.downloaded));
            } catch { setModels([]); }
            setTimeout(() => searchRef.current?.focus(), 50);
        }
        setShowModelMenu(!showModelMenu);
        setModelFilter('');
    };

    // Close dropdown on outside click
    useEffect(() => {
        if (!showModelMenu) return;
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setShowModelMenu(false);
                setModelFilter('');
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showModelMenu]);

    const filteredModels = modelFilter
        ? models.filter(m => cleanModelName(m.name).toLowerCase().includes(modelFilter.toLowerCase()))
        : models;

    const ramUsedGB = systemStats ? (systemStats.memory.used / (1024 * 1024 * 1024)).toFixed(1) : '–';
    const ramTotalGB = systemStats ? (systemStats.memory.total / (1024 * 1024 * 1024)).toFixed(0) : '–';
    const diskUsedGB = systemStats ? (systemStats.disk.used / (1024 * 1024 * 1024)).toFixed(0) : '–';
    const diskTotalGB = systemStats ? (systemStats.disk.total / (1024 * 1024 * 1024)).toFixed(0) : '–';

    return (
        <div className="h-10 w-full drag-region flex items-center justify-between px-3 border-b border-white/[0.04] bg-[#131316]/80 backdrop-blur-xl">

            {/* Left: App identity + activity state */}
            <div className="flex items-center gap-3 pl-[72px]">
                <span className="text-[10px] font-bold text-gray-500/80 tracking-widest uppercase select-none">SiliconDev</span>

                {/* Activity pulse — shows what the system is actively doing */}
                {isGenerating && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/15">
                        <div className="w-1 h-1 bg-blue-400 rounded-full animate-pulse" />
                        <span className="text-[9px] font-medium text-blue-400">Generating</span>
                    </div>
                )}
                {isTraining && !isGenerating && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/15">
                        <div className="w-1 h-1 bg-violet-400 rounded-full animate-pulse" />
                        <span className="text-[9px] font-medium text-violet-400">Training</span>
                    </div>
                )}
                {!backendReady && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/15">
                        <Loader2 size={9} className="animate-spin text-amber-400" />
                        <span className="text-[9px] font-medium text-amber-400">Starting</span>
                    </div>
                )}
            </div>

            {/* Right: Model + System stats */}
            <div className="no-drag flex items-center gap-2">

                {/* Model selector */}
                <div className="relative" ref={menuRef}>
                    {activeModel ? (
                        <div className="flex items-center h-7 rounded-md bg-white/[0.04] border border-white/[0.06] overflow-hidden">
                            <button
                                onClick={toggleMenu}
                                className="flex items-center gap-1.5 px-2.5 h-full hover:bg-white/[0.04] transition-colors"
                                title="Switch model"
                            >
                                <Zap size={11} className="text-blue-400 shrink-0" />
                                <span className="text-[10px] font-semibold text-gray-200 max-w-[140px] truncate">{cleanModelName(activeModel.name)}</span>
                                {activeModel.size && (
                                    <span className="text-[9px] text-gray-600 font-mono">{activeModel.size}</span>
                                )}
                                <ChevronDown size={10} className="text-gray-600 shrink-0" />
                            </button>
                            <div className="w-px h-3.5 bg-white/[0.06]" />
                            <button
                                onClick={handleEject}
                                className="flex items-center px-2 h-full text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                title="Unload model"
                            >
                                <LogOut size={11} />
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={toggleMenu}
                            disabled={!backendReady}
                            className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-dashed border-white/10 hover:border-white/20 hover:bg-white/[0.03] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Load a model"
                        >
                            <DatabaseZap size={11} className="text-gray-600" />
                            <span className="text-[10px] text-gray-500 font-medium">Load model</span>
                            <ChevronDown size={10} className="text-gray-700" />
                        </button>
                    )}

                    {/* Model picker dropdown */}
                    {showModelMenu && (
                        <div className="absolute top-full right-0 mt-1.5 w-80 bg-[#18181b] border border-white/10 rounded-xl shadow-2xl shadow-black/40 overflow-hidden z-[100]">
                            {/* Search */}
                            <div className="px-3 py-2 border-b border-white/5">
                                <div className="flex items-center gap-2 px-2 py-1.5 bg-white/[0.04] rounded-lg border border-white/[0.06]">
                                    <Search size={12} className="text-gray-600 shrink-0" />
                                    <input
                                        ref={searchRef}
                                        type="text"
                                        value={modelFilter}
                                        onChange={(e) => setModelFilter(e.target.value)}
                                        placeholder="Filter models..."
                                        className="flex-1 bg-transparent text-[11px] text-white placeholder-gray-600 outline-none"
                                    />
                                    {modelFilter && (
                                        <span className="text-[9px] text-gray-600">{filteredModels.length}</span>
                                    )}
                                </div>
                            </div>
                            <div className="max-h-72 overflow-y-auto">
                                {filteredModels.length === 0 ? (
                                    <div className="px-3 py-6 text-center text-[11px] text-gray-600">
                                        {models.length === 0 ? 'No downloaded models' : 'No matches'}
                                    </div>
                                ) : filteredModels.map(m => {
                                    const isActive = activeModel?.id === m.id;
                                    const isLoading = loadingModelId === m.id;
                                    return (
                                        <button
                                            key={m.id}
                                            onClick={() => handleLoadModel(m)}
                                            disabled={isLoading || isActive}
                                            className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${isActive
                                                ? 'bg-blue-500/8 border-l-2 border-blue-500'
                                                : 'border-l-2 border-transparent hover:bg-white/[0.04]'
                                                } disabled:opacity-50 disabled:cursor-not-allowed`}
                                        >
                                            {isLoading ? (
                                                <Loader2 size={13} className="animate-spin text-blue-400 shrink-0" />
                                            ) : (
                                                <Zap size={13} className={isActive ? 'text-blue-400' : 'text-gray-700'} />
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[11px] font-medium text-gray-200 truncate">{cleanModelName(m.name)}</div>
                                                <div className="text-[9px] text-gray-600 font-mono mt-0.5">
                                                    {m.size}
                                                    {m.architecture ? ` · ${m.architecture}` : ''}
                                                </div>
                                            </div>
                                            {isActive && (
                                                <span className="text-[8px] text-blue-400 font-bold tracking-wider uppercase shrink-0">Active</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* Separator */}
                <div className="h-3.5 w-px bg-white/[0.06]" />

                {/* System stats */}
                {systemStats ? (
                    <div className="flex items-center gap-3.5 bg-black/40 rounded-md h-7 px-2.5">
                        <StatGroup
                            icon={<Cpu size={10} className="text-gray-600" />}
                            percent={systemStats.cpu.percent}
                            thresholds={thresholds}
                            detail={`CPU: ${systemStats.cpu.percent.toFixed(0)}% (${systemStats.cpu.cores} cores)`}
                        />
                        <StatGroup
                            icon={<MemoryStick size={10} className="text-gray-600" />}
                            percent={systemStats.memory.percent}
                            thresholds={thresholds}
                            detail={`RAM: ${ramUsedGB} / ${ramTotalGB} GB`}
                        />
                        <StatGroup
                            icon={<HardDrive size={10} className="text-gray-600" />}
                            percent={systemStats.disk.percent}
                            thresholds={thresholds}
                            detail={`Disk: ${diskUsedGB} / ${diskTotalGB} GB`}
                        />
                    </div>
                ) : (
                    <div className="flex items-center gap-1.5">
                        <Loader2 size={10} className="animate-spin text-gray-700" />
                        <span className="text-[9px] text-gray-700 font-mono">loading</span>
                    </div>
                )}
            </div>
        </div>
    );
}
