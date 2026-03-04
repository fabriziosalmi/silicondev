/** Type definitions for the Electron preload API exposed via contextBridge. */

interface ElectronAPI {
  ping: () => Promise<void>
  selectFile: () => Promise<string | undefined>
  selectDirectory: () => Promise<string | undefined>
  getBackendPort: () => Promise<number>
  getLogPath: () => Promise<string>
  openPath: (path: string) => Promise<void>
  installUpdate: () => Promise<void>
  onUpdateDownloaded: (callback: (version: string) => void) => void
}

interface Window {
  electronAPI?: ElectronAPI
}
