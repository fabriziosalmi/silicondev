/* eslint-disable react-refresh/only-export-components -- intentional: useTheme hook co-located with ThemeProvider (standard context pattern) */
import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ThemeChoice, ResolvedTheme, ThemeContextValue } from './types'

const STORAGE_KEY = 'silicon-studio-theme'
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

function readStoredTheme(): ThemeChoice {
    try {
        const v = localStorage.getItem(STORAGE_KEY)
        if (v === 'light' || v === 'dark' || v === 'system') return v
    } catch { /* ignore */ }
    return 'dark'
}

function systemPrefersDark(): boolean {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolve(choice: ThemeChoice): ResolvedTheme {
    if (choice === 'system') return systemPrefersDark() ? 'dark' : 'light'
    return choice
}

/**
 * Synchronously apply the theme to <html data-theme="..."> BEFORE React mounts.
 * Call this in main.tsx ahead of createRoot to prevent FOUC.
 */
export function applyInitialTheme(): void {
    const choice = readStoredTheme()
    const resolved = resolve(choice)
    document.documentElement.setAttribute('data-theme', resolved)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setThemeState] = useState<ThemeChoice>(() => readStoredTheme())
    const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolve(readStoredTheme()))

    // Apply data-theme on documentElement whenever resolved theme changes
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', resolvedTheme)
    }, [resolvedTheme])

    // Recompute resolvedTheme when the user choice changes
    useEffect(() => {
        setResolvedTheme(resolve(theme))
    }, [theme])

    // When choice is 'system', track OS-level changes live
    useEffect(() => {
        if (theme !== 'system') return
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
        const mql = window.matchMedia('(prefers-color-scheme: dark)')
        const handler = () => setResolvedTheme(mql.matches ? 'dark' : 'light')
        mql.addEventListener('change', handler)
        return () => mql.removeEventListener('change', handler)
    }, [theme])

    const setTheme = useCallback((next: ThemeChoice) => {
        try { localStorage.setItem(STORAGE_KEY, next) } catch { /* ignore */ }
        setThemeState(next)
    }, [])

    return (
        <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    )
}

export function useTheme(): ThemeContextValue {
    const ctx = useContext(ThemeContext)
    if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
    return ctx
}
