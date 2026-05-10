import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from './ui/PageHeader'
import { Database, FileText, Plus, BarChart3 } from 'lucide-react'
import { apiClient } from '../api/client'
import type { RagCollection } from '../api/client'
import { useToast } from './ui/Toast'
import { useConfirm } from './ui/ConfirmDialog'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { CollectionsTab } from './rag/CollectionsTab'
import { IngestTab } from './rag/IngestTab'
import { AnalyticsTab } from './rag/AnalyticsTab'

export function RagKnowledge() {
    const { t } = useTranslation()
    const { toast } = useToast()
    const { confirm } = useConfirm()
    const [activeTab, setActiveTab] = useState<'collections' | 'ingest' | 'analytics'>('collections')
    const [collections, setCollections] = useState<RagCollection[]>([])
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [newCollectionName, setNewCollectionName] = useState("")
    const [selectedCollectionId, setSelectedCollectionId] = useState("")
    const modalTrapRef = useFocusTrap(showCreateModal)

    const fetchCollections = useCallback(async () => {
        try {
            const data = await apiClient.rag.getCollections()
            setCollections(data)
        } catch { /* ignore */ }
    }, [])

    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount triggers state update via callback
    useEffect(() => { fetchCollections() }, [fetchCollections])

    useEffect(() => {
        if (collections.length > 0 && !selectedCollectionId) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-select first collection when none is selected
            setSelectedCollectionId(collections[0].id)
        }
    }, [collections, selectedCollectionId])

    const handleCreateCollection = async () => {
        if (!newCollectionName) return
        try {
            await apiClient.rag.createCollection(newCollectionName)
            setNewCollectionName("")
            setShowCreateModal(false)
            fetchCollections()
        } catch {
            toast("Failed to create collection", "error")
        }
    }

    const handleDeleteCollection = async (id: string) => {
        const ok = await confirm({ message: t('rag.deleteConfirm'), destructive: true, confirmLabel: t('rag.delete') || 'Delete' })
        if (!ok) return
        try {
            await apiClient.rag.deleteCollection(id)
            fetchCollections()
        } catch {
            toast("Failed to delete", "error")
        }
    }

    return (
        <div className="h-full flex flex-col text-white overflow-hidden pb-4">
            <PageHeader>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm font-medium transition-colors border border-white/5"
                >
                    <Plus className="w-4 h-4" />
                    {t('rag.newCollection')}
                </button>
            </PageHeader>

            {/* Tabs */}
            <div className="flex gap-6 mb-6 border-b border-white/10 px-1">
                <button
                    type="button"
                    onClick={() => setActiveTab('collections')}
                    className={`pb-3 text-sm font-medium transition-colors relative flex items-center gap-2 ${activeTab === 'collections' ? 'text-blue-400' : 'text-gray-400 hover:text-white'}`}
                >
                    <Database className="w-4 h-4" /> {t('rag.collections')}
                    {activeTab === 'collections' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-400"></div>}
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('ingest')}
                    className={`pb-3 text-sm font-medium transition-colors relative flex items-center gap-2 ${activeTab === 'ingest' ? 'text-blue-400' : 'text-gray-400 hover:text-white'}`}
                >
                    <FileText className="w-4 h-4" /> {t('rag.ingest')}
                    {activeTab === 'ingest' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-400"></div>}
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('analytics')}
                    className={`pb-3 text-sm font-medium transition-colors relative flex items-center gap-2 ${activeTab === 'analytics' ? 'text-purple-400' : 'text-gray-400 hover:text-white'}`}
                >
                    <BarChart3 className="w-4 h-4" /> Analytics
                    {activeTab === 'analytics' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-purple-400"></div>}
                </button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
                {activeTab === 'collections' && (
                    <CollectionsTab
                        collections={collections}
                        embeddingModel="nomic-embed-text-v1.5"
                        onDelete={handleDeleteCollection}
                    />
                )}
                {activeTab === 'ingest' && (
                    <IngestTab
                        collections={collections}
                        selectedCollectionId={selectedCollectionId}
                        setSelectedCollectionId={setSelectedCollectionId}
                        onIngested={fetchCollections}
                    />
                )}
                {activeTab === 'analytics' && (
                    <AnalyticsTab collections={collections} />
                )}
            </div>

            {/* Create Collection Modal */}
            {showCreateModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
                    tabIndex={-1}
                    onClick={() => setShowCreateModal(false)}
                    onKeyDown={(e) => { if (e.key === 'Escape') setShowCreateModal(false) }}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="rag-create-modal-title"
                        ref={modalTrapRef}
                        className="bg-[#18181B] border border-white/10 rounded-2xl max-w-md w-full p-6"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 id="rag-create-modal-title" className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                            <Plus className="w-5 h-5 text-blue-400" />
                            {t('rag.newCollection')}
                        </h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">{t('rag.collectionName')}</label>
                                <input
                                    type="text"
                                    autoFocus
                                    value={newCollectionName}
                                    onChange={(e) => setNewCollectionName(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' && newCollectionName) handleCreateCollection() }}
                                    placeholder="e.g. Legal Documents 2024"
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-blue-500 transition-colors"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 mt-8 pt-4 border-t border-white/5">
                            <button type="button" onClick={() => setShowCreateModal(false)} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-white/5 transition-colors">{t('common.cancel')}</button>
                            <button type="button" onClick={handleCreateCollection} disabled={!newCollectionName} className="px-6 py-2 rounded-lg text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed">{t('rag.create')}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
