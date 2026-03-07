import { useState, useEffect } from 'react'
import { PageHeader } from './ui/PageHeader'
import { Card } from './ui/Card'
import { Brain, Database, Upload, FileText, Trash2, Search, Plus, BarChart3, TrendingUp, Clock, Zap } from 'lucide-react'
import { apiClient } from '../api/client'
import type { RagCollection, RagAnalytics } from '../api/client'
import { useToast } from './ui/Toast'

export function RagKnowledge() {
    const { toast } = useToast()
    const [activeTab, setActiveTab] = useState<'collections' | 'ingest' | 'analytics'>('collections')
    const [collections, setCollections] = useState<RagCollection[]>([])
    const [uploading, setUploading] = useState(false)
    const [chunkSize, setChunkSize] = useState(512)
    const [chunkOverlap, setChunkOverlap] = useState(50)
    const [embeddingModel, setEmbeddingModel] = useState('nomic-embed-text-v1.5')
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [newCollectionName, setNewCollectionName] = useState("")
    const [ingestPath, setIngestPath] = useState("")
    const [selectedCollectionId, setSelectedCollectionId] = useState("")

    // Analytics state
    const [analytics, setAnalytics] = useState<RagAnalytics | null>(null)
    const [analyticsCollectionId, setAnalyticsCollectionId] = useState("")
    const [loadingAnalytics, setLoadingAnalytics] = useState(false)

    useEffect(() => {
        fetchCollections()
    }, [])

    // Auto-select first collection when list changes
    useEffect(() => {
        if (collections.length > 0 && !selectedCollectionId) {
            setSelectedCollectionId(collections[0].id)
        }
        if (collections.length > 0 && !analyticsCollectionId) {
            setAnalyticsCollectionId(collections[0].id)
        }
    }, [collections])

    // Fetch analytics when tab or collection changes
    useEffect(() => {
        if (activeTab === 'analytics' && analyticsCollectionId) {
            fetchAnalytics(analyticsCollectionId)
        }
    }, [activeTab, analyticsCollectionId])

    const fetchCollections = async () => {
        try {
            const data = await apiClient.rag.getCollections()
            setCollections(data)
        } catch {
            // fetch failed silently
        }
    }

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

    const handleCreateCollection = async () => {
        if (!newCollectionName) return
        try {
            await apiClient.rag.createCollection(newCollectionName)
            setNewCollectionName("")
            setShowCreateModal(false)
            fetchCollections()
        } catch (e) {
            toast("Failed to create collection", "error")
        }
    }

    const handleDeleteCollection = async (id: string) => {
        if (!window.confirm("Delete this collection?")) return
        try {
            await apiClient.rag.deleteCollection(id)
            fetchCollections()
        } catch (e) {
            toast("Failed to delete", "error")
        }
    }

    const handleIngest = async () => {
        if (collections.length === 0) {
            toast("Create a collection first!", "error")
            return
        }
        if (!ingestPath.trim()) {
            toast("Enter a file or directory path to ingest.", "error")
            return
        }
        setUploading(true);
        try {
            const targetId = selectedCollectionId || collections[0].id;
            const files = ingestPath.split(',').map((f: string) => f.trim()).filter(Boolean);
            await apiClient.rag.ingest(targetId, files, chunkSize, chunkOverlap)
            fetchCollections()
            toast("Ingestion complete!", "success")
            setIngestPath('')
        } catch (e) {
            toast("Ingestion failed", "error")
        } finally {
            setUploading(false)
        }
    }

    const formatTimestamp = (ts: number) => {
        if (!ts) return '—'
        const d = new Date(ts * 1000)
        const now = new Date()
        const diff = (now.getTime() - d.getTime()) / 1000
        if (diff < 60) return 'just now'
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }

    return (
        <div className="h-full flex flex-col text-white overflow-hidden pb-4">
            <PageHeader>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm font-medium transition-colors border border-white/5"
                >
                    <Plus className="w-4 h-4" />
                    New Collection
                </button>
            </PageHeader>

            {/* Tabs */}
            <div className="flex gap-6 mb-6 border-b border-white/10 px-1">
                <button
                    onClick={() => setActiveTab('collections')}
                    className={`pb-3 text-sm font-medium transition-colors relative flex items-center gap-2 ${activeTab === 'collections' ? 'text-blue-400' : 'text-gray-400 hover:text-white'}`}
                >
                    <Database className="w-4 h-4" /> Vector Collections
                    {activeTab === 'collections' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-400"></div>}
                </button>
                <button
                    onClick={() => setActiveTab('ingest')}
                    className={`pb-3 text-sm font-medium transition-colors relative flex items-center gap-2 ${activeTab === 'ingest' ? 'text-blue-400' : 'text-gray-400 hover:text-white'}`}
                >
                    <FileText className="w-4 h-4" /> Data Ingestion
                    {activeTab === 'ingest' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-400"></div>}
                </button>
                <button
                    onClick={() => setActiveTab('analytics')}
                    className={`pb-3 text-sm font-medium transition-colors relative flex items-center gap-2 ${activeTab === 'analytics' ? 'text-purple-400' : 'text-gray-400 hover:text-white'}`}
                >
                    <BarChart3 className="w-4 h-4" /> Analytics
                    {activeTab === 'analytics' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-purple-400"></div>}
                </button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">

                {activeTab === 'collections' && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-6 px-4 py-2.5 bg-black/20 rounded-lg border border-white/5 mb-6">
                            <div className="flex items-center gap-2">
                                <Database className="w-3.5 h-3.5 text-blue-400" />
                                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Collections</span>
                                <span className="text-sm font-bold font-mono text-gray-200">{collections.length}</span>
                            </div>
                            <div className="w-px h-4 bg-white/10" />
                            <div className="flex items-center gap-2">
                                <Brain className="w-3.5 h-3.5 text-blue-400" />
                                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Chunks</span>
                                <span className="text-sm font-bold font-mono text-gray-200">{collections.reduce((sum: number, c: RagCollection) => sum + (c.chunks || 0), 0).toLocaleString()}</span>
                            </div>
                            <div className="w-px h-4 bg-white/10" />
                            <div className="flex items-center gap-2">
                                <Database className="w-3.5 h-3.5 text-green-400" />
                                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Embedder</span>
                                <span className="text-sm font-mono text-gray-300">{embeddingModel}</span>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto rounded-xl border border-white/10 bg-black/20">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-[#18181B] text-gray-500 border-b border-white/10">
                                    <tr>
                                        <th className="px-5 py-3 text-[10px] font-bold tracking-wide uppercase">Collection Name</th>
                                        <th className="px-5 py-3 text-[10px] font-bold tracking-wide uppercase">Chunks</th>
                                        <th className="px-5 py-3 text-[10px] font-bold tracking-wide uppercase">Estimated Size</th>
                                        <th className="px-5 py-3 text-[10px] font-bold tracking-wide uppercase">Last Updated</th>
                                        <th className="px-5 py-3 text-[10px] font-bold tracking-wide uppercase text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {collections.map(c => (
                                        <tr key={c.id} className="hover:bg-white/[0.03] transition-colors group">
                                            <td className="px-5 py-3.5">
                                                <div className="text-[13px] font-semibold text-gray-200 flex items-center gap-3">
                                                    <FileText className="w-4 h-4 text-blue-400" />
                                                    {c.name}
                                                </div>
                                            </td>
                                            <td className="px-5 py-3.5 text-gray-400 text-[13px] font-mono">{c.chunks}</td>
                                            <td className="px-5 py-3.5 text-gray-400 text-[13px] font-mono">{c.size}</td>
                                            <td className="px-5 py-3.5 text-gray-500 text-[13px]">{c.lastUpdated}</td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const query = prompt('Enter a test query to search this collection:')
                                                            if (query?.trim()) {
                                                                apiClient.rag.query(c.id, query.trim(), 3)
                                                                    .then(data => {
                                                                        const results = data.results || []
                                                                        const msg = results.length > 0
                                                                            ? `Found ${results.length} result(s):\n\n${results.map((r: { text: string; score: number; boosted?: boolean }, i: number) => `${i + 1}. (score: ${r.score.toFixed(3)}${r.boosted ? ' +boosted' : ''}) ${r.text.slice(0, 120)}...`).join('\n')}`
                                                                            : 'No results found for this query.'
                                                                        alert(msg)
                                                                        // Record usage for returned chunks
                                                                        if (results.length > 0) {
                                                                            apiClient.rag.recordUsage(c.id, results.map((r: { index: number }) => r.index)).catch(() => {})
                                                                        }
                                                                    })
                                                                    .catch(() => toast('Retrieval failed', 'error'))
                                                            }
                                                        }}
                                                        className="p-1.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg transition-colors"
                                                        title="Test Retrieval"
                                                    >
                                                        <Search className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteCollection(c.id)}
                                                        className="p-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500 rounded-lg transition-colors"
                                                        title="Delete Collection"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {activeTab === 'ingest' && (
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                        <Card className="xl:col-span-2 flex flex-col items-center justify-center p-12 border-2 border-dashed border-white/10 hover:border-white/20 transition-all bg-black/20 text-center min-h-[400px] group rounded-2xl">
                            <div className="w-20 h-20 bg-[#18181B] border border-white/5 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-105 transition-transform">
                                <Upload className="w-10 h-10 text-blue-400" />
                            </div>
                            <h2 className="text-xl font-bold mb-3 text-gray-200 tracking-wide">Upload Files for Embedding</h2>
                            <p className="text-[13px] text-gray-500 max-w-md mx-auto mb-6 leading-relaxed font-medium">
                                Enter file paths (comma-separated) for PDF, TXT, MD, or DOCX files. SiliconDev uses MLX-accelerated embeddings for maximum local speed.
                            </p>

                            <select
                                title="Target Collection"
                                value={selectedCollectionId}
                                onChange={(e) => setSelectedCollectionId(e.target.value)}
                                className="w-full max-w-md bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white outline-none focus:border-blue-500 appearance-none mb-4"
                            >
                                {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                {collections.length === 0 && <option value="">No collections</option>}
                            </select>

                            <input
                                type="text"
                                value={ingestPath}
                                onChange={(e) => setIngestPath(e.target.value)}
                                placeholder="/path/to/doc1.pdf, /path/to/doc2.txt"
                                className="w-full max-w-md bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white outline-none focus:border-blue-500 placeholder-gray-500 font-medium mb-6"
                            />

                            <div className="flex items-center gap-4">
                                <button
                                    onClick={handleIngest}
                                    disabled={uploading || collections.length === 0}
                                    className="px-8 py-3.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
                                >
                                    {uploading ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            Embedding...
                                        </>
                                    ) : (
                                        "Select Files"
                                    )}
                                </button>
                            </div>
                        </Card>

                        <div className="space-y-6">
                            <Card className="p-6 bg-[#18181B] border border-white/10">
                                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-6">Pipeline Settings</h3>

                                <div className="space-y-6">
                                    <div className="space-y-3">
                                        <div className="flex justify-between items-center">
                                            <label className="text-[11px] font-bold text-gray-500 uppercase">Chunk Size</label>
                                            <span className="text-xs font-mono text-gray-400">{chunkSize} chars</span>
                                        </div>
                                        <input
                                            type="range"
                                            title="Chunk size"
                                            min="128"
                                            max="2048"
                                            step="128"
                                            value={chunkSize}
                                            onChange={(e) => setChunkSize(parseInt(e.target.value))}
                                            className="w-full h-1.5 bg-black/60 rounded-lg appearance-none cursor-pointer accent-white/50 border border-white/5"
                                        />
                                    </div>

                                    <div className="space-y-3">
                                        <div className="flex justify-between items-center">
                                            <label className="text-[11px] font-bold text-gray-500 uppercase">Overlap</label>
                                            <span className="text-xs font-mono text-gray-400">{chunkOverlap} chars</span>
                                        </div>
                                        <input
                                            type="range"
                                            title="Chunk overlap"
                                            min="0"
                                            max="200"
                                            step="10"
                                            value={chunkOverlap}
                                            onChange={(e) => setChunkOverlap(parseInt(e.target.value))}
                                            className="w-full h-1.5 bg-black/60 rounded-lg appearance-none cursor-pointer accent-white/50 border border-white/5"
                                        />
                                    </div>

                                    <div className="space-y-3 pt-4 border-t border-white/5">
                                        <label className="text-[11px] font-bold text-gray-500 uppercase">Embedding Model</label>
                                        <select
                                            title="Embedding model"
                                            value={embeddingModel}
                                            onChange={(e) => setEmbeddingModel(e.target.value)}
                                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-[13px] text-gray-300 outline-none focus:border-blue-500 appearance-none"
                                        >
                                            <option value="nomic-embed-text-v1.5">Nomic Embed Text v1.5 (Recommended)</option>
                                            <option value="bge-m3">BGE-M3 (Multilingual)</option>
                                            <option value="all-MiniLM-L6-v2">MiniLM-L6 (Fast)</option>
                                        </select>
                                    </div>
                                </div>
                            </Card>

                            <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-2xl flex gap-3">
                                <Search className="w-5 h-5 text-blue-400 shrink-0" />
                                <p className="text-[11px] text-blue-200/70 leading-relaxed italic">
                                    Higher chunk sizes improve context but increase retrieval latency. 512 is a good default for long documents.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'analytics' && (
                    <div className="space-y-6">
                        {/* Collection selector */}
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
                                {/* Stats cards */}
                                <div className="grid grid-cols-4 gap-4">
                                    <StatCard
                                        icon={<Search className="w-4 h-4 text-purple-400" />}
                                        label="Total Queries"
                                        value={analytics.total_queries}
                                    />
                                    <StatCard
                                        icon={<Zap className="w-4 h-4 text-yellow-400" />}
                                        label="Chunk Hits"
                                        value={analytics.total_chunk_hits}
                                    />
                                    <StatCard
                                        icon={<Database className="w-4 h-4 text-blue-400" />}
                                        label="Unique Chunks Used"
                                        value={analytics.unique_chunks_used}
                                    />
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
                                    {/* Recent queries */}
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
                                                        <span className="text-[10px] text-gray-600 font-mono tabular-nums shrink-0">
                                                            {formatTimestamp(q.timestamp)}
                                                        </span>
                                                        <span className="text-xs text-gray-300 truncate flex-1">{q.query}</span>
                                                        <span className="text-[10px] text-gray-600 font-mono shrink-0">
                                                            {q.n_results} hit{q.n_results !== 1 ? 's' : ''}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </Card>

                                    {/* Top chunks */}
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
                                                                <span className="text-xs text-gray-400 font-mono">
                                                                    Chunk #{chunk.index}
                                                                </span>
                                                                <div className="flex items-center gap-3">
                                                                    <span className="text-[10px] text-gray-600">
                                                                        {formatTimestamp(chunk.last_used)}
                                                                    </span>
                                                                    <span className="text-xs font-bold text-gray-300 font-mono tabular-nums w-8 text-right">
                                                                        {chunk.hits}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
                                                                <div
                                                                    className="h-full bg-purple-500/60 rounded-full transition-all"
                                                                    style={{ width: `${pct}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )}
                                    </Card>
                                </div>

                                {/* Adaptive search info */}
                                <div className="bg-purple-500/10 border border-purple-500/20 p-4 rounded-2xl flex gap-3">
                                    <Zap className="w-5 h-5 text-purple-400 shrink-0" />
                                    <p className="text-[11px] text-purple-200/70 leading-relaxed">
                                        Search results adapt over time. Frequently retrieved chunks get a score boost that decays gradually, so recent and popular content surfaces faster. This happens automatically — no configuration needed.
                                    </p>
                                </div>
                            </>
                        )}
                    </div>
                )}

            </div>

            {/* Create Collection Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-[#18181B] border border-white/10 rounded-2xl max-w-md w-full p-6">
                        <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                            <Plus className="w-5 h-5 text-blue-400" />
                            New Vector Collection
                        </h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">Collection Name</label>
                                <input
                                    type="text"
                                    autoFocus
                                    value={newCollectionName}
                                    onChange={(e) => setNewCollectionName(e.target.value)}
                                    placeholder="e.g. Legal Documents 2024"
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-blue-500 transition-colors"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 mt-8 pt-4 border-t border-white/5">
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-white/5 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreateCollection}
                                disabled={!newCollectionName}
                                className="px-6 py-2 rounded-lg text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white transition-all disabled:opacity-50"
                            >
                                Create
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
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
