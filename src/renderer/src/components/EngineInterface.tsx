import { useState, useEffect } from 'react'
import { apiClient } from '../api/client'
import type { ModelEntry } from '../api/client'
import { Settings2, GitCompare } from 'lucide-react'
import { LoraTab } from './engine/LoraTab'
import { DpoTab } from './engine/DpoTab'

export function EngineInterface() {
    const [models, setModels] = useState<ModelEntry[]>([])
    const [selectedModel, setSelectedModel] = useState('')
    const [activeTab, setActiveTab] = useState<'lora' | 'dpo'>('lora')
    const [capturedCount, setCapturedCount] = useState(0)
    const [dpoCount, setDpoCount] = useState(0)
    const [dpoPath, setDpoPath] = useState('')

    useEffect(() => {
        apiClient.engine.getModels().then((data) => {
            const downloaded = data.filter(m => m.downloaded && !m.is_finetuned)
            setModels(downloaded)
            if (downloaded.length) setSelectedModel(downloaded[0].id)
        }).catch(err => console.error('Failed to load models:', err))
    }, [])

    useEffect(() => {
        apiClient.terminal.datasetStatus().then(s => setCapturedCount(s.count)).catch(() => {})
        apiClient.terminal.dpoStatus().then(s => { setDpoCount(s.count); setDpoPath(s.path) }).catch(() => {})
    }, [])

    return (
        <div className="h-full flex flex-col space-y-4 text-white overflow-hidden pb-4">

            {/* Tab Bar */}
            <div className="flex gap-1 shrink-0">
                <button
                    onClick={() => setActiveTab('lora')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'lora' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'text-foreground-muted hover:text-foreground-secondary hover:bg-hover'}`}
                >
                    <Settings2 size={14} /> LoRA / QLoRA
                </button>
                <button
                    onClick={() => { setActiveTab('dpo'); apiClient.terminal.dpoStatus().then(s => { setDpoCount(s.count); setDpoPath(s.path) }).catch(() => {}) }}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'dpo' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 'text-foreground-muted hover:text-foreground-secondary hover:bg-hover'}`}
                >
                    <GitCompare size={14} /> Preference Training (DPO)
                    {dpoCount > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-400 text-[10px] font-bold">{dpoCount}</span>}
                </button>
            </div>

            {activeTab === 'dpo' ? (
                <DpoTab
                    models={models}
                    selectedModel={selectedModel}
                    setSelectedModel={setSelectedModel}
                    capturedCount={capturedCount}
                    dpoCount={dpoCount}
                    dpoPath={dpoPath}
                />
            ) : (
                <LoraTab
                    models={models}
                    selectedModel={selectedModel}
                    setSelectedModel={setSelectedModel}
                    capturedCount={capturedCount}
                    setCapturedCount={setCapturedCount}
                />
            )}
        </div>
    )
}
