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
        { keys: ['Escape'], desc: 'Cancel / close' },
        { keys: ['Cmd', 'K'], desc: 'New conversation' },
        { keys: ['Cmd', '/'], desc: 'Show this keyboard shortcuts panel' },
    ]},
    { section: 'Model', items: [
        { keys: ['/model'], desc: 'Switch active model (slash command)' },
        { keys: ['/clear'], desc: 'Clear conversation' },
        { keys: ['/help'], desc: 'Show slash commands' },
        { keys: ['Cmd', 'click model chip'], desc: 'Open model picker' },
    ]},
    { section: 'Navigation', items: [
        { keys: ['1–9'], desc: 'Jump to tab (in nav sidebar)' },
        { keys: ['Tab'], desc: 'Move focus between interactive elements' },
    ]},
    { section: 'Terminal', items: [
        { keys: ['Ctrl', 'L'], desc: 'Clear terminal history' },
        { keys: ['Ctrl', 'C'], desc: 'Stop running command' },
        { keys: ['↑', '↓'], desc: 'History navigation' },
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
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
        >
            <div className="w-full max-w-2xl bg-[#0f0f0f] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
                    <div className="flex items-center gap-2.5">
                        <Keyboard size={15} className="text-blue-400" />
                        <span className="text-sm font-semibold text-white">Keyboard Shortcuts</span>
                        <kbd className="text-[10px] text-gray-500 bg-white/5 px-1.5 py-0.5 rounded font-mono">⌘ /</kbd>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-gray-500 hover:text-white transition-colors p-1"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Shortcuts grid */}
                <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {SHORTCUTS.map(section => (
                        <div key={section.section}>
                            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-3">
                                {section.section}
                            </div>
                            <div className="space-y-2">
                                {section.items.map(item => (
                                    <div key={item.desc} className="flex items-center justify-between gap-4">
                                        <span className="text-[12px] text-gray-400">{item.desc}</span>
                                        <div className="flex items-center gap-1 shrink-0">
                                            {item.keys.map((k, i) => (
                                                <span key={i} className="flex items-center gap-1">
                                                    {i > 0 && <span className="text-gray-700 text-[10px]">+</span>}
                                                    <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/10 text-[10px] font-mono text-gray-300">
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

                <div className="px-5 py-3 border-t border-white/[0.04] text-[10px] text-gray-600 shrink-0">
                    Press <kbd className="px-1 py-0.5 rounded bg-white/5 border border-white/10 font-mono">Esc</kbd> to close
                </div>
            </div>
        </div>
    )
}
