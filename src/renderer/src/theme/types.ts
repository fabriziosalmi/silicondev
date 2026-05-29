/**
 * Public theme types. Importable from `../theme` without dragging in the
 * full React context module — useful when a non-component file needs to
 * type a setting or a serialized value.
 */

export type ThemeChoice = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export interface ThemeContextValue {
    theme: ThemeChoice
    resolvedTheme: ResolvedTheme
    setTheme: (theme: ThemeChoice) => void
}
