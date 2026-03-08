import { useState, useEffect, useRef } from 'react'

/**
 * Rough token estimate for input text.
 * Uses the common heuristic: ~4 chars per token for English, ~3 for code.
 * Debounced to avoid excessive recalculation.
 */
export function useTokenEstimate(text: string, debounceMs = 150) {
    const [tokens, setTokens] = useState(0)
    const timerRef = useRef<ReturnType<typeof setTimeout>>()

    useEffect(() => {
        if (timerRef.current) clearTimeout(timerRef.current)

        timerRef.current = setTimeout(() => {
            if (!text.trim()) {
                setTokens(0)
                return
            }
            // Heuristic: split on whitespace and punctuation boundaries
            // More accurate than simple char/4 — handles code, URLs, etc.
            const words = text.split(/\s+/).filter(Boolean)
            let estimate = 0
            for (const word of words) {
                if (word.length <= 3) {
                    estimate += 1
                } else if (word.length <= 8) {
                    estimate += 1 + (word.match(/[^a-zA-Z0-9]/g)?.length ?? 0) * 0.5
                } else {
                    // Longer words (URLs, paths, camelCase) → more tokens
                    estimate += Math.ceil(word.length / 4)
                }
            }
            setTokens(Math.max(1, Math.round(estimate)))
        }, debounceMs)

        return () => { if (timerRef.current) clearTimeout(timerRef.current) }
    }, [text, debounceMs])

    return tokens
}
