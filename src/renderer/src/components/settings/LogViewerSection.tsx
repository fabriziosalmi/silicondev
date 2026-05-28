import { useState } from 'react'
import { Card } from '../ui/Card'
import { apiClient } from '../../api/client'
import { ScrollText, Copy, RefreshCw, Loader2 } from 'lucide-react'

export function LogViewerSection() {
    const [logs, setLogs] = useState<string[]>([])
    const [expanded, setExpanded] = useState(false)
    const [loading, setLoading] = useState(false)

    const fetchLogs = async () => {
        setLoading(true)
        try {
            const data = await apiClient.monitor.getLogs(300)
            setLogs(data.lines)
        } catch { setLogs(['Failed to fetch logs']) }
        finally { setLoading(false) }
    }

    const handleCopy = () => {
        navigator.clipboard.writeText(logs.join('\n')).catch(() => { })
    }

    return (
        <Card className="p-5">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-blue-400"><ScrollText size={16} /></span>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wide">Debug Logs</h3>
                </div>
                <div className="flex items-center gap-2">
                    {expanded && logs.length > 0 && (
                        <button onClick={handleCopy} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-foreground-muted hover:text-foreground hover:bg-hover transition-colors">
                            <Copy size={14} /> Copy
                        </button>
                    )}
                    {expanded && (
                        <button onClick={fetchLogs} disabled={loading} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            Refresh
                        </button>
                    )}
                    <button
                        onClick={() => { if (!expanded) fetchLogs(); setExpanded(!expanded) }}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs text-foreground-muted hover:text-foreground hover:bg-hover transition-colors"
                    >
                        {expanded ? 'Hide' : 'Show Logs'}
                    </button>
                </div>
            </div>
            {!expanded && (
                <p className="text-sm text-foreground-muted">View backend logs for debugging. Useful when reporting bugs.</p>
            )}
            {expanded && (
                <div className="mt-2 max-h-80 overflow-y-auto bg-black/40 border border-outline-subtle rounded-lg p-3 font-mono text-[11px] text-foreground-muted leading-relaxed">
                    {loading && logs.length === 0 ? (
                        <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-foreground-muted" /></div>
                    ) : logs.length === 0 ? (
                        <span className="text-foreground-subtle">No log entries found.</span>
                    ) : (
                        logs.map((line, i) => (
                            <div key={i} className={`whitespace-pre-wrap break-all ${line.includes('ERROR') ? 'text-red-400' : line.includes('WARNING') ? 'text-yellow-400' : ''}`}>
                                {line}
                            </div>
                        ))
                    )}
                </div>
            )}
        </Card>
    )
}
