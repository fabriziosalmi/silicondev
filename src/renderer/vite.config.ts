import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import path from 'path'
import pkg from '../../package.json'


// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  base: './', // Important for Electron to load assets from local file system
  css: {
    postcss: {
      plugins: [
        tailwindcss({ config: path.resolve(__dirname, 'tailwind.config.js') }),
        autoprefixer(),
      ],
    },
  },
  resolve: {
    alias: {
      // Force a single React instance — prevents "Cannot read properties of null (reading 'useState')"
      // when packages (e.g. @monaco-editor/react) resolve React from a parent node_modules.
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    // Raise limit: Monaco editor alone is ~2MB minified; splitting it is the right fix, not ignoring
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // React core — smallest possible chunk loaded first
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/scheduler/')) {
            return 'react-core'
          }
          // Monaco editor — single large chunk, lazy-loaded by CodeWorkspace
          if (id.includes('node_modules/monaco-editor') || id.includes('node_modules/@monaco-editor')) {
            return 'monaco'
          }
          // i18n
          if (id.includes('node_modules/i18next') || id.includes('node_modules/react-i18next')) {
            return 'i18n'
          }
          // Markdown / syntax
          if (
            id.includes('node_modules/react-markdown') ||
            id.includes('node_modules/remark') ||
            id.includes('node_modules/rehype') ||
            id.includes('node_modules/micromark') ||
            id.includes('node_modules/mdast') ||
            id.includes('node_modules/hast') ||
            id.includes('node_modules/unified') ||
            id.includes('node_modules/vfile')
          ) {
            return 'markdown'
          }
          // Lucide icons
          if (id.includes('node_modules/lucide-react')) {
            return 'icons'
          }
          // Everything else in node_modules → vendor
          if (id.includes('node_modules/')) {
            return 'vendor'
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // ── Dev proxy: routes API calls to the Silicon Studio backend ──────────
    // Fixes CORS errors when running in a browser (not Electron).
    // Backend uses SILICON_PORT env var (default 8001 when 8000 is in use).
    // In production Electron, window.electronAPI.getBackendPort() is used.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        ws: true, // needed for SSE chat streaming
      },
      '/health': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
      // ── HuggingFace proxy: avoids CSP + CORS when running in browser ──────
      // DiscoverTab fetches are rewritten from /hf-api/* → https://huggingface.co/*
      // In production Electron the fetch goes directly (no proxy needed).
      '/hf-api': {
        target: 'https://huggingface.co',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/hf-api/, ''),
        secure: true,
      },
    },
  }
})
