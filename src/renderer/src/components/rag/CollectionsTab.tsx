import { useState, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { apiClient } from '../../api/client'
import type { RagCollection } from '../../api/client'
import { useToast } from '../ui/Toast'
import { Brain, Database, FileText, Trash2, Search } from 'lucide-react'

interface CollectionsTabProps {
    collections: RagCollection[]
    embeddingModel: string
    onDelete: (id: string) => void
}

export function CollectionsTab({ collections, embeddingModel, onDelete }: CollectionsTabProps) {
    const { t } = useTranslation()
    const { toast } = useToast()
    const [testingCollectionId, setTestingCollectionId] = useState<string | null>(null)
    const [testQuery, setTestQuery] = useState("")
    const [testResults, setTestResults] = useState<{ text: string; score: number; boosted?: boolean }[] | null>(null)
    const [testLoading, setTestLoading] = useState(false)

    const handleRunQuery = (collectionId: string) => {
        if (!testQuery.trim()) return
        setTestLoading(true)
        setTestResults(null)
        apiClient.rag.query(collectionId, testQuery.trim(), 3)
            .then(data => {
                const results = data.results || []
                setTestResults(results)
                if (results.length > 0) {
                    apiClient.rag.recordUsage(collectionId, results.map((r: { index: number }) => r.index)).catch(() => {})
                }
            })
            .catch(() => toast('Retrieval failed', 'error'))
            .finally(() => setTestLoading(false))
    }

    return (
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
                    <span className="text-sm font-bold font-mono text-gray-200">{collections.reduce((sum, c) => sum + (c.chunks || 0), 0).toLocaleString()}</span>
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
                        {collections.map(c => {
                            const isTesting = testingCollectionId === c.id
                            return (<Fragment key={c.id}>
                            <tr className="hover:bg-white/[0.03] transition-colors group">
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
                                                if (isTesting) {
                                                    setTestingCollectionId(null)
                                                    setTestQuery("")
                                                    setTestResults(null)
                                                } else {
                                                    setTestingCollectionId(c.id)
                                                    setTestQuery("")
                                                    setTestResults(null)
                                                }
                                            }}
                                            className={`p-1.5 rounded-lg transition-colors ${isTesting ? 'bg-blue-500/20 text-blue-400' : 'bg-white/5 hover:bg-white/10 text-gray-300'}`}
                                            title="Test Retrieval"
                                        >
                                            <Search className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => onDelete(c.id)}
                                            className="p-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500 rounded-lg transition-colors"
                                            title="Delete Collection"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                            {isTesting && (
                                <tr key={`${c.id}-test`}>
                                    <td colSpan={5} className="px-5 py-3 bg-white/[0.02] border-t border-white/5">
                                        <div className="flex items-center gap-2 mb-2">
                                            <input
                                                type="text"
                                                value={testQuery}
                                                onChange={e => setTestQuery(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') handleRunQuery(c.id); if (e.key === 'Escape') { setTestingCollectionId(null); setTestQuery(""); setTestResults(null) } }}
                                                placeholder={t('rag.queryPlaceholder')}
                                                className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 outline-none focus:border-blue-500/50"
                                                autoFocus
                                            />
                                            <button
                                                type="button"
                                                onClick={() => handleRunQuery(c.id)}
                                                disabled={!testQuery.trim() || testLoading}
                                                className="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {testLoading ? 'Searching...' : 'Search'}
                                            </button>
                                        </div>
                                        {testResults !== null && (
                                            <div className="space-y-1.5">
                                                {testResults.length === 0 ? (
                                                    <p className="text-xs text-gray-500 py-1">{t('rag.noResults')}</p>
                                                ) : testResults.map((r, i) => (
                                                    <div key={i} className="flex gap-2 p-2 rounded-lg bg-black/20 border border-white/5">
                                                        <span className="text-[10px] text-gray-600 font-mono shrink-0 mt-0.5">
                                                            {r.score.toFixed(3)}{r.boosted ? ' +boost' : ''}
                                                        </span>
                                                        <p className="text-xs text-gray-300 leading-relaxed">{r.text.slice(0, 200)}{r.text.length > 200 ? '...' : ''}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            )}
                            </Fragment>)
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
