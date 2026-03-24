import { useState, useEffect } from 'react'
import { Card } from '../ui/Card'
import { ToggleSwitch } from '../ui/ToggleSwitch'
import { apiClient } from '../../api/client'
import type { IndexerSource, IndexerStatus } from '../../api/client'
import { Globe, Plus, Trash2, Loader2, RefreshCcw, Play, Square } from 'lucide-react'

export function WebIndexerSection() {
    const [sources, setSources] = useState<IndexerSource[]>([])
    const [status, setStatus] = useState<IndexerStatus | null>(null)
    const [loading, setLoading] = useState(true)
    const [crawling, setCrawling] = useState(false)
    const [crawlResult, setCrawlResult] = useState<string | null>(null)
    const [newUrl, setNewUrl] = useState('')
    const [newLabel, setNewLabel] = useState('')
    const [showAdd, setShowAdd] = useState(false)

    const fetchData = async () => {
        try {
            const [srcRes, statusRes] = await Promise.all([
                apiClient.indexer.getSources(),
                apiClient.indexer.getStatus(),
            ])
            setSources(srcRes.sources)
            setStatus(statusRes)
        } catch { /* ignore */ }
        finally { setLoading(false) }
    }

    useEffect(() => { fetchData() }, [])

    const handleAdd = async () => {
        if (!newUrl.trim()) return
        try {
            await apiClient.indexer.addSource(newUrl.trim(), newLabel.trim() || undefined)
            setNewUrl('')
            setNewLabel('')
            setShowAdd(false)
            fetchData()
        } catch { /* ignore */ }
    }

    const handleRemove = async (id: string) => {
        try {
            await apiClient.indexer.removeSource(id)
            setSources(prev => prev.filter(s => s.id !== id))
        } catch { /* ignore */ }
    }

    const handleToggle = async (id: string, enabled: boolean) => {
        try {
            await apiClient.indexer.toggleSource(id, enabled)
            setSources(prev => prev.map(s => s.id === id ? { ...s, enabled } : s))
        } catch { /* ignore */ }
    }

    const handleCrawl = async () => {
        setCrawling(true)
        setCrawlResult(null)
        try {
            const res = await apiClient.indexer.crawl()
            setCrawlResult(`Indexed ${res.indexed} chunks from ${res.fetched ?? 0} pages`)
            fetchData()
        } catch (err) {
            setCrawlResult(err instanceof Error ? err.message : 'Crawl failed')
        } finally { setCrawling(false) }
    }

    const handleToggleBackground = async () => {
        if (!status) return
        try {
            if (status.running) {
                await apiClient.indexer.stop()
            } else {
                await apiClient.indexer.start(60)
            }
            fetchData()
        } catch { /* ignore */ }
    }

    return (
        <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <span className="text-blue-400"><Globe size={16} /></span>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wide">Web Indexer</h3>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleCrawl}
                        disabled={crawling || sources.filter(s => s.enabled).length === 0}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs text-green-400 hover:bg-green-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {crawling ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
                        {crawling ? 'Crawling...' : 'Crawl Now'}
                    </button>
                    {status && (
                        <button
                            onClick={handleToggleBackground}
                            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${status.running ? 'text-red-400 hover:bg-red-500/10' : 'text-blue-400 hover:bg-blue-500/10'}`}
                        >
                            {status.running ? <><Square size={14} /> Stop</> : <><Play size={14} /> Auto</>}
                        </button>
                    )}
                    <button
                        onClick={() => setShowAdd(!showAdd)}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs text-blue-400 hover:bg-blue-500/10 transition-colors"
                    >
                        <Plus size={14} /> Add URL
                    </button>
                </div>
            </div>

            {status && (
                <div className="flex items-center gap-4 mb-3 text-[10px] text-gray-500">
                    <span className={`flex items-center gap-1 ${status.running ? 'text-green-500' : 'text-gray-600'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${status.running ? 'bg-green-500' : 'bg-gray-600'}`} />
                        {status.running ? 'Running (hourly)' : 'Stopped'}
                    </span>
                    {status.last_run && (
                        <span>Last crawl: {new Date(status.last_run * 1000).toLocaleString()}</span>
                    )}
                    <span>{status.enabled_sources}/{status.total_sources} sources enabled</span>
                </div>
            )}

            {showAdd && (
                <div className="mb-4 p-3 rounded-lg bg-black/30 border border-white/5 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-gray-500 uppercase">URL</label>
                            <input
                                value={newUrl}
                                onChange={(e) => setNewUrl(e.target.value)}
                                placeholder="https://docs.example.com"
                                className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-blue-500"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-gray-500 uppercase">Label (optional)</label>
                            <input
                                value={newLabel}
                                onChange={(e) => setNewLabel(e.target.value)}
                                placeholder="Python docs"
                                className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-blue-500"
                            />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors">Cancel</button>
                        <button
                            onClick={handleAdd}
                            disabled={!newUrl.trim()}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Add
                        </button>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="flex justify-center py-4">
                    <Loader2 size={16} className="animate-spin text-gray-500" />
                </div>
            ) : sources.length === 0 ? (
                <p className="text-sm text-gray-500">No URLs configured. Add URLs to automatically crawl, chunk, and index web content into your RAG knowledge base.</p>
            ) : (
                <div className="space-y-2">
                    {sources.map(s => (
                        <div key={s.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg bg-black/20 border border-white/5 ${!s.enabled ? 'opacity-50' : ''}`}>
                            <ToggleSwitch
                                enabled={s.enabled}
                                onChange={(v) => handleToggle(s.id, v)}
                                size="sm"
                                label={`Toggle ${s.label}`}
                            />
                            <Globe size={14} className="text-gray-500 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <div className="text-sm text-white font-medium truncate">{s.label}</div>
                                <div className="text-[10px] text-gray-600 truncate">{s.url}</div>
                            </div>
                            <button onClick={() => handleRemove(s.id)} title="Remove source" className="text-gray-600 hover:text-red-400 transition-colors">
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {crawlResult && (
                <div className="mt-3 text-xs text-gray-400 bg-black/20 rounded px-3 py-2">
                    {crawlResult}
                </div>
            )}
        </Card>
    )
}
