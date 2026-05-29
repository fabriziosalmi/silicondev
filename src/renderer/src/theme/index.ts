/**
 * Public surface of the theme module.
 *
 * The CSS tokens live in `./tokens.css` and are imported once from the
 * top-level `index.css`. Everything React-facing is re-exported here so
 * call sites can `import { useTheme } from '../theme'` instead of
 * reaching into `./context`.
 */

export { ThemeProvider, useTheme, applyInitialTheme } from './context'
export type { ThemeChoice, ResolvedTheme, ThemeContextValue } from './types'
