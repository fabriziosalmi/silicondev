import { useState, useEffect } from 'react'
import { Card } from '../ui/Card'
import { apiClient } from '../../api/client'
import { FolderSearch, FolderOpen, Trash2, Loader2 } from 'lucide-react'

export function CodebaseIndexSection() {
    const [status, setStatus] = useState<{ indexed: boolean; directory?: string; file_count?: number; chunk_count?: number; indexed_at?: number; has_embeddings?: boolean } | null>(null)
    const [loading, setLoading] = useState(true)
    const [indexing, setIndexing] = useState(false)
    const [indexResult, setIndexResult] = useState<string | null>(null)
    const [showManualPath, setShowManualPath] = useState(false)
    const [manualPath, setManualPath] = useState("")

    const fetchStatus = async () => {
        try {
            const s = await apiClient.codebase.getStatus()
            setStatus(s)
        } catch { setStatus({ indexed: false }) }
        finally { setLoading(false) }
    }

    useEffect(() => { fetchStatus() }, [])

    const handlePickDirectory = async () => {
        // In Electron: use native file picker dialog
        // In browser: electronAPI is undefined → picker silently returns undefined.
        // Fall through to manual path input immediately.
        if (!window.electronAPI?.selectDirectory) {
            // Pre-fill with current workspace dir if already set
            const saved = localStorage.getItem('silicon-studio-workspace-dir')
            if (saved) setManualPath(saved)
            setShowManualPath(true)
            return
        }
        try {
            const dir = await window.electronAPI.selectDirectory()
            if (dir) {
                handleIndex(dir)
            }
        } catch {
            setShowManualPath(true)
        }
    }

    const handleIndex = async (directory: string) => {
        setIndexing(true)
        setIndexResult(null)
        localStorage.setItem('silicon-studio-workspace-dir', directory)
        window.dispatchEvent(new CustomEvent('workspace-dir-changed', { detail: directory }))
        try {
            const result = await apiClient.codebase.index(directory)
            setIndexResult(`Indexed ${result.file_count} files into ${result.chunk_count} chunks`)
            fetchStatus()
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Indexing failed'
            setIndexResult(msg.includes('No source files') ? 'Workspace set. No source files found for semantic search, but you can browse files in the Code tab.' : msg)
        } finally { setIndexing(false) }
    }

    const handleDelete = async () => {
        if (!confirm('Delete the codebase index? You can re-index at any time.')) return
        try {
            await apiClient.codebase.deleteIndex()
            localStorage.removeItem('silicon-studio-workspace-dir')
            window.dispatchEvent(new CustomEvent('workspace-dir-changed', { detail: null }))
            setStatus({ indexed: false })
            setIndexResult(null)
        } catch { /* ignore */ }
    }

    return (
        <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <span className="text-blue-400"><FolderSearch size={16} /></span>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wide">Codebase Index</h3>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handlePickDirectory}
                        disabled={indexing}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-50"
                    >
                        {indexing ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                        {indexing ? 'Indexing...' : status?.indexed ? 'Re-index' : 'Select Directory'}
                    </button>
                    {status?.indexed && (
                        <button
                            onClick={handleDelete}
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                            <Trash2 size={14} /> Delete
                        </button>
                    )}
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-4">
                    <Loader2 size={16} className="animate-spin text-foreground-muted" />
                </div>
            ) : status?.indexed ? (
                <div className="space-y-2">
                    <div className="flex items-center gap-4 text-[10px] text-foreground-muted">
                        <span className="flex items-center gap-1 text-green-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            Indexed
                        </span>
                        <span>{status.file_count} files</span>
                        <span>{status.chunk_count} chunks</span>
                        {status.has_embeddings && <span className="text-blue-400">vector search enabled</span>}
                        {status.indexed_at && (
                            <span>Last indexed: {new Date(status.indexed_at * 1000).toLocaleString()}</span>
                        )}
                    </div>
                    <div className="flex items-center px-3 py-2 rounded-lg bg-black/30 border border-outline-subtle">
                        <span className="text-xs text-foreground-muted font-mono truncate">{status.directory}</span>
                    </div>
                </div>
            ) : (
                <p className="text-sm text-foreground-muted">
                    Select a project directory to enable semantic code search in the NanoCore terminal. AST-aware chunking for Python, line-based for other languages.
                </p>
            )}

            {showManualPath && (
                <div className="mt-3 flex items-center gap-2">
                    <input
                        type="text"
                        value={manualPath}
                        onChange={e => setManualPath(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && manualPath.trim()) { handleIndex(manualPath.trim()); setShowManualPath(false); setManualPath(""); }
                            if (e.key === 'Escape') { setShowManualPath(false); setManualPath(""); }
                        }}
                        placeholder="/absolute/path/to/project"
                        className="flex-1 bg-black/40 border border-outline rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-foreground-subtle outline-none focus:border-blue-500/50 font-mono"
                        autoFocus
                    />
                    <button
                        type="button"
                        onClick={() => { if (manualPath.trim()) { handleIndex(manualPath.trim()); setShowManualPath(false); setManualPath(""); } }}
                        disabled={!manualPath.trim()}
                        className="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Index
                    </button>
                    <button
                        type="button"
                        onClick={() => { setShowManualPath(false); setManualPath(""); }}
                        className="px-2 py-1.5 text-foreground-muted hover:text-foreground-secondary text-xs transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            )}

            {indexResult && (
                <div className="mt-3 text-xs text-foreground-muted bg-black/20 rounded px-3 py-2">
                    {indexResult}
                </div>
            )}
        </Card>
    )
}
