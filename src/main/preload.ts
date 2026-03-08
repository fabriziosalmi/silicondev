import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    ping: () => ipcRenderer.invoke('ping'),
    selectFile: () => ipcRenderer.invoke('dialog:openFile'),
    selectDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    getBackendPort: () => ipcRenderer.invoke('get-backend-port'),
    getLogPath: () => ipcRenderer.invoke('get-log-path'),
    getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
    openPath: (path: string) => ipcRenderer.invoke('open-path', path),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    onUpdateDownloaded: (callback: (version: string) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, version: string) => callback(version);
        ipcRenderer.on('update-downloaded', handler);
        return () => ipcRenderer.removeListener('update-downloaded', handler);
    },
    onUpdateStatus: (callback: (status: string, detail?: string) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, status: string, detail?: string) => callback(status, detail);
        ipcRenderer.on('update-status', handler);
        return () => ipcRenderer.removeListener('update-status', handler);
    },
});
