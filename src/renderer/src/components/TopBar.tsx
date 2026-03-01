import { useGlobalState } from '../context/GlobalState';
import { apiClient, cleanModelName } from '../api/client';
import { DatabaseZap, LogOut } from 'lucide-react';

export function TopBar() {
    const { backendReady, systemStats, activeModel, setActiveModel, isTraining } = useGlobalState();

    const handleEject = async () => {
        try { await apiClient.engine.unloadModel(); } catch { /* best-effort */ }
        setActiveModel(null);
    };

    return (
        <div className="h-10 w-full drag-region bg-[#18181B]/90 backdrop-blur-xl border-b border-white/5 flex items-center justify-between px-4 z-50">

            {/* Left: Window Title Placeholder */}
            <div className="flex items-center space-x-2 pl-[80px]">
                {/* pl-[80px] clears mac OS window traffic light buttons perfectly */}
                <span className="text-[10px] font-bold text-gray-500 tracking-wide uppercase">Silicon Studio</span>
            </div>

            {/* Center/Right: Status Indicators */}
            <div className="no-drag flex items-center space-x-6">

                {/* Backend Status */}
                <div className="flex items-center space-x-2 h-full">
                    <div className={`w-1.5 h-1.5 rounded-full ${backendReady ? 'bg-green-500' : 'bg-yellow-500'}`} />
                    <span className="text-[10px] text-gray-400 font-medium">
                        {backendReady ? 'Ready' : 'Starting...'}
                    </span>
                </div>

                <div className="h-4 w-px bg-white/10" />

                {/* Active Model */}
                {activeModel ? (
                    <div className="flex items-center space-x-2 bg-blue-500/10 h-7 px-2.5 rounded border border-blue-500/20">
                        <DatabaseZap size={13} className="text-blue-400" />
                        <span className="text-[11px] font-medium text-blue-300">{cleanModelName(activeModel.name)}</span>
                        <div className="w-px h-3.5 bg-blue-500/20 mx-1"></div>
                        <button
                            onClick={handleEject}
                            className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Unload model from memory"
                        >
                            <LogOut size={11} />
                            <span className="text-[10px] font-medium">Eject</span>
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center space-x-2 h-7 px-2.5 border border-transparent">
                        <span className="text-[11px] text-gray-500 font-medium">No model loaded</span>
                    </div>
                )}

                <div className="h-4 w-px bg-white/10" />

                {/* System Stats (RAM/VRAM) */}
                {systemStats ? (
                    <div className="flex items-center space-x-4">
                        <div className="flex items-center gap-1.5" title="System RAM Usage">
                            <span className="text-[10px] text-gray-500 font-mono">RAM</span>
                            <span className="text-[11px] text-gray-300 font-mono tabular-nums">
                                {(systemStats.memory.used / (1024 * 1024 * 1024)).toFixed(1)}
                                <span className="text-gray-500">/{(systemStats.memory.total / (1024 * 1024 * 1024)).toFixed(0)}GB</span>
                            </span>
                        </div>

                        <div className="flex items-center gap-1.5" title="CPU Load">
                            <span className="text-[10px] text-gray-500 font-mono">CPU</span>
                            <span className="text-[11px] text-gray-300 font-mono tabular-nums">
                                {systemStats.cpu.percent.toFixed(0)}%
                            </span>
                        </div>
                    </div>
                ) : (
                    <span className="text-xs text-gray-600 font-mono">Loading Stats...</span>
                )}

                {/* Global Task Indicator (Training) */}
                {isTraining && (
                    <>
                        <div className="h-4 w-px bg-white/10" />
                        <div className="flex items-center space-x-1.5">
                            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
                            <span className="text-xs text-blue-400 font-medium">Training Active</span>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
