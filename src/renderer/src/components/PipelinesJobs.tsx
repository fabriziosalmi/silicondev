import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from './ui/PageHeader'
import { Card } from './ui/Card'
import { Play, Plus, Trash2, Search, Save, ChevronDown, ChevronRight, Terminal, Bot, Filter, Clock, RotateCcw, X } from 'lucide-react'
import { apiClient } from '../api/client'
import type { AgentDefinition, AgentExecutionResult } from '../api/client'
import { useToast } from './ui/Toast'
import { useConfirm } from './ui/ConfirmDialog'

type NodeType = 'llm' | 'tool' | 'condition'

interface PipelineNode {
    id: string
    type: NodeType
    data: {
        label: string
        systemPrompt?: string
        command?: string
        keyword?: string
        ifTrue?: string
        ifFalse?: string
    }
}

const NODE_TYPE_META: Record<NodeType, { label: string; icon: typeof Bot; color: string }> = {
    llm: { label: 'LLM', icon: Bot, color: 'text-blue-400' },
    tool: { label: 'Shell', icon: Terminal, color: 'text-green-400' },
    condition: { label: 'Filter', icon: Filter, color: 'text-yellow-400' },
}

function makeNode(type: NodeType): PipelineNode {
    return {
        id: crypto.randomUUID(),
        type,
        data: {
            label: NODE_TYPE_META[type].label + ' Step',
            ...(type === 'llm' ? { systemPrompt: 'You are a helpful assistant.' } : {}),
            ...(type === 'tool' ? { command: '' } : {}),
            ...(type === 'condition' ? { keyword: '', ifTrue: '', ifFalse: '' } : {}),
        },
    }
}

export function PipelinesJobs() {
    const { t } = useTranslation()
    const [pipelines, setPipelines] = useState<AgentDefinition[]>([])
    const [active, setActive] = useState<AgentDefinition | null>(null)
    const [nodes, setNodes] = useState<PipelineNode[]>([])
    const [loading, setLoading] = useState(false)
    const [executing, setExecuting] = useState(false)
    const [pipelineInput, setPipelineInput] = useState('')
    const [lastResult, setLastResult] = useState<AgentExecutionResult | null>(null)
    const [expandedNode, setExpandedNode] = useState<string | null>(null)
    const [searchTerm, setSearchTerm] = useState('')
    const { toast } = useToast()
    const { confirm } = useConfirm()

    // ── Undo-delete state ─────────────────────────────────────────────
    const UNDO_SECONDS = 6
    const [deletedPipeline, setDeletedPipeline] = useState<{ agent: AgentDefinition; nodes: PipelineNode[] } | null>(null)
    const [undoCountdown, setUndoCountdown] = useState(0)
    const undoTimerRef = useRef<ReturnType<typeof setInterval>>(undefined)
    const undoDeadlineRef = useRef<ReturnType<typeof setTimeout>>(undefined)

    const clearUndoBanner = useCallback(() => {
        clearInterval(undoTimerRef.current)
        clearTimeout(undoDeadlineRef.current)
        setDeletedPipeline(null)
        setUndoCountdown(0)
    }, [])

    const handleUndo = useCallback(async () => {
        if (!deletedPipeline) return
        clearUndoBanner()
        try {
            const restored = await apiClient.agents.saveAgent(
                { ...deletedPipeline.agent, nodes: deletedPipeline.nodes as unknown as Record<string, unknown>[], edges: [] }
            )
            await fetchPipelines()
            setActive(restored)
            setNodes(deletedPipeline.nodes)
            toast(`"${restored.name}" restored`, 'success')
        } catch {
            toast('Undo failed — pipeline could not be restored', 'error')
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deletedPipeline, clearUndoBanner])

    // Cleanup undo timers on unmount
    useEffect(() => () => { clearInterval(undoTimerRef.current); clearTimeout(undoDeadlineRef.current) }, [])

    useEffect(() => { fetchPipelines() }, [])

    const fetchPipelines = async () => {
        setLoading(true)
        try {
            const data = await apiClient.agents.getAgents()
            setPipelines(data)
        } catch { /* ignore */ }
        finally { setLoading(false) }
    }

    const selectPipeline = (p: AgentDefinition) => {
        setActive(p)
        setNodes((p.nodes || []) as unknown as PipelineNode[])
        setLastResult(null)
    }

    const handleNew = () => {
        const newPipeline: AgentDefinition = { name: t('pipelines.new'), nodes: [], edges: [], config: {} }
        setActive(newPipeline)
        setNodes([])
        setLastResult(null)
    }

    const handleSave = async () => {
        if (!active) return
        try {
            const toSave = { ...active, nodes: nodes as unknown as Record<string, unknown>[], edges: [] }
            const saved = await apiClient.agents.saveAgent(toSave)
            setActive(saved)
            fetchPipelines()
            toast('Pipeline saved', 'success')
        } catch {
            toast('Failed to save pipeline', 'error')
        }
    }

    const handleDelete = async (id: string) => {
        // Capture snapshot BEFORE showing confirm so we always have the data
        const target = pipelines.find(p => p.id === id)
        const ok = await confirm({ message: t('pipelines.delete') + '?', destructive: true, confirmLabel: 'Delete' })
        if (!ok) return
        try {
            await apiClient.agents.deleteAgent(id)
            if (active?.id === id) { setActive(null); setNodes([]) }
            fetchPipelines()

            // Start undo window
            if (target) {
                clearUndoBanner()
                const snapshot = { agent: target, nodes: (target.nodes || []) as unknown as PipelineNode[] }
                setDeletedPipeline(snapshot)
                setUndoCountdown(UNDO_SECONDS)
                undoTimerRef.current = setInterval(() => {
                    setUndoCountdown(prev => {
                        if (prev <= 1) { clearInterval(undoTimerRef.current); return 0 }
                        return prev - 1
                    })
                }, 1000)
                undoDeadlineRef.current = setTimeout(clearUndoBanner, UNDO_SECONDS * 1000)
            }
        } catch {
            toast('Failed to delete', 'error')
        }
    }

    const handleExecute = async () => {
        if (!active?.id) return
        setExecuting(true)
        setLastResult(null)
        try {
            const result = await apiClient.agents.execute(active.id, pipelineInput || 'Test input')
            setLastResult(result)
            toast(`Done in ${result.execution_time?.toFixed(2)}s — ${result.status}`, result.status === 'success' ? 'success' : 'error')
        } catch {
            toast('Execution failed', 'error')
        } finally { setExecuting(false) }
    }

    const addNode = (type: NodeType) => {
        setNodes(prev => [...prev, makeNode(type)])
    }

    const removeNode = (id: string) => {
        setNodes(prev => prev.filter(n => n.id !== id))
    }

    const updateNode = (id: string, patch: Partial<PipelineNode['data']>) => {
        setNodes(prev => prev.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))
    }

    const moveNode = (idx: number, dir: -1 | 1) => {
        const newIdx = idx + dir
        if (newIdx < 0 || newIdx >= nodes.length) return
        setNodes(prev => {
            const copy = [...prev]
            ;[copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]]
            return copy
        })
    }

    const filtered = pipelines.filter(p =>
        searchTerm === '' || p.name.toLowerCase().includes(searchTerm.toLowerCase())
    )

    return (
        <div className="h-full flex flex-col text-white overflow-hidden pb-4">
            <PageHeader>
                <div className="flex items-center gap-3">
                    <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within:text-blue-400 transition-colors" />
                        <input type="text" placeholder="Search pipelines..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                            className="bg-black/40 border border-white/10 rounded-lg pl-9 pr-4 py-2 text-sm text-white outline-none focus:border-blue-500/50 w-64 transition-all" />
                    </div>
                    <button type="button" onClick={handleNew}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold transition-colors">
                        <Plus className="w-4 h-4" /> {t('pipelines.new')}
                    </button>
                    {active && (
                        <button type="button" onClick={handleSave}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold transition-colors">
                            <Save className="w-4 h-4" /> Save
                        </button>
                    )}
                </div>
            </PageHeader>

            {/* Undo-delete banner */}
            {deletedPipeline && (
                <div className="mx-0 mb-0 animate-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20 text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                            <Trash2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            <span className="text-amber-200 truncate">
                                <span className="font-semibold">"{deletedPipeline.agent.name}"</span> deleted
                            </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] font-mono text-amber-400/60 tabular-nums w-4 text-right">{undoCountdown}s</span>
                            <button
                                type="button"
                                onClick={handleUndo}
                                className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300 rounded-lg text-xs font-bold transition-colors"
                            >
                                <RotateCcw className="w-3 h-3" />
                                Undo
                            </button>
                            <button
                                type="button"
                                onClick={clearUndoBanner}
                                className="p-1 text-amber-400/40 hover:text-amber-300 transition-colors"
                                aria-label="Dismiss"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex-1 flex gap-6 overflow-hidden">
                {/* Sidebar — Pipeline List */}
                <div className="w-72 flex flex-col gap-4 overflow-hidden">
                    <Card className="flex-1 flex flex-col overflow-hidden bg-black/20 border-white/5">
                        <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
                            <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Pipelines</h3>
                            <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full font-bold">{pipelines.length}</span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3 space-y-2">
                            {filtered.map(p => (
                                <div
                                    key={p.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => selectPipeline(p)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPipeline(p) } }}
                                    className={`group w-full flex items-center justify-between p-3 rounded-xl border text-left cursor-pointer transition-all ${active?.id === p.id
                                        ? 'bg-blue-500/10 border-blue-500/40'
                                        : 'bg-elevated border-white/5 hover:border-white/20 hover:bg-white/[0.02]'}`}
                                >
                                    <div className="min-w-0">
                                        <div className="text-sm font-bold text-gray-200 truncate">{p.name}</div>
                                        <div className="text-[10px] text-gray-500 uppercase tracking-wide font-bold mt-0.5">
                                            {(p.nodes?.length || 0)} steps
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); if (p.id) handleDelete(p.id) }}
                                        aria-label={`Delete pipeline ${p.name}`}
                                        className="p-2 text-gray-600 hover:text-red-400 hover:bg-red-400/10 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                            {pipelines.length === 0 && !loading && (
                                <div className="p-8 text-center border-2 border-dashed border-white/5 rounded-2xl">
                                    <p className="text-gray-500 text-sm">{t('pipelines.noJobs')}</p>
                                </div>
                            )}
                        </div>
                    </Card>

                    {/* Add Step Buttons */}
                    {active && (
                        <Card className="p-4 bg-black/40 border-white/5">
                            <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">Add Step</h3>
                            <div className="space-y-2">
                                {(Object.entries(NODE_TYPE_META) as [NodeType, typeof NODE_TYPE_META[NodeType]][]).map(([type, meta]) => {
                                    const Icon = meta.icon
                                    return (
                                        <button key={type} type="button" onClick={() => addNode(type)}
                                            className="w-full flex items-center gap-3 p-2.5 bg-elevated border border-white/5 rounded-xl hover:bg-white/[0.05] transition-colors text-left">
                                            <div className="p-1.5 rounded-lg bg-black/40"><Icon className={`w-4 h-4 ${meta.color}`} /></div>
                                            <span className="text-[11px] font-bold text-gray-300">{meta.label}</span>
                                        </button>
                                    )
                                })}
                            </div>
                        </Card>
                    )}
                </div>

                {/* Main Area — Pipeline Editor */}
                <div className="flex-1 flex flex-col gap-4 overflow-hidden">
                    {active ? (
                        <>
                            {/* Pipeline Name */}
                            <Card className="px-5 py-3 bg-black/20 border-white/5 flex items-center gap-4">
                                <input value={active.name} onChange={(e) => setActive({ ...active, name: e.target.value })}
                                    className="bg-transparent text-lg font-bold text-white outline-none border-b border-transparent focus:border-blue-500/50 transition-colors flex-1" />
                            </Card>

                            {/* Steps */}
                            <div className="flex-1 overflow-y-auto space-y-2">
                                {nodes.length === 0 ? (
                                    <Card className="p-12 text-center bg-black/20 border-white/5 border-2 border-dashed">
                                        <p className="text-gray-500 text-sm">Add steps from the sidebar to build your pipeline.</p>
                                        <p className="text-gray-600 text-xs mt-1">Steps run sequentially — each step's output feeds into the next.</p>
                                    </Card>
                                ) : (
                                    nodes.map((node, idx) => {
                                        const meta = NODE_TYPE_META[node.type]
                                        const Icon = meta.icon
                                        const isExpanded = expandedNode === node.id
                                        return (
                                            <Card key={node.id} className="bg-black/20 border-white/5 overflow-hidden">
                                                <div className="flex items-center gap-3 px-4 py-3">
                                                    <div className="flex flex-col gap-0.5">
                                                        <button type="button" onClick={() => moveNode(idx, -1)} disabled={idx === 0}
                                                            className="text-gray-600 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-[10px]" aria-label="Move step up">▲</button>
                                                        <button type="button" onClick={() => moveNode(idx, 1)} disabled={idx === nodes.length - 1}
                                                            className="text-gray-600 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-[10px]" aria-label="Move step down">▼</button>
                                                    </div>
                                                    <span className="text-[10px] text-gray-600 font-bold w-5 text-right">{idx + 1}</span>
                                                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center bg-black/40 border border-white/5`}>
                                                        <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
                                                    </div>
                                                    <input value={node.data.label} onChange={(e) => updateNode(node.id, { label: e.target.value })}
                                                        className="bg-transparent text-sm font-semibold text-white outline-none border-b border-transparent focus:border-blue-500/50 transition-colors flex-1" />
                                                    <span className="text-[10px] text-gray-600 uppercase font-bold tracking-wide">{meta.label}</span>
                                                    <button type="button" onClick={() => setExpandedNode(isExpanded ? null : node.id)}
                                                        className="text-gray-500 hover:text-white transition-colors">
                                                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                    </button>
                                                    <button type="button" onClick={() => removeNode(node.id)}
                                                        className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all">
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                                {isExpanded && (
                                                    <div className="border-t border-white/5 px-4 py-3 bg-black/20 space-y-3">
                                                        {node.type === 'llm' && (
                                                            <div className="flex flex-col gap-1">
                                                                <label className="text-[10px] font-bold text-gray-500 uppercase">System Prompt</label>
                                                                <textarea value={node.data.systemPrompt || ''} onChange={(e) => updateNode(node.id, { systemPrompt: e.target.value })}
                                                                    rows={3} className="bg-black/40 border border-white/10 rounded px-3 py-2 text-xs text-white outline-none focus:border-blue-500 font-mono resize-y" />
                                                            </div>
                                                        )}
                                                        {node.type === 'tool' && (
                                                            <div className="flex flex-col gap-1">
                                                                <label className="text-[10px] font-bold text-gray-500 uppercase">Shell Command</label>
                                                                <input value={node.data.command || ''} onChange={(e) => updateNode(node.id, { command: e.target.value })}
                                                                    placeholder="echo $NODE_INPUT | wc -w" className="bg-black/40 border border-white/10 rounded px-3 py-2 text-xs text-white outline-none focus:border-blue-500 font-mono" />
                                                                <p className="text-[10px] text-gray-600">Previous step output is available as $NODE_INPUT</p>
                                                            </div>
                                                        )}
                                                        {node.type === 'condition' && (
                                                            <>
                                                                <div className="flex flex-col gap-1">
                                                                    <label className="text-[10px] font-bold text-gray-500 uppercase">Keyword Match</label>
                                                                    <input value={node.data.keyword || ''} onChange={(e) => updateNode(node.id, { keyword: e.target.value })}
                                                                        placeholder="error" className="bg-black/40 border border-white/10 rounded px-3 py-2 text-xs text-white outline-none focus:border-blue-500" />
                                                                </div>
                                                                <div className="grid grid-cols-2 gap-3">
                                                                    <div className="flex flex-col gap-1">
                                                                        <label className="text-[10px] font-bold text-gray-500 uppercase">If Found</label>
                                                                        <input value={node.data.ifTrue || ''} onChange={(e) => updateNode(node.id, { ifTrue: e.target.value })}
                                                                            className="bg-black/40 border border-white/10 rounded px-3 py-2 text-xs text-white outline-none focus:border-blue-500" />
                                                                    </div>
                                                                    <div className="flex flex-col gap-1">
                                                                        <label className="text-[10px] font-bold text-gray-500 uppercase">If Not Found</label>
                                                                        <input value={node.data.ifFalse || ''} onChange={(e) => updateNode(node.id, { ifFalse: e.target.value })}
                                                                            className="bg-black/40 border border-white/10 rounded px-3 py-2 text-xs text-white outline-none focus:border-blue-500" />
                                                                    </div>
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>
                                                )}
                                            </Card>
                                        )
                                    })
                                )}
                            </div>

                            {/* Run Bar */}
                            <Card className="px-5 py-3 bg-black/30 border-white/5 flex items-center gap-4">
                                <input type="text" placeholder="Pipeline input..." value={pipelineInput} onChange={(e) => setPipelineInput(e.target.value)}
                                    disabled={executing} className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50 flex-1 disabled:opacity-50 disabled:cursor-not-allowed" />
                                <button type="button" onClick={handleExecute} disabled={executing || !active.id || nodes.length === 0}
                                    className="flex items-center gap-2 px-5 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-bold transition-colors">
                                    {executing ? (
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        <Play className="w-4 h-4 fill-current" />
                                    )}
                                    {executing ? t('pipelines.running') + '...' : t('pipelines.run')}
                                </button>
                            </Card>

                            {/* Execution Results */}
                            {lastResult && (
                                <Card className="bg-black/20 border-white/5 p-4 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide flex items-center gap-2">
                                            <Clock size={12} />
                                            Last Run — {lastResult.execution_time?.toFixed(2)}s
                                        </h3>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${lastResult.status === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                            {lastResult.status}
                                        </span>
                                    </div>
                                    <div className="space-y-1">
                                        {lastResult.steps?.map((step, i) => (
                                            <div key={i} className="flex items-start gap-3 p-2 rounded-lg bg-black/20">
                                                <span className={`text-[10px] font-bold mt-0.5 ${step.status === 'completed' ? 'text-green-400' : 'text-red-400'}`}>
                                                    {step.status === 'completed' ? '✓' : '✗'}
                                                </span>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-xs text-gray-300 font-semibold">{step.node_name}</div>
                                                    <pre className="text-[10px] text-gray-500 mt-0.5 whitespace-pre-wrap break-all max-h-24 overflow-y-auto font-mono">
                                                        {step.output}
                                                    </pre>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </Card>
                            )}
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center space-y-4 opacity-40">
                                <div className="w-20 h-20 bg-white/5 rounded-3xl flex items-center justify-center mx-auto border border-white/10">
                                    <Play className="w-10 h-10 text-gray-500" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-gray-300">{t('pipelines.title')}</h3>
                                    <p className="text-sm text-gray-500">Select or create a pipeline to get started.</p>
                                    <p className="text-xs text-gray-600 mt-1">Chain LLM inference, shell commands, and filters into automated sequences.</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
