import { useState, useEffect, useCallback, useRef } from 'react'
import { apiClient } from '../../api/client'

interface PreviewState {
    running: boolean
    ready: boolean
    port: number | null
    type: string | null
    loading: boolean
    error: string | null
}

export function usePreviewServer(workspaceDir: string | null) {
    const [state, setState] = useState<PreviewState>({
        running: false,
        ready: false,
        port: null,
        type: null,
        loading: false,
        error: null,
    })

    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const pollStatus = useCallback(async () => {
        try {
            const s = await apiClient.preview.status()
            setState(prev => ({
                ...prev,
                running: s.running,
                ready: s.ready,
                port: s.port,
                type: s.type,
                error: null,
            }))
            // Stop polling once ready or not running
            if (s.ready || !s.running) {
                if (pollRef.current) {
                    clearInterval(pollRef.current)
                    pollRef.current = null
                }
            }
        } catch {
            // Silently ignore poll errors
        }
    }, [])

    const start = useCallback(async () => {
        if (!workspaceDir) return
        setState(prev => ({ ...prev, loading: true, error: null }))
        try {
            const result = await apiClient.preview.start(workspaceDir)
            setState(prev => ({
                ...prev,
                running: true,
                ready: false,
                port: result.port,
                type: result.type,
                loading: false,
            }))
            // Poll for readiness every 1.5s
            pollRef.current = setInterval(pollStatus, 1500)
        } catch (e: any) {
            setState(prev => ({
                ...prev,
                loading: false,
                error: e.message || 'Failed to start preview',
            }))
        }
    }, [workspaceDir, pollStatus])

    const stop = useCallback(async () => {
        setState(prev => ({ ...prev, loading: true }))
        try {
            await apiClient.preview.stop()
        } catch { /* ignore */ }
        if (pollRef.current) {
            clearInterval(pollRef.current)
            pollRef.current = null
        }
        setState({
            running: false,
            ready: false,
            port: null,
            type: null,
            loading: false,
            error: null,
        })
    }, [])

    const refresh = useCallback(() => {
        // Force iframe reload by toggling a key
        setState(prev => ({ ...prev, ready: false }))
        setTimeout(() => setState(prev => ({ ...prev, ready: true })), 100)
    }, [])

    // Check initial status on mount
    useEffect(() => {
        pollStatus()
    }, [pollStatus])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (pollRef.current) clearInterval(pollRef.current)
        }
    }, [])

    // Stop preview when workspace changes
    useEffect(() => {
        return () => {
            // Don't auto-stop — let user decide
        }
    }, [workspaceDir])

    return { ...state, start, stop, refresh }
}
