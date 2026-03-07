import { useState } from 'react'
import { X, FileEdit, FilePlus, Trash2, Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight, Play } from 'lucide-react'
import type { PlanProposalMetadata, PlanStep } from './types'

interface PlanCardProps {
    meta: PlanProposalMetadata
    onApprove: (sessionId: string) => void
    onReject: (sessionId: string) => void
}

const ACTION_ICON = {
    modify: FileEdit,
    create: FilePlus,
    delete: Trash2,
} as const

const ACTION_COLOR = {
    modify: 'text-blue-400',
    create: 'text-green-400',
    delete: 'text-red-400',
} as const

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
    pending: { label: 'Pending', color: 'text-amber-400 bg-amber-500/10' },
    running: { label: 'Running', color: 'text-blue-400 bg-blue-500/10' },
    approved: { label: 'Done', color: 'text-green-400 bg-green-500/10' },
    rejected: { label: 'Skipped', color: 'text-gray-500 bg-white/5' },
    error: { label: 'Error', color: 'text-red-400 bg-red-500/10' },
}

function StepRow({ step, index }: { step: PlanStep; index: number }) {
    const Icon = ACTION_ICON[step.action] || FileEdit
    const color = ACTION_COLOR[step.action] || 'text-gray-400'
    const statusInfo = STATUS_BADGE[step.status || 'pending']
    const isRunning = step.status === 'running'

    return (
        <div className={`flex items-start gap-2.5 px-3 py-2 rounded-lg transition-colors ${
            isRunning ? 'bg-blue-500/5 border border-blue-500/10' : 'bg-white/[0.02]'
        }`}>
            <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                <span className="text-[10px] text-gray-600 font-mono w-4 text-right">{index + 1}</span>
                {isRunning ? (
                    <Loader2 size={13} className="text-blue-400 animate-spin" />
                ) : (
                    <Icon size={13} className={color} />
                )}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-gray-200 truncate">{step.file}</span>
                    <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${statusInfo.color}`}>
                        {statusInfo.label}
                    </span>
                </div>
                <p className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">{step.description}</p>
            </div>
        </div>
    )
}

export function PlanCard({ meta, onApprove, onReject }: PlanCardProps) {
    const [expanded, setExpanded] = useState(true)
    const isPending = meta.status === 'pending'
    const isExecuting = meta.status === 'executing'
    const isDone = meta.status === 'done'
    const isRejected = meta.status === 'rejected'

    const completedSteps = meta.steps.filter(s => s.status === 'approved').length
    const totalSteps = meta.steps.length

    return (
        <div className={`rounded-xl border overflow-hidden transition-colors ${
            isPending ? 'border-amber-500/20 bg-amber-500/[0.03]' :
            isExecuting ? 'border-blue-500/20 bg-blue-500/[0.03]' :
            isDone ? 'border-green-500/20 bg-green-500/[0.03]' :
            isRejected ? 'border-white/10 bg-white/[0.02]' :
            'border-white/10 bg-white/[0.02]'
        }`}>
            {/* Header */}
            <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.02] transition-colors"
            >
                <div className="flex items-center gap-2">
                    {expanded ? <ChevronDown size={12} className="text-gray-500" /> : <ChevronRight size={12} className="text-gray-500" />}
                    <span className="text-xs font-semibold text-gray-200">
                        Execution Plan
                    </span>
                    <span className="text-[10px] text-gray-500 font-mono">
                        {totalSteps} step{totalSteps > 1 ? 's' : ''}
                    </span>
                    {isExecuting && (
                        <span className="text-[9px] text-blue-400 font-medium">
                            {completedSteps}/{totalSteps}
                        </span>
                    )}
                    {isDone && (
                        <CheckCircle2 size={12} className="text-green-400" />
                    )}
                    {isRejected && (
                        <XCircle size={12} className="text-gray-500" />
                    )}
                </div>
                <span className="text-[9px] text-gray-600 font-mono">
                    {meta.planTokens} tok
                </span>
            </button>

            {/* Steps list */}
            {expanded && (
                <div className="px-3 pb-3 space-y-1">
                    {meta.steps.map((step, i) => (
                        <StepRow key={i} step={step} index={i} />
                    ))}
                </div>
            )}

            {/* Approval buttons — only when pending */}
            {isPending && (
                <div className="flex items-center gap-2 px-4 py-2.5 border-t border-white/5 bg-black/20">
                    <button
                        type="button"
                        onClick={() => onApprove(meta.sessionId)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/20 hover:bg-green-500/30 text-green-400 text-xs font-medium rounded-lg transition-colors"
                    >
                        <Play size={11} />
                        Execute Plan
                    </button>
                    <button
                        type="button"
                        onClick={() => onReject(meta.sessionId)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-gray-400 text-xs font-medium rounded-lg transition-colors"
                    >
                        <X size={11} />
                        Reject
                    </button>
                    <span className="text-[9px] text-gray-600 ml-auto">
                        Review the plan above, then approve to execute
                    </span>
                </div>
            )}
        </div>
    )
}
