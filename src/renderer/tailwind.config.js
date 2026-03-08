import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('tailwindcss').Config} */
export default {
    content: [
        path.resolve(__dirname, 'index.html'),
        path.resolve(__dirname, 'src/**/*.{js,ts,jsx,tsx}'),
    ],
    theme: {
        extend: {
            colors: {
                // macOS Native-like system colors
                'sidebar-bg': 'var(--sidebar-bg)',
                'window-bg': 'var(--window-bg)',
                'accent': '#007AFF', // System Blue
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
