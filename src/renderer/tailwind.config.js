/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
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
            },
            animation: {
                shimmer: 'shimmer 1.5s ease-in-out infinite',
            },
        },
    },
    plugins: [],
}
