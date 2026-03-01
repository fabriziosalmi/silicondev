import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiClient } from '../api/client';

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
}

interface GlobalStateContextType {
    backendReady: boolean;
    setBackendReady: (ready: boolean) => void;
    systemStats: SystemStats | null;
    activeModel: LoadedModel | null;
    setActiveModel: (model: LoadedModel | null) => void;
    isTraining: boolean;
    setIsTraining: (training: boolean) => void;
    pendingChatInput: string | null;
    setPendingChatInput: (input: string | null) => void;
}

const GlobalStateContext = createContext<GlobalStateContextType | undefined>(undefined);

export function GlobalStateProvider({ children }: { children: React.ReactNode }) {
    const [backendReady, setBackendReady] = useState(false);
    const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
    const [activeModel, setActiveModel] = useState<LoadedModel | null>(null);
    const [isTraining, setIsTraining] = useState(false);
    const [pendingChatInput, setPendingChatInput] = useState<string | null>(null);

    // Poll backend health + stats via HTTP instead of non-existent WebSocket
    useEffect(() => {
        let mounted = true;

        const poll = async () => {
            try {
                const healthy = await apiClient.checkHealth();
                if (!mounted) return;
                setBackendReady(healthy);

                if (healthy) {
                    const stats = await apiClient.monitor.getStats();
                    if (mounted) setSystemStats(stats as unknown as SystemStats);
                }
            } catch {
                if (mounted) setBackendReady(false);
            }
        };

        poll();
        const interval = setInterval(poll, 3000);
        return () => { mounted = false; clearInterval(interval); };
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
