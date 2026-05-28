import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiClient } from '../../api/client'
import type { RagCollection } from '../../api/client'
import { Card } from '../ui/Card'
import { useToast } from '../ui/Toast'
import { Upload, Search } from 'lucide-react'

interface IngestTabProps {
    collections: RagCollection[]
    selectedCollectionId: string
    setSelectedCollectionId: (id: string) => void
    onIngested: () => void
}

export function IngestTab({ collections, selectedCollectionId, setSelectedCollectionId, onIngested }: IngestTabProps) {
    const { t } = useTranslation()
    const { toast } = useToast()
    const [ingestPath, setIngestPath] = useState("")
    const [uploading, setUploading] = useState(false)
    const [chunkSize, setChunkSize] = useState(512)
    const [chunkOverlap, setChunkOverlap] = useState(50)
    const [embeddingModel, setEmbeddingModel] = useState('nomic-embed-text-v1.5')

    const handleIngest = async () => {
        if (collections.length === 0) {
            toast("Create a collection first!", "error")
            return
        }
        if (!ingestPath.trim()) {
            toast("Enter a file or directory path to ingest.", "error")
            return
        }
        setUploading(true)
        try {
            const targetId = selectedCollectionId || collections[0].id
            const files = ingestPath.split(',').map((f: string) => f.trim()).filter(Boolean)
            await apiClient.rag.ingest(targetId, files, chunkSize, chunkOverlap)
            onIngested()
            toast("Ingestion complete!", "success")
            setIngestPath('')
        } catch {
            toast("Ingestion failed", "error")
        } finally {
            setUploading(false)
        }
    }

    return (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <Card className="xl:col-span-2 flex flex-col items-center justify-center p-12 border-2 border-dashed border-outline hover:border-outline-strong transition-all bg-black/20 text-center min-h-[400px] group rounded-2xl">
                <div className="w-20 h-20 bg-elevated border border-outline-subtle rounded-2xl flex items-center justify-center mb-6 group-hover:scale-105 transition-transform">
                    <Upload className="w-10 h-10 text-blue-400" />
                </div>
                <h2 className="text-xl font-bold mb-3 text-foreground-secondary tracking-wide">Upload Files for Embedding</h2>
                <p className="text-[13px] text-foreground-muted max-w-md mx-auto mb-6 leading-relaxed font-medium">
                    Enter file paths (comma-separated) for PDF, TXT, MD, or DOCX files. SiliconDev uses MLX-accelerated embeddings for maximum local speed.
                </p>

                <select
                    title="Target Collection"
                    value={selectedCollectionId}
                    onChange={(e) => setSelectedCollectionId(e.target.value)}
                    className="w-full max-w-md bg-black/40 border border-outline rounded-lg px-4 py-2.5 text-sm text-white outline-none focus:border-blue-500 appearance-none mb-4"
                >
                    {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    {collections.length === 0 && <option value="">No collections</option>}
                </select>

                <input
                    type="text"
                    value={ingestPath}
                    onChange={(e) => setIngestPath(e.target.value)}
                    placeholder="/path/to/doc1.pdf, /path/to/doc2.txt"
                    className="w-full max-w-md bg-black/40 border border-outline rounded-lg px-4 py-2.5 text-sm text-white outline-none focus:border-blue-500 placeholder:text-foreground-subtle font-medium mb-6"
                />

                <div className="flex items-center gap-4">
                    <button
                        type="button"
                        onClick={handleIngest}
                        disabled={uploading || collections.length === 0}
                        className="px-8 py-3.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
                <Card className="p-6 bg-elevated border border-outline">
                    <h3 className="text-sm font-bold text-foreground-muted uppercase tracking-wide mb-6">Pipeline Settings</h3>
                    <div className="space-y-6">
                        <div className="space-y-3">
                            <div className="flex justify-between items-center">
                                <label className="text-[11px] font-bold text-foreground-muted uppercase">{t('rag.chunkSize')}</label>
                                <span className="text-xs font-mono text-foreground-muted">{chunkSize} chars</span>
                            </div>
                            <input type="range" title="Chunk size" min="128" max="2048" step="128" value={chunkSize} onChange={(e) => setChunkSize(parseInt(e.target.value))} className="w-full h-1.5 bg-black/60 rounded-lg appearance-none cursor-pointer accent-white/50 border border-outline-subtle" />
                        </div>
                        <div className="space-y-3">
                            <div className="flex justify-between items-center">
                                <label className="text-[11px] font-bold text-foreground-muted uppercase">{t('rag.overlap')}</label>
                                <span className="text-xs font-mono text-foreground-muted">{chunkOverlap} chars</span>
                            </div>
                            <input type="range" title="Chunk overlap" min="0" max="200" step="10" value={chunkOverlap} onChange={(e) => setChunkOverlap(parseInt(e.target.value))} className="w-full h-1.5 bg-black/60 rounded-lg appearance-none cursor-pointer accent-white/50 border border-outline-subtle" />
                        </div>
                        <div className="space-y-3 pt-4 border-t border-outline-subtle">
                            <label className="text-[11px] font-bold text-foreground-muted uppercase">Embedding Model</label>
                            <select title="Embedding model" value={embeddingModel} onChange={(e) => setEmbeddingModel(e.target.value)} className="w-full bg-black/40 border border-outline rounded-xl px-4 py-3 text-[13px] text-foreground-secondary outline-none focus:border-blue-500 appearance-none">
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
    )
}
