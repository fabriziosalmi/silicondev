import { useState, useEffect } from 'react'
import { apiClient } from '../../api/client'
import type { RagCollection, RagAnalytics } from '../../api/client'
import { Card } from '../ui/Card'
import { Search, Database, BarChart3, TrendingUp, Clock, Zap } from 'lucide-react'

interface AnalyticsTabProps {
    collections: RagCollection[]
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
    return (
        <Card className="p-4">
            <div className="flex items-center gap-2 mb-2">
                {icon}
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{label}</span>
            </div>
            <span className="text-2xl font-bold text-white font-mono tabular-nums">{value}</span>
        </Card>
    )
}

function formatTimestamp(ts: number) {
    if (!ts) return '—'
    const d = new Date(ts * 1000)
    const now = new Date()
    const diff = (now.getTime() - d.getTime()) / 1000
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function AnalyticsTab({ collections }: AnalyticsTabProps) {
    const [analyticsCollectionId, setAnalyticsCollectionId] = useState("")
    const [analytics, setAnalytics] = useState<RagAnalytics | null>(null)
    const [loadingAnalytics, setLoadingAnalytics] = useState(false)

    useEffect(() => {
        if (collections.length > 0 && !analyticsCollectionId) {
            setAnalyticsCollectionId(collections[0].id)
        }
    }, [collections])

    useEffect(() => {
        if (analyticsCollectionId) fetchAnalytics(analyticsCollectionId)
    }, [analyticsCollectionId])

    const fetchAnalytics = async (collectionId: string) => {
        setLoadingAnalytics(true)
        try {
            const data = await apiClient.rag.getAnalytics(collectionId)
            setAnalytics(data)
        } catch {
            setAnalytics(null)
        } finally {
            setLoadingAnalytics(false)
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <select
                    title="Collection"
                    value={analyticsCollectionId}
                    onChange={(e) => setAnalyticsCollectionId(e.target.value)}
                    className="bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-sm text-white outline-none focus:border-purple-500 appearance-none"
                >
                    {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button
                    onClick={() => analyticsCollectionId && fetchAnalytics(analyticsCollectionId)}
                    className="px-3 py-2 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-lg text-xs transition-colors"
                >
                    Refresh
                </button>
            </div>

            {loadingAnalytics ? (
                <Card className="p-8 flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-white/20 border-t-purple-400 rounded-full animate-spin" />
                </Card>
            ) : !analytics ? (
                <Card className="p-8 text-center">
                    <BarChart3 className="w-8 h-8 text-gray-600 mx-auto mb-3" />
                    <p className="text-sm text-gray-500">Select a collection to view analytics.</p>
                </Card>
            ) : (
                <>
                    <div className="grid grid-cols-4 gap-4">
                        <StatCard icon={<Search className="w-4 h-4 text-purple-400" />} label="Total Queries" value={analytics.total_queries} />
                        <StatCard icon={<Zap className="w-4 h-4 text-yellow-400" />} label="Chunk Hits" value={analytics.total_chunk_hits} />
                        <StatCard icon={<Database className="w-4 h-4 text-blue-400" />} label="Unique Chunks Used" value={analytics.unique_chunks_used} />
                        <StatCard
                            icon={<TrendingUp className="w-4 h-4 text-green-400" />}
                            label="Hit Rate"
                            value={
                                collections.find(c => c.id === analyticsCollectionId)?.chunks
                                    ? `${Math.round((analytics.unique_chunks_used / (collections.find(c => c.id === analyticsCollectionId)?.chunks || 1)) * 100)}%`
                                    : '—'
                            }
                        />
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        <Card className="p-5">
                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-4 flex items-center gap-2">
                                <Clock className="w-3.5 h-3.5" />
                                Recent Queries
                            </h3>
                            {analytics.recent_queries.length === 0 ? (
                                <p className="text-xs text-gray-600">No queries yet.</p>
                            ) : (
                                <div className="space-y-1.5 max-h-80 overflow-y-auto">
                                    {[...analytics.recent_queries].reverse().map((q, i) => (
                                        <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.03] transition-colors">
                                            <span className="text-[10px] text-gray-600 font-mono tabular-nums shrink-0">{formatTimestamp(q.timestamp)}</span>
                                            <span className="text-xs text-gray-300 truncate flex-1">{q.query}</span>
                                            <span className="text-[10px] text-gray-600 font-mono shrink-0">{q.n_results} hit{q.n_results !== 1 ? 's' : ''}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </Card>

                        <Card className="p-5">
                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-4 flex items-center gap-2">
                                <TrendingUp className="w-3.5 h-3.5" />
                                Most Retrieved Chunks
                            </h3>
                            {analytics.top_chunks.length === 0 ? (
                                <p className="text-xs text-gray-600">No usage data yet. Query results are tracked automatically.</p>
                            ) : (
                                <div className="space-y-2">
                                    {analytics.top_chunks.map((chunk) => {
                                        const maxHits = analytics.top_chunks[0]?.hits || 1
                                        const pct = Math.round((chunk.hits / maxHits) * 100)
                                        return (
                                            <div key={chunk.index} className="space-y-1">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs text-gray-400 font-mono">Chunk #{chunk.index}</span>
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-[10px] text-gray-600">{formatTimestamp(chunk.last_used)}</span>
                                                        <span className="text-xs font-bold text-gray-300 font-mono tabular-nums w-8 text-right">{chunk.hits}</span>
                                                    </div>
                                                </div>
                                                <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
                                                    <div className="h-full bg-purple-500/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </Card>
                    </div>

                    <div className="bg-purple-500/10 border border-purple-500/20 p-4 rounded-2xl flex gap-3">
                        <Zap className="w-5 h-5 text-purple-400 shrink-0" />
                        <p className="text-[11px] text-purple-200/70 leading-relaxed">
                            Search results adapt over time. Frequently retrieved chunks get a score boost that decays gradually, so recent and popular content surfaces faster. This happens automatically — no configuration needed.
                        </p>
                    </div>
                </>
            )}
        </div>
    )
}
