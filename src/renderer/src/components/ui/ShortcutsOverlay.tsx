import { useEffect } from 'react'
import { X, Keyboard } from 'lucide-react'

interface ShortcutsOverlayProps {
    onClose: () => void
}

const SHORTCUTS = [
    { section: 'Chat', items: [
        { keys: ['Enter'], desc: 'Send message' },
        { keys: ['Shift', 'Enter'], desc: 'New line in message' },
        { keys: ['↑'], desc: 'Edit last user message' },
        { keys: ['Escape'], desc: 'Cancel / close dialog' },
    ]},
    { section: 'Model', items: [
        { keys: ['click model chip'], desc: 'Open model picker' },
        { keys: ['/model'], desc: 'Switch active model (slash command)' },
        { keys: ['/clear'], desc: 'Clear conversation' },
        { keys: ['/help'], desc: 'Show all slash commands' },
    ]},
    { section: 'Navigation', items: [
        { keys: ['Cmd', 'K'], desc: 'Jump to Chat tab' },
        { keys: ['Cmd', 'N'], desc: 'New conversation' },
        { keys: ['Cmd', 'B'], desc: 'Toggle sidebar' },
        { keys: ['Cmd', 'E'], desc: 'Code workspace' },
        { keys: ['Cmd', ','], desc: 'Settings' },
        { keys: ['Cmd', '/'], desc: 'This shortcuts panel' },
        { keys: ['Alt', 'Shift', 'P'], desc: 'Command palette' },
        { keys: ['Alt', 'Shift', 'K'], desc: 'Knowledge map' },
        { keys: ['Cmd', 'Shift', 'N'], desc: 'Quick capture (new note overlay)' },
        { keys: ['Tab'], desc: 'Move focus between elements' },
    ]},
    { section: 'Terminal', items: [
        { keys: ['Ctrl', 'L'], desc: 'Clear terminal history' },
        { keys: ['Ctrl', 'C'], desc: 'Stop running command' },
        { keys: ['↑', '↓'], desc: 'Command history navigation' },
    ]},
]

export function ShortcutsOverlay({ onClose }: ShortcutsOverlayProps) {
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [onClose])

    return (
        <div
            className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
        >
            <div className="w-full max-w-2xl bg-overlay border border-outline rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-outline-subtle shrink-0">
                    <div className="flex items-center gap-2.5">
                        <Keyboard size={15} className="text-accent" />
                        <span className="text-sm font-semibold text-foreground">Keyboard Shortcuts</span>
                        <kbd className="text-[10px] text-foreground-muted bg-hover px-1.5 py-0.5 rounded font-mono">⌘ /</kbd>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close shortcuts panel"
                        className="text-foreground-muted hover:text-foreground transition-colors p-1"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Shortcuts grid */}
                <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {SHORTCUTS.map(section => (
                        <div key={section.section}>
                            <div className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-3">
                                {section.section}
                            </div>
                            <div className="space-y-2">
                                {section.items.map(item => (
                                    <div key={item.desc} className="flex items-center justify-between gap-4">
                                        <span className="text-[12px] text-foreground-muted">{item.desc}</span>
                                        <div className="flex items-center gap-1 shrink-0">
                                            {item.keys.map((k, i) => (
                                                <span key={i} className="flex items-center gap-1">
                                                    {i > 0 && <span className="text-foreground-subtle text-[10px]">+</span>}
                                                    <kbd className="px-1.5 py-0.5 rounded bg-hover border border-outline text-[10px] font-mono text-foreground-secondary">
                                                        {k}
                                                    </kbd>
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="px-5 py-3 border-t border-outline-subtle text-[10px] text-foreground-subtle shrink-0">
                    Press <kbd className="px-1 py-0.5 rounded bg-hover border border-outline font-mono">Esc</kbd> to close
                </div>
            </div>
        </div>
    )
}
