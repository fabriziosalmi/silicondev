/** Injected by Vite at build time (see vite.config.ts define). */
declare const __APP_VERSION__: string

/** Type definitions for the Electron preload API exposed via contextBridge. */

interface ElectronAPI {
  ping: () => Promise<void>
  selectFile: () => Promise<string | null>
  selectDirectory: () => Promise<string | null>
  getBackendPort: () => Promise<number>
  getLogPath: () => Promise<string>
  getAuthToken: () => Promise<string>
  openPath: (path: string) => Promise<string>
  installUpdate: () => Promise<void>
  checkForUpdates: () => Promise<{ status: string; version?: string; message?: string }>
  onUpdateDownloaded: (callback: (version: string) => void) => (() => void) | void
  onUpdateStatus: (callback: (status: string, detail?: string) => void) => (() => void) | void
}

interface Window {
  electronAPI?: ElectronAPI
}
