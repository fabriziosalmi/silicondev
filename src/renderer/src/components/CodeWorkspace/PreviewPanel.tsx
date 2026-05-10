import { useRef, useEffect, useState } from 'react'
import {
    Globe, Play, Square, RefreshCw, ExternalLink,
    Loader2, AlertCircle, ChevronDown, Terminal
} from 'lucide-react'
import { apiClient } from '../../api/client'

interface PreviewPanelProps {
    running: boolean
    ready: boolean
    port: number | null
    type: string | null
    loading: boolean
    error: string | null
    onStart: () => void
    onStop: () => void
    onRefresh: () => void
    onCollapse: () => void
}

export function PreviewPanel({
    running, ready, port, type, loading, error,
    onStart, onStop, onRefresh, onCollapse,
}: PreviewPanelProps) {
    const iframeRef = useRef<HTMLIFrameElement>(null)
    const [showLogs, setShowLogs] = useState(false)
    const [iframeKey, setIframeKey] = useState(0)

    // Reload iframe when ready state changes
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: derive iframe key from external `ready` prop to force iframe reload
        if (ready) setIframeKey(k => k + 1)
    }, [ready])

    const previewUrl = port ? `http://localhost:${port}` : null

    return (
        <div className="flex flex-col bg-[#0f0f0f] border-t border-white/5 overflow-hidden" style={{ height: '100%' }}>
            {/* Toolbar */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#161618] border-b border-white/5 shrink-0">
                <Globe className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-[11px] font-medium text-gray-400 select-none">Preview</span>

                {type && (
                    <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-blue-500/15 text-blue-400 border border-blue-500/20">
                        {type}
                    </span>
                )}

                {port && (
                    <span className="text-[10px] text-gray-600 font-mono ml-1">:{port}</span>
                )}

                <div className="flex-1" />

                {!running && !loading && (
                    <button
                        onClick={onStart}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-green-400 hover:bg-green-500/10 transition-colors"
                        title="Start preview server"
                    >
                        <Play className="w-3 h-3 fill-current" />
                        Start
                    </button>
                )}

                {loading && (
                    <span className="flex items-center gap-1 text-[10px] text-gray-500">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Starting...
                    </span>
                )}

                {running && (
                    <>
                        <button
                            onClick={() => {
                                onRefresh()
                                setIframeKey(k => k + 1)
                            }}
                            className="p-1 rounded hover:bg-white/5 text-gray-500 hover:text-gray-300 transition-colors"
                            title="Refresh"
                        >
                            <RefreshCw className="w-3 h-3" />
                        </button>
                        {previewUrl && (
                            <button
                                onClick={() => window.open(previewUrl, '_blank')}
                                className="p-1 rounded hover:bg-white/5 text-gray-500 hover:text-gray-300 transition-colors"
                                title="Open in browser"
                            >
                                <ExternalLink className="w-3 h-3" />
                            </button>
                        )}
                        <button
                            onClick={() => setShowLogs(!showLogs)}
                            className={`p-1 rounded hover:bg-white/5 transition-colors ${showLogs ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
                            title="Toggle logs"
                        >
                            <Terminal className="w-3 h-3" />
                        </button>
                        <button
                            onClick={onStop}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Stop preview server"
                        >
                            <Square className="w-3 h-3 fill-current" />
                            Stop
                        </button>
                    </>
                )}

                <button
                    onClick={onCollapse}
                    className="p-1 rounded hover:bg-white/5 text-gray-500 hover:text-gray-300 transition-colors ml-1"
                    title="Close preview"
                >
                    <ChevronDown className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 relative overflow-hidden">
                {error && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="flex items-center gap-2 text-red-400 text-sm">
                            <AlertCircle className="w-4 h-4" />
                            {error}
                        </div>
                    </div>
                )}

                {!running && !loading && !error && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                        <Globe className="w-8 h-8 text-gray-700" />
                        <p className="text-xs text-gray-600">Click Start to launch a dev server</p>
                        <button
                            onClick={onStart}
                            className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
                        >
                            Start Preview
                        </button>
                    </div>
                )}

                {running && !ready && !error && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="flex items-center gap-2 text-gray-500 text-sm">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Waiting for server...
                        </div>
                    </div>
                )}

                {running && ready && previewUrl && !showLogs && (
                    <iframe
                        key={iframeKey}
                        ref={iframeRef}
                        src={previewUrl}
                        className="w-full h-full border-0 bg-white"
                        title="Live Preview"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                    />
                )}

                {showLogs && <PreviewLogs />}
            </div>
        </div>
    )
}

/** Minimal log viewer */
function PreviewLogs() {
    const [logs, setLogs] = useState<{ timestamp: number; source: string; message: string }[]>([])
    const scrollRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        let mounted = true
        const poll = async () => {
            try {
                const since = logs.length > 0 ? logs[logs.length - 1].timestamp : 0
                const data = await apiClient.preview.logs(since)
                if (mounted && data.logs.length > 0) {
                    setLogs(prev => [...prev, ...data.logs].slice(-200))
                }
            } catch { /* ignore */ }
        }
        const interval = setInterval(poll, 2000)
        poll()
        return () => { mounted = false; clearInterval(interval) }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps -- intentional: run once on mount, poll manages its own state

    useEffect(() => {
        scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)
    }, [logs])

    return (
        <div ref={scrollRef} className="absolute inset-0 overflow-auto p-2 font-mono text-[10px] leading-4 bg-black/50">
            {logs.map((l, i) => (
                <div key={i} className={l.source === 'stderr' ? 'text-red-400/80' : 'text-gray-500'}>
                    {l.message}
                </div>
            ))}
            {logs.length === 0 && (
                <div className="text-gray-700 text-center mt-8">No output yet...</div>
            )}
        </div>
    )
}
