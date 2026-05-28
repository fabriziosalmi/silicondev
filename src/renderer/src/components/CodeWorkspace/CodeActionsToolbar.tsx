import { useEffect, useState } from 'react'
import { BookOpen, Wrench, Sparkles, TestTube, Zap, ShieldCheck, Edit3, RotateCcw } from 'lucide-react'

interface CodeAction {
    id: string
    label: string
    title: string
    icon: typeof BookOpen
    prompt: string
}

const ACTIONS: CodeAction[] = [
    { id: 'explain', label: 'Explain', title: 'Explain what this code does', icon: BookOpen, prompt: 'explain this code:' },
    { id: 'fix', label: 'Fix', title: 'Find and fix bugs', icon: Wrench, prompt: 'fix this code:' },
    { id: 'refactor', label: 'Refactor', title: 'Restructure without changing behavior', icon: Sparkles, prompt: 'refactor this code:' },
    { id: 'tests', label: 'Tests', title: 'Write tests for this code', icon: TestTube, prompt: 'write tests for this code:' },
    { id: 'optimize', label: 'Optimize', title: 'Improve performance', icon: Zap, prompt: 'optimize this code:' },
    { id: 'review', label: 'Review', title: 'Review for bugs and improvements', icon: ShieldCheck, prompt: 'review this code for bugs, security issues, and improvements:' },
    { id: 'improve', label: 'Improve', title: 'Improve readability, naming, structure', icon: Edit3, prompt: 'improve this code (readability, naming, structure) keeping the same behavior:' },
    { id: 'rewrite', label: 'Rewrite', title: 'Rewrite keeping the same behavior', icon: RotateCcw, prompt: 'rewrite this code keeping the same behavior:' },
]

interface CodeActionsToolbarProps {
    fileName: string
    language: string
}

/**
 * Toolbar visible above the editor when a file is open. Each button dispatches
 * a `nanocore-action` event with a prompt; MonacoEditor picks selection if
 * present else the whole file, wraps it in a fenced block, and forwards it as
 * a `nanocore-prompt` to the agent panel.
 *
 * The "scope" badge listens to `nanocore-selection-change` so the user can see
 * at a glance whether the next click targets the selection or the whole file.
 */
export function CodeActionsToolbar({ fileName, language }: CodeActionsToolbarProps) {
    const [hasSelection, setHasSelection] = useState(false)
    const [selectionLines, setSelectionLines] = useState(0)

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { hasSelection: boolean; lines: number } | undefined
            if (!detail) return
            setHasSelection(detail.hasSelection)
            setSelectionLines(detail.lines)
        }
        window.addEventListener('nanocore-selection-change', handler)
        return () => window.removeEventListener('nanocore-selection-change', handler)
    }, [])

    // Reset badge whenever the active file changes
    useEffect(() => {
        setHasSelection(false)
        setSelectionLines(0)
    }, [fileName])

    const dispatchAction = (prompt: string) => {
        window.dispatchEvent(new CustomEvent('nanocore-action', { detail: { prompt } }))
    }

    return (
        <div className="shrink-0 flex items-center gap-1 px-2 py-1 bg-input-bg border-b border-outline-subtle overflow-x-auto">
            <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
                    hasSelection
                        ? 'bg-accent-muted text-accent'
                        : 'bg-hover text-foreground-subtle'
                }`}
                title={hasSelection ? `Acts on the ${selectionLines}-line selection` : 'Acts on the whole file — select code to scope an action'}
            >
                {hasSelection ? `selection · ${selectionLines}L` : `${language || 'file'}`}
            </span>
            <div className="w-px h-4 bg-outline-subtle shrink-0" />
            {ACTIONS.map((action) => {
                const Icon = action.icon
                return (
                    <button
                        key={action.id}
                        type="button"
                        onClick={() => dispatchAction(action.prompt)}
                        title={action.title}
                        className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-foreground-secondary hover:text-foreground hover:bg-hover rounded transition-colors shrink-0"
                    >
                        <Icon size={11} />
                        <span>{action.label}</span>
                    </button>
                )
            })}
        </div>
    )
}
