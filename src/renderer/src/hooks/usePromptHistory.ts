import { useState, useCallback, useRef } from 'react'

const STORAGE_KEY = 'silicon-studio-prompt-history'
const MAX_HISTORY = 50

function loadHistory(): string[] {
    try {
        const saved = localStorage.getItem(STORAGE_KEY)
        return saved ? JSON.parse(saved) : []
    } catch {
        return []
    }
}

function saveHistory(history: string[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)))
    } catch { /* quota exceeded — ignore */ }
}

/**
 * Hook for navigating prompt history with Up/Down arrow keys.
 *
 * Returns:
 * - `push(text)`: save a sent prompt to history
 * - `navigateUp(currentInput)`: go to older entry (returns new input value)
 * - `navigateDown()`: go to newer entry (returns new input value)
 * - `reset()`: reset navigation position (call when user types manually)
 */
export function usePromptHistory() {
    const [history, setHistory] = useState<string[]>(loadHistory)
    const indexRef = useRef(-1) // -1 = not navigating
    const draftRef = useRef('') // what user was typing before navigating

    const push = useCallback((text: string) => {
        const trimmed = text.trim()
        if (!trimmed) return
        setHistory(prev => {
            // Deduplicate: remove if already exists, prepend
            const filtered = prev.filter(h => h !== trimmed)
            const next = [trimmed, ...filtered].slice(0, MAX_HISTORY)
            saveHistory(next)
            return next
        })
        indexRef.current = -1
    }, [])

    const navigateUp = useCallback((currentInput: string): string | null => {
        const hist = loadHistory() // fresh read
        if (hist.length === 0) return null

        if (indexRef.current === -1) {
            // Save current input as draft
            draftRef.current = currentInput
        }

        const nextIndex = Math.min(indexRef.current + 1, hist.length - 1)
        if (nextIndex === indexRef.current && indexRef.current !== -1) return null // already at oldest
        indexRef.current = nextIndex
        return hist[nextIndex]
    }, [])

    const navigateDown = useCallback((): string | null => {
        if (indexRef.current <= -1) return null

        const nextIndex = indexRef.current - 1
        indexRef.current = nextIndex

        if (nextIndex < 0) {
            // Back to draft
            return draftRef.current
        }

        const hist = loadHistory()
        return hist[nextIndex] ?? draftRef.current
    }, [])

    const reset = useCallback(() => {
        indexRef.current = -1
    }, [])

    return { push, navigateUp, navigateDown, reset, history }
}
