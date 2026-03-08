import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { Copy, Check, Wand2, Scale, Eye, GitFork, ShieldCheck, Loader2, RefreshCcw, ChevronRight, Expand, Shrink, Briefcase, MessageCircle, GraduationCap, Languages, User, Baby, FlaskConical, Feather } from 'lucide-react'
import type { SelfAssessment } from '../../api/client'
import { AssessmentPopover } from './AssessmentPopover'

function useClickOutside(ref: React.RefObject<HTMLElement | null>, isOpen: boolean, onClose: () => void) {
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isOpen, ref, onClose]);
}

const PERSPECTIVES = [
    { key: 'perspective_ceo', label: 'CEO', icon: <User className="w-3 h-3" /> },
    { key: 'perspective_child', label: 'ELI8', icon: <Baby className="w-3 h-3" /> },
    { key: 'perspective_scientist', label: 'Scientist', icon: <FlaskConical className="w-3 h-3" /> },
    { key: 'perspective_poet', label: 'Poet', icon: <Feather className="w-3 h-3" /> },
];

const TONE_ACTIONS = [
    { key: 'longer', label: 'Longer', icon: <Expand className="w-3 h-3" /> },
    { key: 'shorter', label: 'Shorter', icon: <Shrink className="w-3 h-3" /> },
    { key: 'formal', label: 'Formal', icon: <Briefcase className="w-3 h-3" /> },
    { key: 'casual', label: 'Casual', icon: <MessageCircle className="w-3 h-3" /> },
    { key: 'technical', label: 'Technical', icon: <GraduationCap className="w-3 h-3" /> },
    { key: 'translate', label: 'Translate', icon: <Languages className="w-3 h-3" /> },
];

export const ResponseActions = memo(function ResponseActions({
    content,
    idx,
    copiedIndex,
    stats,
    onAction,
    onCopy,
    showPrompt,
    fullPrompt,
    enabledActions,
    onBranch,
    assessment,
    onAssess,
    onSelfCritique,
    selfCritiqueLoading,
    disabled,
}: {
    content: string;
    idx: number;
    copiedIndex: number | null;
    stats?: { tokensPerSecond: number; timeToFirstToken: number; totalTokens: number };
    onAction: (response: string, action: string) => void;
    onCopy: (text: string, index: number) => void;
    showPrompt: boolean;
    fullPrompt: string;
    enabledActions?: Record<string, boolean>;
    onBranch?: () => void;
    assessment?: SelfAssessment | 'loading';
    onAssess?: () => void;
    onSelfCritique?: () => void;
    selfCritiqueLoading?: boolean;
    disabled?: boolean;
}) {
    const isOn = (key: string) => enabledActions?.[key] !== false;
    const [expandedRow, setExpandedRow] = useState<'tone' | 'perspective' | null>(null);
    const [showAssessment, setShowAssessment] = useState(false);
    const [promptDetailsOpen, setPromptDetailsOpen] = useState(false);
    const prevAssessmentRef = useRef(assessment);
    const assessRef = useRef<HTMLDivElement>(null);
    const actionsRef = useRef<HTMLDivElement>(null);

    // Auto-show panel when assessment finishes loading
    useEffect(() => {
        if (prevAssessmentRef.current === 'loading' && assessment && assessment !== 'loading') {
            setShowAssessment(true);
        }
        prevAssessmentRef.current = assessment;
    }, [assessment]);

    useClickOutside(assessRef, showAssessment, useCallback(() => setShowAssessment(false), []));
    useClickOutside(actionsRef, expandedRow !== null, useCallback(() => setExpandedRow(null), []));

    const enabledPerspectives = PERSPECTIVES.filter(p => isOn(p.key));
    const toneActions = TONE_ACTIONS.filter(a => isOn(a.key));

    const hasScores = assessment && assessment !== 'loading';
    const hasVisiblePanel =
        hasScores ||
        (showPrompt && promptDetailsOpen) ||
        expandedRow !== null;

    const toggleRow = (row: 'tone' | 'perspective') => {
        if (disabled) return;
        setExpandedRow(prev => prev === row ? null : row);
    };

    return (
        <div ref={actionsRef} className={`mt-2 transition-opacity ${hasVisiblePanel ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
            <div className="flex items-center gap-1">
                {/* Copy */}
                <button
                    type="button"
                    onClick={() => onCopy(content, idx)}
                    className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors"
                    aria-label="Copy response"
                    title="Copy"
                >
                    {copiedIndex === idx
                        ? <Check className="w-3.5 h-3.5 text-green-500" />
                        : <Copy className="w-3.5 h-3.5" />
                    }
                </button>
                {/* Tone & Rewrite toggle */}
                {toneActions.length > 0 && (
                    <button
                        type="button"
                        onClick={() => toggleRow('tone')}
                        disabled={disabled}
                        className={`p-1 rounded transition-colors ${disabled ? 'text-gray-700 cursor-not-allowed' : expandedRow === 'tone' ? 'text-blue-400 bg-blue-500/10' : 'text-gray-600 hover:text-gray-300 hover:bg-white/5'}`}
                        aria-label="Rewrite response"
                        title="Rewrite"
                    >
                        <Wand2 className="w-3.5 h-3.5" />
                    </button>
                )}
                {/* Devil's Advocate */}
                {isOn('devil') && (
                    <button
                        type="button"
                        onClick={() => onAction(content, 'devil')}
                        disabled={disabled}
                        className={`p-1 rounded transition-colors ${disabled ? 'text-gray-700 cursor-not-allowed' : 'text-gray-600 hover:text-orange-400 hover:bg-orange-500/5'}`}
                        aria-label="Devil's advocate"
                        title="Devil's Advocate"
                    >
                        <Scale className="w-3.5 h-3.5" />
                    </button>
                )}
                {/* Perspective Shift toggle */}
                {enabledPerspectives.length > 0 && (
                    <button
                        type="button"
                        onClick={() => toggleRow('perspective')}
                        disabled={disabled}
                        className={`p-1 rounded transition-colors ${disabled ? 'text-gray-700 cursor-not-allowed' : expandedRow === 'perspective' ? 'text-blue-400 bg-blue-500/10' : 'text-gray-600 hover:text-blue-400 hover:bg-blue-500/5'}`}
                        aria-label="Change perspective"
                        title="Perspective"
                    >
                        <Eye className="w-3.5 h-3.5" />
                    </button>
                )}
                {/* Branch */}
                {onBranch && (
                    <button
                        type="button"
                        onClick={onBranch}
                        disabled={disabled}
                        className={`p-1 rounded transition-colors ${disabled ? 'text-gray-700 cursor-not-allowed' : 'text-gray-600 hover:text-blue-400 hover:bg-blue-500/5'}`}
                        aria-label="Branch conversation"
                        title="Branch"
                    >
                        <GitFork className="w-3.5 h-3.5" />
                    </button>
                )}
                <div className="w-px h-3 bg-white/10 mx-0.5" />
                {/* Ethical self-assessment */}
                {onAssess && (
                    <div className="relative flex items-center" ref={assessRef}>
                        <button
                            type="button"
                            onClick={() => {
                                if (!assessment) onAssess();
                                else setShowAssessment(!showAssessment);
                            }}
                            className={`p-1 rounded transition-colors ${
                                assessment && assessment !== 'loading'
                                    ? 'text-emerald-400 hover:bg-emerald-500/10'
                                    : assessment === 'loading'
                                        ? 'text-gray-500 cursor-wait'
                                        : 'text-gray-600 hover:text-emerald-400 hover:bg-emerald-500/5'
                            }`}
                            aria-label={assessment === 'loading' ? 'Assessing response' : assessment ? 'View assessment' : 'Assess response'}
                            title={assessment === 'loading' ? 'Assessing...' : assessment ? 'Assessment' : 'Assess'}
                            disabled={assessment === 'loading'}
                        >
                            {assessment === 'loading'
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <ShieldCheck className="w-3.5 h-3.5" />
                            }
                        </button>
                        {/* Inline compact score */}
                        {assessment && assessment !== 'loading' && (() => {
                            const dims: (keyof SelfAssessment)[] = ['privacy', 'fairness', 'safety', 'transparency', 'ethics', 'reliability'];
                            const avg = Math.round(dims.reduce((s, k) => s + assessment[k], 0) / dims.length);
                            const color = avg >= 80 ? 'bg-emerald-500' : avg >= 60 ? 'bg-yellow-500' : avg >= 40 ? 'bg-orange-500' : 'bg-red-500';
                            const textColor = avg >= 80 ? 'text-emerald-400' : avg >= 60 ? 'text-yellow-400' : avg >= 40 ? 'text-orange-400' : 'text-red-400';
                            return (
                                <button
                                    type="button"
                                    onClick={() => setShowAssessment(!showAssessment)}
                                    className="flex items-center gap-1.5 ml-0.5 px-1 py-0.5 rounded hover:bg-white/5 transition-colors"
                                    aria-label={`Assessment score: ${avg}`}
                                    title="Details"
                                >
                                    <div className="w-12 h-1 bg-white/10 rounded-full overflow-hidden">
                                        <div className={`h-full rounded-full ${color}`} style={{ width: `${avg}%` }} />
                                    </div>
                                    <span className={`text-[10px] font-mono font-medium ${textColor}`}>{avg}</span>
                                </button>
                            );
                        })()}
                        {showAssessment && assessment && assessment !== 'loading' && (
                            <AssessmentPopover scores={assessment} />
                        )}
                    </div>
                )}
                {/* Self-Critique */}
                {onSelfCritique && isOn('selfCritique') && (
                    <button
                        type="button"
                        onClick={onSelfCritique}
                        disabled={disabled || selfCritiqueLoading}
                        className={`p-1 rounded transition-colors ${
                            selfCritiqueLoading
                                ? 'text-amber-400 cursor-wait'
                                : disabled
                                    ? 'text-gray-700 cursor-not-allowed'
                                    : 'text-gray-600 hover:text-amber-400 hover:bg-amber-500/5'
                        }`}
                        aria-label={selfCritiqueLoading ? 'Running self-critique' : 'Self-critique'}
                        title={selfCritiqueLoading ? 'Critiquing...' : 'Self-Critique'}
                    >
                        {selfCritiqueLoading
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <RefreshCcw className="w-3.5 h-3.5" />
                        }
                    </button>
                )}
                {/* Stats */}
                {stats && stats.totalTokens > 0 && (
                    <div className="flex items-center gap-2 ml-auto">
                        <span className="text-[10px] text-gray-600 font-mono tabular-nums">
                            {stats.tokensPerSecond} tok/s
                        </span>
                        <span className="text-[10px] text-gray-600 font-mono tabular-nums">
                            {stats.totalTokens} tok
                        </span>
                    </div>
                )}
            </div>

            {/* Inline expanded row: Tone actions */}
            {expandedRow === 'tone' && (
                <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    {toneActions.map(a => (
                        <button
                            type="button"
                            key={a.key}
                            onClick={() => { onAction(content, a.key); setExpandedRow(null); }}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] text-gray-400 hover:text-white bg-white/[0.03] hover:bg-white/[0.08] border border-white/5 transition-colors"
                        >
                            {a.icon}
                            {a.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Inline expanded row: Perspective actions */}
            {expandedRow === 'perspective' && (
                <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    {enabledPerspectives.map(p => (
                        <button
                            type="button"
                            key={p.key}
                            onClick={() => { onAction(content, p.key); setExpandedRow(null); }}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] text-gray-400 hover:text-white bg-white/[0.03] hover:bg-white/[0.08] border border-white/5 transition-colors"
                        >
                            {p.icon}
                            {p.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Show Prompt — what was actually sent */}
            {showPrompt && (
                <details className="mt-1.5" onToggle={(e) => setPromptDetailsOpen(e.currentTarget.open)}>
                    <summary className="flex items-center gap-1 cursor-pointer text-[10px] text-gray-600 hover:text-gray-400 transition-colors select-none list-none">
                        <ChevronRight className="w-2.5 h-2.5 chevron-rotate transition-transform" />
                        <span>View raw response</span>
                    </summary>
                    <div className="mt-1 pl-3 border-l border-white/5 text-[10px] text-gray-500 max-h-32 overflow-y-auto">
                        <pre className="whitespace-pre-wrap font-mono leading-relaxed">{fullPrompt}</pre>
                    </div>
                </details>
            )}
        </div>
    );
});
