import { useState } from 'react'
import type { ModelEntry } from '../../api/client'
import { apiClient } from '../../api/client'
import { useToast } from '../ui/Toast'
import { Card } from '../ui/Card'
import { GitCompare, Loader2, Play } from 'lucide-react'

interface DpoTabProps {
    models: ModelEntry[]
    selectedModel: string
    setSelectedModel: (id: string) => void
    capturedCount: number
    dpoCount: number
    dpoPath: string
}

export function DpoTab({ models, selectedModel, setSelectedModel, capturedCount, dpoCount, dpoPath }: DpoTabProps) {
    const { toast } = useToast()
    const [dpoTraining, setDpoTraining] = useState(false)

    const startDpoTraining = async () => {
        if (dpoCount < 20) {
            toast('Need at least 20 DPO pairs to start training. Keep approving/rejecting diffs!', 'warning')
            return
        }
        setDpoTraining(true)
        try {
            const data = await apiClient.engine.dpoTrain({
                model_id: selectedModel,
                dataset_path: dpoPath,
                epochs: 1,
                learning_rate: 1e-5,
                batch_size: 1,
                lora_rank: 16,
                lora_alpha: 32,
                lora_layers: 8,
                max_seq_length: 2048,
                dpo_beta: 0.1,
                job_name: `dpo-${Date.now()}`
            })
            toast('DPO training started', 'success')
            const dpoInterval = setInterval(async () => {
                try {
                    const s = await apiClient.engine.getJobStatus(data.job_id)
                    if (s.status === 'completed') {
                        clearInterval(dpoInterval)
                        setDpoTraining(false)
                        toast('DPO training complete! Model registered.', 'success')
                    } else if (s.status === 'failed') {
                        clearInterval(dpoInterval)
                        setDpoTraining(false)
                        toast(`DPO training failed: ${s.error || 'unknown'}`, 'error')
                    }
                } catch {
                    clearInterval(dpoInterval)
                    setDpoTraining(false)
                }
            }, 2000)
        } catch (err: unknown) {
            toast(err instanceof Error ? err.message : 'DPO training failed to start', 'error')
            setDpoTraining(false)
        }
    }

    return (
        <div className="flex-1 flex flex-col gap-6 overflow-y-auto">
            <Card className="p-0 overflow-hidden bg-[#18181B] border border-white/10">
                <div className="p-4 border-b border-white/10 bg-white/[0.02] flex items-center gap-2">
                    <GitCompare className="w-5 h-5 text-purple-400" />
                    <h3 className="font-bold">Preference Training (DPO)</h3>
                </div>
                <div className="p-5 space-y-6">
                    <div className="bg-black/20 rounded-lg border border-white/5 p-4 space-y-3">
                        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">How it works</div>
                        <p className="text-sm text-gray-400 leading-relaxed">
                            Every time you approve or reject a code change, SiliconDev captures that preference as a DPO training pair.
                            Approved diffs become "chosen" examples, rejected diffs become "rejected" examples.
                            When you have enough pairs, you can train your model to learn your coding preferences.
                        </p>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-4">
                        <div className="bg-black/30 rounded-lg border border-white/5 p-4 text-center">
                            <div className="text-3xl font-mono font-bold text-purple-400">{dpoCount}</div>
                            <div className="text-[10px] text-gray-500 uppercase mt-1">DPO Pairs</div>
                        </div>
                        <div className="bg-black/30 rounded-lg border border-white/5 p-4 text-center">
                            <div className="text-3xl font-mono font-bold text-gray-400">{capturedCount}</div>
                            <div className="text-[10px] text-gray-500 uppercase mt-1">SFT Samples</div>
                        </div>
                        <div className="bg-black/30 rounded-lg border border-white/5 p-4 text-center">
                            <div className={`text-3xl font-mono font-bold ${dpoCount >= 50 ? 'text-green-400' : dpoCount >= 20 ? 'text-yellow-400' : 'text-red-400'}`}>
                                {dpoCount >= 50 ? 'Ready' : dpoCount >= 20 ? 'Almost' : 'Low'}
                            </div>
                            <div className="text-[10px] text-gray-500 uppercase mt-1">Status</div>
                        </div>
                    </div>

                    {/* Progress bar to 50 pairs */}
                    <div>
                        <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                            <span>Progress to minimum (50 pairs)</span>
                            <span>{Math.min(dpoCount, 50)}/50</span>
                        </div>
                        <div className="w-full bg-black/40 h-2 rounded-full overflow-hidden border border-white/5">
                            <div
                                className={`h-full transition-all duration-500 ${dpoCount >= 50 ? 'bg-green-500' : 'bg-purple-500'}`}
                                style={{ width: `${Math.min((dpoCount / 50) * 100, 100)}%` }}
                            />
                        </div>
                    </div>

                    {/* Model selector + Train button */}
                    <div className="space-y-3">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Base Model</label>
                            <select
                                title="Base model for DPO training"
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white outline-none focus:border-purple-500 appearance-none"
                                value={selectedModel}
                                onChange={e => setSelectedModel(e.target.value)}
                            >
                                {models.map(m => <option key={m.id} value={m.id}>{m.name} ({m.size})</option>)}
                            </select>
                        </div>
                        <button
                            onClick={startDpoTraining}
                            disabled={dpoTraining || dpoCount < 20 || models.length === 0}
                            className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {dpoTraining ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Play className="w-4 h-4 fill-current" />
                            )}
                            {dpoTraining ? 'Training with preferences...' : 'Train with Preferences (DPO)'}
                        </button>
                        {dpoCount < 20 && (
                            <p className="text-[11px] text-gray-500 text-center">
                                Keep using the agent — every approve/reject captures a preference pair automatically.
                            </p>
                        )}
                    </div>

                    {/* File path */}
                    {dpoPath && (
                        <div className="text-[10px] text-gray-600 font-mono truncate px-1">
                            {dpoPath}
                        </div>
                    )}
                </div>
            </Card>
        </div>
    )
}
