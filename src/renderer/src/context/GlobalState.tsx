import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { apiClient, initApiBase } from '../api/client';

interface SystemStats {
    memory: {
        total: number;
        available: number;
        used: number;
        percent: number;
    };
    disk: {
        total: number;
        free: number;
        used: number;
        percent: number;
    };
    cpu: {
        percent: number;
        cores: number;
    };
    gpu?: {
        available: boolean;
        model?: string;
        cores?: number;
        utilization?: number;
        memory_in_use?: number;
        memory_allocated?: number;
    };
    scout_recommendations?: number;
    platform: {
        system: string;
        processor: string;
        release: string;
    };
}

interface LoadedModel {
    id: string;
    name: string;
    size: string;
    path: string;
    architecture?: string;
    context_window?: number;
    is_vision?: boolean;
}

interface GlobalStateContextType {
    backendReady: boolean;
    setBackendReady: (ready: boolean) => void;
    systemStats: SystemStats | null;
    activeModel: LoadedModel | null;
    setActiveModel: (model: LoadedModel | null) => void;
    isTraining: boolean;
    setIsTraining: (training: boolean) => void;
    isGenerating: boolean;
    setIsGenerating: (generating: boolean) => void;
    pendingChatInput: string | null;
    setPendingChatInput: (input: string | null) => void;
}

const GlobalStateContext = createContext<GlobalStateContextType | undefined>(undefined);

export function GlobalStateProvider({ children }: { children: React.ReactNode }) {
    const [backendReady, setBackendReady] = useState(false);
    const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
    const [activeModel, _setActiveModel] = useState<LoadedModel | null>(null);
    const [isTraining, setIsTraining] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [pendingChatInput, setPendingChatInput] = useState<string | null>(null);

    // Poll backend health + stats — only update state when values actually change
    // to avoid unnecessary re-renders that cause visible flicker
    const lastStatsJson = useRef<string>('');
    const lastActiveModelId = useRef<string | null>(null);

    // Wrap setActiveModel so external callers (TopBar) also sync the polling ref,
    // preventing the next poll from overwriting a valid model with null.
    const setActiveModel = React.useCallback((model: LoadedModel | null) => {
        const prev = lastActiveModelId.current;
        lastActiveModelId.current = model?.id ?? null;
        if (model && !prev) console.info('[GlobalState] Model loaded:', model.name);
        if (!model && prev) console.info('[GlobalState] Model unloaded');
        _setActiveModel(model);
    }, []);

    useEffect(() => {
        let mounted = true;
        let interval: ReturnType<typeof setInterval>;

        const poll = async () => {
            try {
                const healthy = await apiClient.checkHealth();
                if (!mounted) return;
                setBackendReady(prev => prev === healthy ? prev : healthy);

                if (healthy) {
                    const stats = await apiClient.monitor.getStats();
                    if (!mounted) return;
                    const json = JSON.stringify(stats);
                    if (json !== lastStatsJson.current) {
                        lastStatsJson.current = json;
                        setSystemStats(stats as unknown as SystemStats);
                    }

                    // Sync active model state with backend
                    try {
                        const { model } = await apiClient.engine.getActiveModel();
                        if (!mounted) return;
                        const newId = model?.id ?? null;
                        if (newId !== lastActiveModelId.current) {
                            lastActiveModelId.current = newId;
                            setActiveModel(model);
                        }
                    } catch {
                        // ignore — endpoint may not exist on older backends
                    }
                }
            } catch {
                if (mounted) setBackendReady(prev => prev ? false : prev);
            }
        };

        let fastInterval: ReturnType<typeof setInterval> | null = null;

        const startSlowPolling = () => {
            clearInterval(interval);
            interval = setInterval(poll, 5000);
        };

        const startPolling = () => {
            clearInterval(interval);
            if (fastInterval) clearInterval(fastInterval);
            poll();
            // Fast poll (500ms) until backend is ready, then slow (5s)
            fastInterval = setInterval(async () => {
                if (!mounted) return;
                try {
                    const ok = await apiClient.checkHealth();
                    if (ok && fastInterval) {
                        clearInterval(fastInterval);
                        fastInterval = null;
                        startSlowPolling();
                    }
                } catch { /* retry */ }
            }, 500);
            // Safety: stop fast polling after 30s regardless
            setTimeout(() => {
                if (fastInterval) { clearInterval(fastInterval); fastInterval = null; startSlowPolling(); }
            }, 30000);
        };

        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                startPolling();
            } else {
                clearInterval(interval);
                if (fastInterval) { clearInterval(fastInterval); fastInterval = null; }
            }
        };

        const init = async () => {
            await initApiBase();
            if (!mounted) return;
            document.addEventListener('visibilitychange', onVisibilityChange);
            startPolling();
        };
        init();

        return () => {
            mounted = false;
            clearInterval(interval);
            if (fastInterval) clearInterval(fastInterval);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, []);

    return (
        <GlobalStateContext.Provider value={{
            backendReady,
            setBackendReady,
            systemStats,
            activeModel,
            setActiveModel,
            isTraining,
            setIsTraining,
            isGenerating,
            setIsGenerating,
            pendingChatInput,
            setPendingChatInput,
        }}>
            {children}
        </GlobalStateContext.Provider>
    );
}

export function useGlobalState() {
    const context = useContext(GlobalStateContext);
    if (context === undefined) {
        throw new Error('useGlobalState must be used within a GlobalStateProvider');
    }
    return context;
}
