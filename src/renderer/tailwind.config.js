import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('tailwindcss').Config} */
export default {
    content: [
        path.resolve(__dirname, 'index.html'),
        path.resolve(__dirname, 'src/**/*.{js,ts,jsx,tsx}'),
    ],
    // Theme is driven by [data-theme] attribute, not the default `class` strategy.
    // ThemeContext sets data-theme="dark" | "light" on documentElement.
    darkMode: ['selector', '[data-theme="dark"]'],
    theme: {
        extend: {
            colors: {
                // ── Surfaces (depth hierarchy) ────────────────────────────
                background: 'var(--bg-base)',     // app shell
                surface: 'var(--bg-surface)',     // inline panels
                window: 'var(--bg-window)',       // main content area
                elevated: 'var(--bg-elevated)',   // cards, dropdowns
                overlay: 'var(--bg-overlay)',     // modals, command palette
                sidebar: 'var(--bg-sidebar)',     // sidebar
                titlebar: 'var(--bg-titlebar)',   // top bar
                'input-bg': 'var(--bg-input)',    // form inputs
                hover: 'var(--bg-hover)',         // hover state overlay
                active: 'var(--bg-active)',       // active/pressed state overlay

                // ── Foreground (text + icons) ─────────────────────────────
                foreground: 'var(--text-primary)',
                'foreground-secondary': 'var(--text-secondary)',
                'foreground-muted': 'var(--text-muted)',
                'foreground-subtle': 'var(--text-subtle)',
                'foreground-disabled': 'var(--text-disabled)',

                // ── Borders / outlines ────────────────────────────────────
                outline: 'var(--border-default)',
                'outline-subtle': 'var(--border-subtle)',
                'outline-strong': 'var(--border-strong)',

                // ── Brand / accent ────────────────────────────────────────
                accent: 'var(--accent)',
                'accent-hover': 'var(--accent-hover)',
                'accent-muted': 'var(--accent-muted)',
                'accent-foreground': 'var(--accent-foreground)',

                // ── Status ────────────────────────────────────────────────
                success: 'var(--success)',
                'success-muted': 'var(--success-muted)',
                danger: 'var(--danger)',
                'danger-muted': 'var(--danger-muted)',
                warn: 'var(--warn)',
                'warn-muted': 'var(--warn-muted)',
                info: 'var(--info)',
                'info-muted': 'var(--info-muted)',

                // ── Legacy aliases (deprecated, will be removed) ──────────
                'sidebar-bg': 'var(--bg-sidebar)',
                'window-bg': 'var(--bg-window)',
            },
            zIndex: {
                base: 'var(--z-base)',
                sticky: 'var(--z-sticky)',
                nav: 'var(--z-nav)',
                dropdown: 'var(--z-dropdown)',
                overlay: 'var(--z-overlay)',
                modal: 'var(--z-modal)',
                toast: 'var(--z-toast)',
            },
            keyframes: {
                shimmer: {
                    '0%': { transform: 'translateX(-100%)' },
                    '100%': { transform: 'translateX(200%)' },
                },
                metallic: {
                    '0%, 60%': { transform: 'translateX(-130%)', opacity: '0' },
                    '65%': { opacity: '1' },
                    '75%': { transform: 'translateX(130%)', opacity: '0' },
                    '100%': { opacity: '0' },
                },
            },
            animation: {
                shimmer: 'shimmer 1.5s ease-in-out infinite',
                metallic: 'metallic 4s linear infinite',
            },
        },
    },
    plugins: [],
}
