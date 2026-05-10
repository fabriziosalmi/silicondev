import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { apiClient } from '../../api/client'
import type { ModelEntry, JobStatus, ModelFormatInfo } from '../../api/client'
import { useGlobalState } from '../../context/GlobalState'
import { useToast } from '../ui/Toast'
import { Cpu, Activity, Play, Settings2, ShieldAlert, FileText, Download, Loader2 } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

const PRESETS = {
    draft: { name: 'Draft (Fast)', epochs: 1, batchSize: 2, loraRank: 8, loraAlpha: 16, lr: 2e-4 },
    balanced: { name: 'Balanced', epochs: 3, batchSize: 1, loraRank: 16, loraAlpha: 32, lr: 1e-4 },
    deep: { name: 'Deep (Slow)', epochs: 10, batchSize: 1, loraRank: 32, loraAlpha: 64, lr: 5e-5 },
    custom: { name: 'Custom', epochs: 3, batchSize: 1, loraRank: 8, loraAlpha: 16, lr: 1e-4 },
}

interface LoraTabProps {
    models: ModelEntry[]
    selectedModel: string
    setSelectedModel: (id: string) => void
    capturedCount: number
    setCapturedCount: (n: number) => void
}

export function LoraTab({ models, selectedModel, setSelectedModel, capturedCount, setCapturedCount }: LoraTabProps) {
    const { t } = useTranslation()
    const { setIsTraining } = useGlobalState()
    const { toast } = useToast()

    const [datasetPath, setDatasetPath] = useState('train.jsonl')
    const [preset, setPreset] = useState<keyof typeof PRESETS>('balanced')
    const [epochs, setEpochs] = useState(PRESETS.balanced.epochs)
    const [learningRate, setLearningRate] = useState(PRESETS.balanced.lr)
    const [batchSize, setBatchSize] = useState(PRESETS.balanced.batchSize)
    const [loraRank, setLoraRank] = useState(PRESETS.balanced.loraRank)
    const [loraAlpha, setLoraAlpha] = useState(PRESETS.balanced.loraAlpha)
    const [maxSeqLength, setMaxSeqLength] = useState(512)
    const [loraDropout, setLoraDropout] = useState(0.0)
    const [loraLayers, setLoraLayers] = useState(16)
    const [seed, setSeed] = useState<number | null>(null)
    const [jobName, setJobName] = useState('')

    const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
    const [loading, setLoading] = useState(false)
    const [chartData, setChartData] = useState<{ step: number; loss: number }[]>(() => {
        try {
            const saved = localStorage.getItem('silicon-studio-last-loss')
            return saved ? JSON.parse(saved) : []
        } catch { return [] }
    })
    const [exporting, setExporting] = useState(false)
    const [exportPath] = useState('~/Documents/Silicon-Studio/Exports')
    const [modelFormat, setModelFormat] = useState<ModelFormatInfo | null>(null)
    const [capturedLoading, setCapturedLoading] = useState(false)

    useEffect(() => {
        if (!selectedModel) { setModelFormat(null); return }
        apiClient.engine.getModelFormat(selectedModel)
            .then(setModelFormat)
            .catch(() => setModelFormat(null))
    }, [selectedModel])

    const useCapturedDataset = async () => {
        setCapturedLoading(true)
        try {
            const pkg = await apiClient.terminal.datasetPrepare(10)
            setDatasetPath(pkg.path + '/train.jsonl')
            toast(`Dataset ready: ${pkg.count} samples`, 'success')
            setCapturedCount(pkg.count)
        } catch (err: unknown) {
            toast(err instanceof Error ? err.message : 'Not enough captured samples', 'warning')
        } finally {
            setCapturedLoading(false)
        }
    }

    const handlePresetChange = (p: keyof typeof PRESETS) => {
        setPreset(p)
        if (p !== 'custom') {
            const config = PRESETS[p]
            setEpochs(config.epochs)
            setBatchSize(config.batchSize)
            setLoraRank(config.loraRank)
            setLoraAlpha(config.loraAlpha)
            setLearningRate(config.lr)
        }
    }

    const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current) }
    }, [])

    const pollStatus = (jobId: string) => {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = setInterval(async () => {
            try {
                const data = await apiClient.engine.getJobStatus(jobId)
                setJobStatus(data)

                if (data.loss !== undefined) {
                    setChartData(prev => [...prev, {
                        step: prev.length + 1,
                        loss: parseFloat((data.loss as number).toFixed(4))
                    }])
                }

                if (data.status === 'completed' || data.status === 'failed') {
                    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
                    pollIntervalRef.current = null
                    setIsTraining(false)
                    setChartData(prev => {
                        try { localStorage.setItem('silicon-studio-last-loss', JSON.stringify(prev)) } catch { /* storage full or unavailable */ }
                        return prev
                    })
                }
            } catch {
                if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
                pollIntervalRef.current = null
                setIsTraining(false)
            }
        }, 1000)
    }

    const startTraining = async () => {
        if (!jobName.trim()) {
            toast('Please enter a Job Name to identify your fine-tuned model.', 'warning')
            return
        }

        setLoading(true)
        setChartData([])
        try {
            const data = await apiClient.engine.finetune({
                model_id: selectedModel,
                dataset_path: datasetPath,
                epochs,
                learning_rate: learningRate,
                batch_size: batchSize,
                lora_rank: loraRank,
                lora_alpha: loraAlpha,
                max_seq_length: maxSeqLength,
                lora_dropout: loraDropout,
                lora_layers: loraLayers,
                ...(seed !== null ? { seed } : {}),
                job_name: jobName
            })
            setJobStatus({ ...data, progress: 0, status: 'starting' })
            setIsTraining(true)
            pollStatus(data.job_id)
        } catch (err: unknown) {
            toast(`Fine-tuning failed to start: ${err instanceof Error ? err.message : String(err)}`, 'error')
        } finally {
            setLoading(false)
        }
    }

    const handleExport = async (qBits: number = 4) => {
        if (!jobStatus || !jobStatus.job_id) return
        setExporting(true)
        try {
            const modelId = `ft-${jobStatus.job_id}`
            const fullPath = exportPath.startsWith('~') ? exportPath : exportPath
            await apiClient.engine.exportModel(modelId, `${fullPath}/${jobStatus.job_name || 'model'}_q${qBits}`, qBits)
            toast(`Model exported successfully to ${fullPath}`, 'success')
        } catch (err: unknown) {
            toast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
        } finally {
            setExporting(false)
        }
    }

    if (models.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-white/5 rounded-xl bg-white/[0.02] p-8 mt-4">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4 text-gray-500">
                    <Cpu size={32} />
                </div>
                <p className="text-gray-300 font-medium text-lg">No base models available</p>
                <p className="text-gray-500 text-sm mt-2 max-w-sm text-center">
                    You need to download a base foundation model first before you can train it.
                    Go to the Models tab to get started.
                </p>
            </div>
        )
    }

    return (
        <div className="flex-1 flex gap-4 overflow-hidden min-h-0">

            {/* Settings Sidebar — sticky header & footer (CTA), middle scrolls. */}
            <div className="w-[400px] flex flex-col min-h-0 bg-[#18181B] border border-white/10 rounded-xl overflow-hidden">
                {/* Sticky header */}
                <div className="px-4 py-3 border-b border-white/10 bg-white/[0.02] flex items-center gap-2 shrink-0">
                    <Settings2 className="w-4 h-4 text-blue-400" />
                    <h3 className="font-bold text-sm">Job Configuration</h3>
                </div>

                {/* Scrollable middle */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">

                    {/* Target Name + Base Model side-by-side */}
                    <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Target Name</label>
                            <input
                                type="text"
                                placeholder="My-Finance-Expert"
                                value={jobName}
                                onChange={e => setJobName(e.target.value)}
                                className="w-full bg-black/40 border border-white/10 rounded-md px-2 h-8 text-[12px] text-white outline-none focus:border-blue-500 placeholder-gray-600"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{t('engine.selectModel')}</label>
                            <select
                                title="Base Foundation Model"
                                className="w-full bg-black/40 border border-white/10 rounded-md px-2 h-8 text-[12px] text-white outline-none focus:border-blue-500 appearance-none truncate"
                                value={selectedModel}
                                onChange={e => setSelectedModel(e.target.value)}
                            >
                                {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Model Format Info — compact strip */}
                    {modelFormat && (
                        <div className="flex items-center gap-2 px-2 py-1 rounded bg-black/20 border border-white/5 text-[10px] text-gray-500">
                            <span className="text-gray-400 font-medium">{modelFormat.model_type}</span>
                            <span className="w-px h-3 bg-white/10" />
                            <span className={modelFormat.has_chat_template ? 'text-green-500/70' : 'text-yellow-500/70'}>
                                {modelFormat.has_chat_template ? 'chat template' : 'no chat template'}
                            </span>
                            {modelFormat.eos_token && (
                                <>
                                    <span className="w-px h-3 bg-white/10" />
                                    <code className="text-gray-400">{modelFormat.eos_token}</code>
                                </>
                            )}
                        </div>
                    )}

                    {/* Dataset Path */}
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{t('engine.dataset')}</label>
                            {capturedCount > 0 && (
                                <button
                                    type="button"
                                    onClick={useCapturedDataset}
                                    disabled={capturedLoading}
                                    className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20 transition-colors disabled:opacity-50"
                                >
                                    {capturedLoading ? <Loader2 size={9} className="animate-spin" /> : <Activity size={9} />}
                                    Use {capturedCount} captured
                                </button>
                            )}
                        </div>
                        <div className="flex gap-1.5">
                            <div className="flex-1 bg-black/40 border border-white/10 rounded-md px-2 h-8 text-[11px] text-blue-100/70 truncate flex items-center gap-1.5">
                                <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                                {datasetPath.split('/').pop() || "No file selected"}
                            </div>
                            <button
                                type="button"
                                onClick={async () => {
                                    const path = await window.electronAPI?.selectFile?.()
                                    if (path) setDatasetPath(path)
                                }}
                                className="bg-white/10 hover:bg-white/20 text-white px-3 h-8 rounded-md transition-colors text-[11px] font-medium"
                            >
                                Select
                            </button>
                        </div>
                    </div>

                    {/* Hyperparameters */}
                    <div className="pt-2 border-t border-white/5 space-y-2">
                        <div className="flex justify-between items-center">
                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Hyperparameters</label>
                            <select
                                title="Hyperparameters Preset"
                                value={preset}
                                onChange={(e) => handlePresetChange(e.target.value as keyof typeof PRESETS | 'custom')}
                                className="bg-white/5 text-gray-300 border border-white/10 text-[10px] rounded px-1.5 py-0.5 outline-none"
                            >
                                <option value="draft">Draft (Fast)</option>
                                <option value="balanced">Balanced</option>
                                <option value="deep">Deep (Slow)</option>
                                <option value="custom">Custom...</option>
                            </select>
                        </div>

                        <div className="grid grid-cols-4 gap-1.5">
                            <div className="space-y-0.5">
                                <label className="text-[9px] text-gray-500 uppercase" title="Number of full passes through the dataset">{t('engine.epochs')}</label>
                                <input type="number" title="Epochs" value={epochs} onChange={e => { setEpochs(parseInt(e.target.value)); setPreset('custom') }} className="w-full bg-black/40 border border-white/10 rounded px-1.5 h-7 text-[11px] font-mono outline-none" />
                            </div>
                            <div className="space-y-0.5">
                                <label className="text-[9px] text-gray-500 uppercase" title="Samples processed per training step">{t('engine.batchSize')}</label>
                                <input type="number" title="Batch Size" value={batchSize} onChange={e => { setBatchSize(parseInt(e.target.value)); setPreset('custom') }} className="w-full bg-black/40 border border-white/10 rounded px-1.5 h-7 text-[11px] font-mono outline-none" />
                            </div>
                            <div className="space-y-0.5">
                                <label className="text-[9px] text-gray-500 uppercase" title="How fast the model adapts — lower is safer but slower">{t('engine.learningRate')}</label>
                                <input type="number" title="Learning Rate" step="0.00001" value={learningRate} onChange={e => { setLearningRate(parseFloat(e.target.value)); setPreset('custom') }} className="w-full bg-black/40 border border-white/10 rounded px-1.5 h-7 text-[11px] font-mono outline-none" />
                            </div>
                            <div className="space-y-0.5">
                                <label className="text-[9px] text-gray-500 uppercase" title="Max tokens per training example — longer uses more memory">Max Seq</label>
                                <input type="number" title="Max Seq Length" value={maxSeqLength} onChange={e => { setMaxSeqLength(parseInt(e.target.value)); setPreset('custom') }} className="w-full bg-black/40 border border-white/10 rounded px-1.5 h-7 text-[11px] font-mono outline-none" />
                            </div>
                        </div>

                        {/* LoRA Specifics — inline, no inner card */}
                        <div className="pt-2 border-t border-white/5 space-y-1.5">
                            <div className="text-[9px] font-bold text-gray-500 uppercase">LoRA Specifics</div>
                            <div className="grid grid-cols-5 gap-1.5">
                                <div className="space-y-0.5">
                                    <label className="text-[9px] text-gray-500 uppercase" title="Adapter capacity — higher rank = more expressive but uses more memory">Rank</label>
                                    <input type="number" title="LoRA Rank" value={loraRank} onChange={e => { setLoraRank(parseInt(e.target.value)); setPreset('custom') }} className="w-full bg-black/40 border border-white/10 rounded px-1.5 h-7 text-[11px] font-mono outline-none" />
                                </div>
                                <div className="space-y-0.5">
                                    <label className="text-[9px] text-gray-500 uppercase" title="Scaling factor — typically 2x rank">Alpha</label>
                                    <input type="number" title="LoRA Alpha" value={loraAlpha} onChange={e => { setLoraAlpha(parseInt(e.target.value)); setPreset('custom') }} className="w-full bg-black/40 border border-white/10 rounded px-1.5 h-7 text-[11px] font-mono outline-none" />
                                </div>
                                <div className="space-y-0.5">
                                    <label className="text-[9px] text-gray-500 uppercase" title="How many transformer layers get LoRA adapters">Layers</label>
                                    <input type="number" title="Target Layers" value={loraLayers} onChange={e => { setLoraLayers(parseInt(e.target.value)); setPreset('custom') }} className="w-full bg-black/40 border border-white/10 rounded px-1.5 h-7 text-[11px] font-mono outline-none" />
                                </div>
                                <div className="space-y-0.5">
                                    <label className="text-[9px] text-gray-500 uppercase" title="Regularization — 0 disables, 0.05-0.1 helps prevent overfitting">Dropout</label>
                                    <input type="number" title="LoRA Dropout" step="0.05" value={loraDropout} onChange={e => { setLoraDropout(parseFloat(e.target.value)); setPreset('custom') }} className="w-full bg-black/40 border border-white/10 rounded px-1.5 h-7 text-[11px] font-mono outline-none" />
                                </div>
                                <div className="space-y-0.5">
                                    <label className="text-[9px] text-gray-500 uppercase" title="Fixed random seed for reproducible training runs. Leave empty for random.">Seed</label>
                                    <input type="number" title="Random Seed" placeholder="Rnd" value={seed ?? ''} onChange={e => setSeed(e.target.value ? parseInt(e.target.value) : null)} className="w-full bg-black/40 border border-white/10 rounded px-1.5 h-7 text-[11px] font-mono outline-none placeholder-gray-600" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Sticky footer CTA — always visible, never scrolls. */}
                <div className="px-4 py-3 border-t border-white/10 bg-white/[0.02] shrink-0">
                    <button
                        type="button"
                        onClick={startTraining}
                        disabled={loading || (jobStatus?.status === 'training')}
                        className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold h-10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <Play className="w-4 h-4 fill-current" />
                        )}
                        <span className="text-sm">{jobStatus?.status === 'training' ? t('engine.training') + '...' : t('engine.startTraining')}</span>
                    </button>
                </div>
            </div>

            {/* Live Telemetry Area */}
            <div className="flex-1 flex flex-col gap-6 overflow-hidden">

                {/* Status Strip */}
                {jobStatus ? (
                    <div className="bg-black/40 border border-white/10 rounded-xl p-5 shrink-0">
                        <div className="flex justify-between items-center mb-4">
                            <div>
                                <div className="text-lg font-bold flex items-center gap-3">
                                    {jobStatus.status === 'training' && <div className="w-3 h-3 rounded-full bg-blue-500" />}
                                    {jobStatus.status === 'completed' && <div className="w-3 h-3 rounded-full bg-green-500" />}
                                    {jobStatus.status === 'failed' && <div className="w-3 h-3 rounded-full bg-red-500" />}
                                    {jobStatus.job_name || 'Active Run'}
                                </div>
                                <div className="text-xs font-mono text-gray-500 mt-1">ID: {jobStatus.job_id}</div>
                            </div>
                            <div className="text-right">
                                <div className="text-2xl font-mono text-white mb-1">{jobStatus.progress}%</div>
                                <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wide ${jobStatus.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                                    jobStatus.status === 'training' ? 'bg-blue-500/20 text-blue-400' :
                                        jobStatus.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                                            'bg-gray-500/20 text-gray-400'
                                    }`}>
                                    {jobStatus.status}
                                </span>
                            </div>
                        </div>
                        <div className="w-full bg-black/40 h-2 rounded-full overflow-hidden border border-white/5">
                            <div
                                className={`h-full transition-all duration-500 ${jobStatus.status === 'completed' ? 'bg-green-500' : jobStatus.status === 'failed' ? 'bg-red-500' : 'bg-blue-500 relative overflow-hidden'}`}
                                style={{ width: `${jobStatus.progress}%` }}
                            >
                                {jobStatus.status === 'training' && (
                                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]" />
                                )}
                            </div>
                        </div>

                        {jobStatus.status === 'completed' && (
                            <div className="mt-4 pt-4 border-t border-white/5 flex flex-col gap-3">
                                <div className="text-[10px] text-gray-500 uppercase tracking-wide font-bold">{t('engine.completed')}</div>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => handleExport(4)}
                                        disabled={exporting}
                                        className="flex-1 bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/30 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                                        {exporting ? 'Fusing model...' : 'Export 4-bit GGUF'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleExport(8)}
                                        disabled={exporting}
                                        className="flex-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                                        {exporting ? 'Fusing model...' : 'Export 8-bit GGUF'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="bg-black/20 border border-white/10 border-dashed rounded-xl p-6 text-center shrink-0">
                        <ShieldAlert className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                        <h4 className="text-gray-400 font-medium">{t('engine.idle')}</h4>
                        <p className="text-gray-500 text-sm">Configure your parameters and start a job to view live telemetry.</p>
                    </div>
                )}

                {/* Telemetry Chart */}
                <div className="flex-1 bg-[#18181B] border border-white/10 rounded-xl flex flex-col overflow-hidden min-h-[300px]">
                    <div className="p-4 border-b border-white/5 bg-white/[0.02] flex items-center justify-between z-10">
                        <div className="flex items-center gap-2">
                            <Activity className="w-5 h-5 text-blue-400" />
                            <h3 className="font-bold">{t('engine.loss')}</h3>
                        </div>
                        <div className="text-xs flex gap-4 text-gray-500 items-center">
                            <span className="flex items-center gap-1">
                                <div className="w-2 h-2 rounded-full bg-blue-500" />
                                Validation Loss
                                {chartData.length > 0 && (
                                    <span className="ml-1 font-mono text-blue-300 tabular-nums">
                                        {chartData[chartData.length - 1].loss}
                                    </span>
                                )}
                            </span>
                            {chartData.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        const csv = 'step,loss\n' + chartData.map(d => `${d.step},${d.loss}`).join('\n')
                                        const blob = new Blob([csv], { type: 'text/csv' })
                                        const a = document.createElement('a')
                                        const objectUrl = URL.createObjectURL(blob)
                                        a.href = objectUrl
                                        a.download = `loss-${jobStatus?.job_name || 'training'}.csv`
                                        a.click()
                                        // Revoke after 60s to avoid aborting the download.
                                        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
                                    }}
                                    className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-gray-400"
                                >
                                    <Download className="w-3 h-3" />
                                    Export CSV
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="flex-1 p-4 w-full h-full relative">
                        {chartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                                    <XAxis
                                        dataKey="step"
                                        stroke="#ffffff40"
                                        fontSize={12}
                                        tickLine={false}
                                        axisLine={{ stroke: '#ffffff10' }}
                                    />
                                    <YAxis
                                        stroke="#ffffff40"
                                        fontSize={12}
                                        tickLine={false}
                                        axisLine={false}
                                        domain={['auto', 'auto']}
                                    />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'rgba(24, 24, 27, 0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                        itemStyle={{ color: '#60a5fa' }}
                                        labelStyle={{ color: '#9ca3af', marginBottom: '4px' }}
                                        formatter={(value: number | string) => [`${value}`, 'Loss']}
                                        labelFormatter={(label) => `Step ${label}`}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="loss"
                                        stroke="#3b82f6"
                                        strokeWidth={2}
                                        dot={false}
                                        activeDot={{ r: 5, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }}
                                        isAnimationActive={true}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="text-gray-600 opacity-50 font-mono text-sm">Waiting for training data...</div>
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    )
}
