import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { apiClient, cleanModelName } from '../api/client'
import type { ModelEntry } from '../api/client'
import { Card } from './ui/Card'
import { Package, Download, FolderOpen, Check, AlertCircle, Loader2, Sparkles, Zap, Shield, MinusCircle } from 'lucide-react'

type Precision = 0 | 2 | 4 | 8

const PRECISION_OPTIONS: {
    value: Precision
    label: string
    name: string
    desc: string
    icon: typeof Sparkles
    activeBg: string
    activeBorder: string
    accent: string
}[] = [
    {
        value: 2,
        label: '2-bit',
        name: 'Aggressive',
        desc: 'Smallest size. May degrade quality on models < 7B.',
        icon: MinusCircle,
        activeBg: 'bg-orange-500/10',
        activeBorder: 'border-orange-500/30',
        accent: 'text-orange-300',
    },
    {
        value: 4,
        label: '4-bit',
        name: 'Recommended',
        desc: 'Best size-vs-quality trade-off for most models.',
        icon: Sparkles,
        activeBg: 'bg-emerald-500/10',
        activeBorder: 'border-emerald-500/30',
        accent: 'text-emerald-300',
    },
    {
        value: 8,
        label: '8-bit',
        name: 'Quality',
        desc: 'Larger file, output much closer to original.',
        icon: Shield,
        activeBg: 'bg-blue-500/10',
        activeBorder: 'border-blue-500/30',
        accent: 'text-blue-300',
    },
    {
        value: 0,
        label: 'Full',
        name: 'No quant',
        desc: 'Original precision. Useful for further fine-tuning.',
        icon: Zap,
        activeBg: 'bg-purple-500/10',
        activeBorder: 'border-purple-500/30',
        accent: 'text-purple-300',
    },
]

function parseSizeGB(s: string | undefined): number {
    if (!s) return 0
    const m = s.match(/([\d.]+)\s*GB/i)
    return m ? parseFloat(m[1]) : 0
}

function formatGB(gb: number): string {
    if (gb < 0.1) return `${(gb * 1024).toFixed(0)} MB`
    if (gb < 10) return `${gb.toFixed(2)} GB`
    return `${gb.toFixed(1)} GB`
}

export function ModelExport() {
    const { t } = useTranslation()
    const [adapters, setAdapters] = useState<ModelEntry[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedId, setSelectedId] = useState('')
    const [qBits, setQBits] = useState<Precision>(4)
    const [outputPath, setOutputPath] = useState('')
    const [exporting, setExporting] = useState(false)
    const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

    const fetchAdapters = useCallback(async () => {
        setLoading(true)
        try {
            const list = await apiClient.engine.listAdapters()
            setAdapters(list)
            // Only set the default selection once (on first load when nothing is selected).
            // Do NOT put `selectedId` in this callback's deps — it would cause
            // fetchAdapters() to re-run every time the user picks a different model.
            setSelectedId(prev => (prev || (list.length > 0 ? list[0].id : '')))
        } catch {
            setAdapters([])
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchAdapters()
    }, [fetchAdapters])

    const handleSelectOutput = async () => {
        try {
            const path = await window.electronAPI?.selectDirectory?.()
            if (path) {
                const model = adapters.find(a => a.id === selectedId)
                const slug = model ? cleanModelName(model.name).replace(/\s+/g, '-').toLowerCase() : 'export'
                const suffix = qBits > 0 ? `${qBits}bit` : 'full'
                setOutputPath(`${path}/${slug}-${suffix}`)
            }
        } catch { /* ignore */ }
    }

    const handleExport = async () => {
        if (!selectedId || !outputPath) return
        setExporting(true)
        setResult(null)
        try {
            const res = await apiClient.engine.exportModel(selectedId, outputPath, qBits)
            // Auto-register the exported model so it shows up in My Models without
            // requiring the user to rescan. Failure here is non-fatal: the file is
            // on disk, the registry is just a convenience.
            const model = adapters.find(a => a.id === selectedId)
            if (model) {
                try {
                    const exportName = `${cleanModelName(model.name)} · ${qBits > 0 ? `${qBits}-bit` : 'full'}`
                    await apiClient.engine.registerModel(exportName, res.path)
                } catch { /* registration is best-effort */ }
            }
            setResult({ type: 'success', message: `Exported to ${res.path} — added to My Models.` })
        } catch (err) {
            setResult({ type: 'error', message: err instanceof Error ? err.message : 'Export failed' })
        } finally {
            setExporting(false)
        }
    }

    const selected = adapters.find(a => a.id === selectedId)

    // Size estimate assumes the listed size reflects the current weight precision
    // (typically fp16 baseline). For an MLX model already quantized further
    // reduction may be more aggressive — this is a rough planning number, not a
    // guarantee.
    const sizeEstimate = useMemo(() => {
        const originalGB = parseSizeGB(selected?.size)
        if (originalGB === 0) return null
        const estimatedGB = qBits === 0 ? originalGB : originalGB * (qBits / 16)
        const savings = qBits === 0 ? 0 : Math.max(0, Math.round((1 - estimatedGB / originalGB) * 100))
        return { originalGB, estimatedGB, savings }
    }, [selected, qBits])

    // Quality guard: 2-bit on models < 7B often falls apart. The "size" string
    // is the best signal we have client-side — anything roughly under 5 GB is
    // probably a smaller model where 2-bit is risky.
    const aggressiveWarning = useMemo(() => {
        if (qBits !== 2) return null
        const gb = parseSizeGB(selected?.size)
        if (gb > 0 && gb < 5.0) {
            return 'Heads-up: 2-bit on a small base model usually degrades output noticeably. 4-bit is safer.'
        }
        return null
    }, [qBits, selected])

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-center gap-3">
                <Package size={20} className="text-blue-400" />
                <h2 className="text-lg font-bold text-white">{t('export.title')}</h2>
            </div>

            {loading ? (
                <Card className="p-8 flex items-center justify-center">
                    <Loader2 size={20} className="animate-spin text-foreground-muted" />
                </Card>
            ) : adapters.length === 0 ? (
                <Card className="p-8 text-center">
                    <Package size={32} className="mx-auto text-foreground-subtle mb-3" />
                    <p className="text-sm text-foreground-muted">{t('export.noModels')}</p>
                    <p className="text-xs text-foreground-subtle mt-1">{t('export.noModelsHint')}</p>
                </Card>
            ) : (
                <>
                    {/* Model Selection */}
                    <Card className="p-5">
                        <label className="text-xs font-bold text-foreground-muted uppercase mb-3 block">{t('export.selectModel')}</label>
                        <div className="space-y-2">
                            {adapters.map(adapter => (
                                <button
                                    key={adapter.id}
                                    onClick={() => setSelectedId(adapter.id)}
                                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-all ${
                                        selectedId === adapter.id
                                            ? 'bg-blue-500/10 border-blue-500/30 text-white'
                                            : 'bg-black/20 border-outline-subtle text-foreground-muted hover:bg-hover hover:border-outline'
                                    }`}
                                >
                                    <Package size={16} className={selectedId === adapter.id ? 'text-blue-400' : 'text-foreground-subtle'} />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium truncate">{cleanModelName(adapter.name)}</div>
                                        {adapter.base_model && (
                                            <div className="text-[10px] text-foreground-subtle truncate">Base: {adapter.base_model}</div>
                                        )}
                                    </div>
                                    <span className="text-xs text-foreground-subtle">{adapter.size}</span>
                                </button>
                            ))}
                        </div>
                    </Card>

                    {/* Precision Selection — 4 presets */}
                    <Card className="p-5">
                        <label className="text-xs font-bold text-foreground-muted uppercase mb-3 block">{t('export.quantization')}</label>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            {PRECISION_OPTIONS.map(opt => {
                                const Icon = opt.icon
                                const isActive = qBits === opt.value
                                return (
                                    <button
                                        key={opt.value}
                                        onClick={() => setQBits(opt.value)}
                                        className={`flex flex-col gap-1 px-3 py-3 rounded-lg border text-left transition-all ${
                                            isActive
                                                ? `${opt.activeBg} ${opt.activeBorder}`
                                                : 'bg-black/20 border-outline-subtle hover:bg-hover hover:border-outline'
                                        }`}
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <Icon size={12} className={isActive ? opt.accent : 'text-foreground-muted'} />
                                            <span className={`text-[10px] font-bold uppercase tracking-wider ${isActive ? opt.accent : 'text-foreground-muted'}`}>{opt.name}</span>
                                        </div>
                                        <span className={`text-sm font-bold ${isActive ? 'text-foreground' : 'text-foreground-secondary'}`}>{opt.label}</span>
                                        <span className="text-[10px] text-foreground-muted leading-snug">{opt.desc}</span>
                                    </button>
                                )
                            })}
                        </div>
                        {aggressiveWarning && (
                            <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-warn-muted border border-warn/30 text-[11px] text-warn">
                                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                                <span>{aggressiveWarning}</span>
                            </div>
                        )}
                    </Card>

                    {/* Size estimate */}
                    {sizeEstimate && (
                        <Card className="p-4">
                            <div className="grid grid-cols-3 gap-4 text-center">
                                <div>
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">Original</div>
                                    <div className="text-lg font-bold text-foreground-secondary font-mono tabular-nums mt-0.5">{formatGB(sizeEstimate.originalGB)}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">After {qBits === 0 ? 'export' : `${qBits}-bit`}</div>
                                    <div className="text-lg font-bold text-emerald-400 font-mono tabular-nums mt-0.5">~{formatGB(sizeEstimate.estimatedGB)}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">Savings</div>
                                    <div className={`text-lg font-bold font-mono tabular-nums mt-0.5 ${sizeEstimate.savings > 0 ? 'text-emerald-400' : 'text-foreground-muted'}`}>
                                        {sizeEstimate.savings > 0 ? `−${sizeEstimate.savings}%` : '—'}
                                    </div>
                                </div>
                            </div>
                            <p className="text-[10px] text-foreground-subtle text-center mt-2">
                                Estimate assumes original at fp16. Actual size depends on the model's existing precision and group size.
                            </p>
                        </Card>
                    )}

                    {/* Output Path + Export */}
                    <Card className="p-5">
                        <label className="text-xs font-bold text-foreground-muted uppercase mb-3 block">Output</label>
                        <div className="flex gap-3">
                            <button
                                onClick={handleSelectOutput}
                                className={`flex-1 flex items-center justify-between px-4 py-3 rounded-lg border text-sm transition-all text-left ${
                                    outputPath
                                        ? 'bg-green-500/10 border-green-500/30 text-green-200'
                                        : 'bg-black/40 border-outline text-foreground-muted hover:bg-hover'
                                }`}
                            >
                                <span className="truncate">{outputPath || 'Select output folder...'}</span>
                                <FolderOpen size={16} className="opacity-50 shrink-0 ml-2" />
                            </button>
                            <button
                                onClick={handleExport}
                                disabled={exporting || !outputPath || !selectedId}
                                className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {exporting ? (
                                    <><Loader2 size={16} className="animate-spin" /> {t('export.exporting')}</>
                                ) : (
                                    <><Download size={16} /> {t('export.export')}</>
                                )}
                            </button>
                        </div>

                        {selected && (
                            <div className="mt-3 text-xs text-foreground-subtle">
                                Exporting <span className="text-foreground-muted">{cleanModelName(selected.name)}</span> at{' '}
                                <span className="text-foreground-muted">{qBits > 0 ? `${qBits}-bit` : 'full'} precision</span>
                            </div>
                        )}
                    </Card>

                    {/* Result */}
                    {result && (
                        <Card className={`p-4 flex items-center gap-3 ${result.type === 'success' ? 'border-green-500/30' : 'border-red-500/30'}`}>
                            {result.type === 'success' ? (
                                <Check size={16} className="text-green-400 shrink-0" />
                            ) : (
                                <AlertCircle size={16} className="text-red-400 shrink-0" />
                            )}
                            <span className={`text-sm ${result.type === 'success' ? 'text-green-300' : 'text-red-300'}`}>
                                {result.message}
                            </span>
                        </Card>
                    )}
                </>
            )}
        </div>
    )
}
