import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Command, FileText, Trash2, Settings2, Plus, HelpCircle, BookOpen, Hash } from 'lucide-react'

// ── Types ──

export interface SlashCommand {
    name: string
    description: string
    icon: React.ReactNode
    action: string // identifier for the handler
}

export interface FileEntry {
    name: string
    path: string
    type: 'file' | 'dir'
}

interface InputOverlayProps {
    input: string
    cursorPosition: number
    visible: boolean
    onSelect: (value: string, type: 'command' | 'file') => void
    onClose: () => void
    files: FileEntry[]
    anchorRef: React.RefObject<HTMLElement | null>
}

// ── Slash commands registry ──

export const SLASH_COMMANDS: SlashCommand[] = [
    { name: '/help', description: 'Show available commands', icon: <HelpCircle className="w-3.5 h-3.5" />, action: 'help' },
    { name: '/clear', description: 'Clear conversation', icon: <Trash2 className="w-3.5 h-3.5" />, action: 'clear' },
    { name: '/new', description: 'New conversation', icon: <Plus className="w-3.5 h-3.5" />, action: 'new' },
    { name: '/system', description: 'Set system prompt', icon: <Settings2 className="w-3.5 h-3.5" />, action: 'system' },
    { name: '/model', description: 'Switch model', icon: <Command className="w-3.5 h-3.5" />, action: 'model' },
    { name: '/library', description: 'Open prompt library', icon: <BookOpen className="w-3.5 h-3.5" />, action: 'library' },
    { name: '/export', description: 'Export conversation', icon: <FileText className="w-3.5 h-3.5" />, action: 'export' },
    { name: '/tokens', description: 'Toggle token counter', icon: <Hash className="w-3.5 h-3.5" />, action: 'tokens' },
]

// ── Fuzzy match helper ──

function fuzzyMatch(query: string, text: string): boolean {
    const q = query.toLowerCase()
    const t = text.toLowerCase()
    if (t.includes(q)) return true
    // character-by-character fuzzy
    let qi = 0
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (t[ti] === q[qi]) qi++
    }
    return qi === q.length
}

function fuzzyScore(query: string, text: string): number {
    const q = query.toLowerCase()
    const t = text.toLowerCase()
    // exact prefix match → highest score
    if (t.startsWith(q)) return 100
    // contains → high score
    if (t.includes(q)) return 80
    // fuzzy → lower
    let qi = 0
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (t[ti] === q[qi]) qi++
    }
    return qi === q.length ? 50 : 0
}

// ── Parse trigger from input ──

export type OverlayTrigger =
    | { type: 'command'; query: string; startIndex: number }
    | { type: 'file'; query: string; startIndex: number }
    | null

export function detectTrigger(input: string, cursorPos: number): OverlayTrigger {
    // Look backwards from cursor to find trigger character
    const textBeforeCursor = input.slice(0, cursorPos)

    // Check for slash at start of input
    if (textBeforeCursor.startsWith('/')) {
        const query = textBeforeCursor.slice(1).split(/\s/)[0] // only first word
        // Only trigger if cursor is still in the first word
        if (!textBeforeCursor.includes(' ') || textBeforeCursor.indexOf(' ') >= cursorPos) {
            return { type: 'command', query, startIndex: 0 }
        }
    }

    // Check for @ mention (not at start, or at start)
    const atMatch = textBeforeCursor.match(/@([^\s@]*)$/)
    if (atMatch) {
        const query = atMatch[1]
        const startIndex = atMatch.index!
        return { type: 'file', query, startIndex }
    }

    return null
}

// ── Component ──

export function InputOverlay({ input, cursorPosition, visible, onSelect, onClose, files }: InputOverlayProps) {
    const { t } = useTranslation()
    const [selectedIndex, setSelectedIndex] = useState(0)
    const listRef = useRef<HTMLDivElement>(null)

    const trigger = useMemo(() => detectTrigger(input, cursorPosition), [input, cursorPosition])

    const items = useMemo(() => {
        if (!trigger) return []

        if (trigger.type === 'command') {
            const q = trigger.query
            if (!q) return SLASH_COMMANDS.map(c => ({ id: c.name, label: c.name, desc: c.description, icon: c.icon, type: 'command' as const, value: c.action }))
            return SLASH_COMMANDS
                .filter(c => fuzzyMatch(q, c.name.slice(1)))
                .sort((a, b) => fuzzyScore(trigger.query, b.name.slice(1)) - fuzzyScore(trigger.query, a.name.slice(1)))
                .map(c => ({ id: c.name, label: c.name, desc: c.description, icon: c.icon, type: 'command' as const, value: c.action }))
        }

        if (trigger.type === 'file') {
            const q = trigger.query
            if (!q) return files.slice(0, 12).map(f => ({ id: f.path, label: f.name, desc: f.path, icon: <FileText className="w-3.5 h-3.5" />, type: 'file' as const, value: f.path }))
            return files
                .filter(f => fuzzyMatch(q, f.name) || fuzzyMatch(q, f.path))
                .sort((a, b) => {
                    const sa = Math.max(fuzzyScore(q, a.name), fuzzyScore(q, a.path))
                    const sb = Math.max(fuzzyScore(q, b.name), fuzzyScore(q, b.path))
                    return sb - sa
                })
                .slice(0, 12)
                .map(f => ({ id: f.path, label: f.name, desc: f.path, icon: <FileText className="w-3.5 h-3.5" />, type: 'file' as const, value: f.path }))
        }

        return []
    }, [trigger, files])

    // Reset selection when items change
    useEffect(() => { setSelectedIndex(0) }, [items])

    // Scroll selected item into view
    useEffect(() => {
        if (listRef.current) {
            const el = listRef.current.children[selectedIndex] as HTMLElement
            el?.scrollIntoView({ block: 'nearest' })
        }
    }, [selectedIndex])

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (!visible || items.length === 0) return

        if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSelectedIndex(prev => (prev + 1) % items.length)
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSelectedIndex(prev => (prev - 1 + items.length) % items.length)
        } else if (e.key === 'Tab' || e.key === 'Enter') {
            if (items[selectedIndex]) {
                e.preventDefault()
                e.stopPropagation()
                onSelect(items[selectedIndex].value, items[selectedIndex].type)
            }
        } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
        }
    }, [visible, items, selectedIndex, onSelect, onClose])

    useEffect(() => {
        if (visible) {
            // Use capture to intercept before textarea's own handler
            document.addEventListener('keydown', handleKeyDown, true)
            return () => document.removeEventListener('keydown', handleKeyDown, true)
        }
    }, [visible, handleKeyDown])

    if (!visible || items.length === 0 || !trigger) return null

    return (
        <div
            className="absolute bottom-full left-0 right-0 mb-1 z-50"
            style={{ maxHeight: '240px' }}
        >
            <div className="bg-[#1a1a2e] border border-white/10 rounded-lg shadow-xl overflow-hidden">
                {/* Header */}
                <div className="px-3 py-1.5 text-[10px] text-gray-500 uppercase tracking-wider border-b border-white/5">
                    {trigger.type === 'command' ? t('chatInput.commands') : t('chatInput.files')}
                </div>
                {/* Items */}
                <div ref={listRef} className="overflow-y-auto max-h-[200px] py-1 scrollbar-thin">
                    {items.map((item, i) => (
                        <button
                            key={item.id}
                            type="button"
                            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${
                                i === selectedIndex
                                    ? 'bg-white/10 text-white'
                                    : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                            }`}
                            onMouseEnter={() => setSelectedIndex(i)}
                            onMouseDown={(e) => {
                                e.preventDefault() // prevent blur
                                onSelect(item.value, item.type)
                            }}
                        >
                            <span className="shrink-0 text-gray-500">{item.icon}</span>
                            <span className="text-sm font-medium truncate">{item.label}</span>
                            <span className="text-[11px] text-gray-600 truncate ml-auto">{item.desc}</span>
                        </button>
                    ))}
                </div>
                {/* Footer hint */}
                <div className="px-3 py-1 text-[10px] text-gray-600 border-t border-white/5 flex gap-3">
                    <span><kbd className="text-gray-500">↑↓</kbd> {t('chatInput.navigate')}</span>
                    <span><kbd className="text-gray-500">Tab</kbd> {t('chatInput.select')}</span>
                    <span><kbd className="text-gray-500">Esc</kbd> {t('chatInput.dismiss')}</span>
                </div>
            </div>
        </div>
    )
}
