import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { apiClient } from '../../api/client'
import type { ModelEntry } from '../../api/client'
import { HardDrive, Loader2 } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'

interface AddModelModalProps {
    onClose: () => void
    onModelsAdded: () => void
    initialPath?: string
}

export function AddModelModal({ onClose, onModelsAdded, initialPath }: AddModelModalProps) {
    const { t } = useTranslation()
    const [customName, setCustomName] = useState(initialPath ? (initialPath.split('/').pop()?.replace('.gguf', '') ?? '') : '')
    const [customPath, setCustomPath] = useState(initialPath ?? '')
    const [foundModels, setFoundModels] = useState<ModelEntry[]>([])
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
    const [scanning, setScanning] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const trapRef = useFocusTrap(true)

    const handleScan = async (path: string) => {
        if (!path) return
        setScanning(true)
        setError(null)
        try {
            const found = await apiClient.engine.scanModels(path)
            setFoundModels(found)
            setSelectedPaths(new Set(found.map(m => m.path || m.local_path).filter((p): p is string => p !== null)))
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setScanning(false)
        }
    }

    // B-1: useEffect AFTER handleScan is declared
    // U-4: setScanning(true) immediately so modal shows spinner right away
    useEffect(() => {
        if (initialPath) {
            setScanning(true)
            setTimeout(() => handleScan(initialPath), 80)
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const handleRegister = async () => {
        if (foundModels.length > 0) {
            if (selectedPaths.size === 0) return
            try {
                setLoading(true)
                for (const path of Array.from(selectedPaths)) {
                    const found = foundModels.find(m => (m.path || m.local_path) === path)
                    const name = found?.name || path.split('/').pop() || customName
                    await apiClient.engine.registerModel(name, path, "")
                }
                onModelsAdded()
                onClose()
            } catch (e: unknown) {
                setError(e instanceof Error ? e.message : String(e))
            } finally {
                setLoading(false)
            }
        } else {
            if (!customName || !customPath) return
            try {
                setLoading(true)
                await apiClient.engine.registerModel(customName, customPath, "")
                onModelsAdded()
                onClose()
            } catch (e: unknown) {
                setError(e instanceof Error ? e.message : String(e))
            } finally {
                setLoading(false)
            }
        }
    }

    const togglePathSelection = (path: string) => {
        const next = new Set(selectedPaths)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        setSelectedPaths(next)
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={onClose}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="add-model-modal-title"
                ref={trapRef}
                className="bg-[#18181B] border border-white/10 rounded-xl max-w-md w-full p-6 max-h-[85vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <h3 id="add-model-modal-title" className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                    <HardDrive className="w-5 h-5 text-blue-400" />
                    Add Local Model Directory
                </h3>

                {error && (
                    <div className="mb-4 bg-red-500/10 border border-red-500/20 text-red-400 px-3 py-2 rounded-lg text-xs flex justify-between items-center">
                        <span>{error}</span>
                        <button type="button" onClick={() => setError(null)} className="text-red-400/60 hover:text-red-400 ml-2 shrink-0" aria-label="Dismiss error">✕</button>
                    </div>
                )}

                <div className="space-y-4">
                    <div>
                        <label className="block text-xs uppercase text-gray-500 font-semibold mb-1.5">Model Alias</label>
                        <input
                            type="text"
                            value={customName}
                            onChange={(e) => setCustomName(e.target.value)}
                            placeholder="e.g. My Meta Llama Finetune"
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-blue-500 text-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-xs uppercase text-gray-500 font-semibold mb-1.5">Local Directory Path</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={customPath}
                                onChange={(e) => setCustomPath(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter' && customPath) handleScan(customPath) }}
                                placeholder="/Users/name/models/llama-3 or ~/.lmstudio/models"
                                className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-blue-500 text-sm"
                            />
                            <button
                                type="button"
                                onClick={async () => {
                                    try {
                                        const path = await window.electronAPI?.selectDirectory?.()
                                        if (path) {
                                            setCustomPath(path)
                                            handleScan(path)
                                        }
                                    } catch {
                                        if (customPath) handleScan(customPath)
                                    }
                                }}
                                className="bg-white/10 hover:bg-blue-500 hover:text-white text-gray-300 px-4 py-2 rounded-lg transition-colors text-sm font-medium"
                            >
                                Browse
                            </button>
                            {!foundModels.length && customPath && !scanning && (
                                <button
                                    type="button"
                                    onClick={() => handleScan(customPath)}
                                    className="bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 px-4 py-2 rounded-lg transition-colors text-sm font-medium border border-blue-500/20"
                                >
                                    Scan
                                </button>
                            )}
                        </div>
                        <div className="flex gap-2 mt-3">
                            {[
                                { label: 'LM Studio', path: '~/.lmstudio/models', name: 'LM Studio Models' },
                                { label: 'Ollama', path: '~/.ollama/models', name: 'Ollama Models' },
                                { label: 'HF Cache', path: '~/.cache/huggingface/hub', name: 'HF Hub Cache' },
                            ].map(preset => (
                                <button
                                    key={preset.label}
                                    type="button"
                                    onClick={() => {
                                        setCustomName(preset.name)
                                        setCustomPath(preset.path)
                                        handleScan(preset.path)
                                    }}
                                    className="text-[10px] font-bold bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                                >
                                    <div className="w-1 h-1 rounded-full bg-blue-400" />
                                    {preset.label}
                                </button>
                            ))}
                        </div>

                        {scanning && (
                            <div className="mt-4 flex items-center gap-2 text-xs text-gray-400">
                                <Loader2 size={12} className="animate-spin" />
                                Scanning directory for MLX models...
                            </div>
                        )}

                        {foundModels.length > 0 && (
                            <div className="mt-6 border border-white/10 rounded-lg overflow-hidden bg-black/40 max-h-48 overflow-y-auto">
                                <div className="bg-white/5 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-400 border-b border-white/5 flex justify-between">
                                    <span>Found Models ({foundModels.length})</span>
                                    <span>Select</span>
                                </div>
                                {foundModels.map(m => (
                                    <div key={m.path} className="flex items-center justify-between px-3 py-2 border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                                        <div className="min-w-0 flex-1 mr-3">
                                            <div className="text-xs font-medium text-white truncate">{m.name}</div>
                                            <div className="text-[10px] text-gray-500 flex gap-2">
                                                <span>{m.architecture}</span>
                                                <span>{m.size}</span>
                                            </div>
                                        </div>
                                        <input
                                            type="checkbox"
                                            title={`Select ${m.name}`}
                                            checked={selectedPaths.has(m.path || '')}
                                            onChange={() => togglePathSelection(m.path || '')}
                                            className="w-4 h-4 rounded border-white/10 bg-black/40 text-blue-500"
                                        />
                                    </div>
                                ))}
                            </div>
                        )}

                        {foundModels.length === 0 && !scanning && customPath && (
                            <p className="text-[11px] text-gray-500 mt-2">
                                Supported formats: MLX safetensors. The directory must contain `config.json`.
                            </p>
                        )}
                    </div>
                </div>

                <div className="flex justify-end gap-3 mt-8 pt-4 border-t border-white/5">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:bg-white/5 transition-colors"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={handleRegister}
                        disabled={(!customName || (!customPath && selectedPaths.size === 0)) || loading || scanning}
                        className="px-5 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {foundModels.length > 0 ? `${t('models.addModel')} (${selectedPaths.size})` : t('models.addModel')}
                    </button>
                </div>
            </div>
        </div>
    )
}
