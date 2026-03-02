import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    ping: () => ipcRenderer.invoke('ping'),
    selectFile: () => ipcRenderer.invoke('dialog:openFile'),
    selectDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    getBackendPort: () => ipcRenderer.invoke('get-backend-port'),
    getLogPath: () => ipcRenderer.invoke('get-log-path'),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    onUpdateDownloaded: (callback: (version: string) => void) =>
        ipcRenderer.on('update-downloaded', (_event, version) => callback(version)),
});
