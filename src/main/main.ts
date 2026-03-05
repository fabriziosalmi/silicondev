import { app, BrowserWindow, screen, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import log from 'electron-log/main';
import { autoUpdater } from 'electron-updater';

// File logging: ~/Library/Logs/SiliconDev/main.log on macOS
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.file.format = '{y}-{m}-{d} {h}:{i}:{s} [{level}] {text}';

// Catch uncaught errors in the main process so they don't vanish silently
process.on('uncaughtException', (err) => {
    log.error('Uncaught exception in main process:', err);
    dialog.showErrorBox('Fatal Error', `${err.message}\n\nSee log for details: ${log.transports.file.getFile().path}`);
    app.exit(1);
});
process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection in main process:', reason);
});

// Prevent second instance — two backends on the same port would collide
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
}

let backendProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

// Dynamic port: resolved when backend prints SILICON_PORT=<port>
let backendPort = 8000;
let portResolve: ((port: number) => void) | null = null;
const portReady = new Promise<number>((resolve) => { portResolve = resolve; });

function startBackend() {
    const isDev = !app.isPackaged;
    let scriptPath: string;
    let command: string;
    let args: string[] = [];

    if (isDev) {
        // In development, handle virtual environments robustly
        scriptPath = path.join(__dirname, '../../backend/main.py');
        const venvPythonPath = path.join(__dirname, '../../backend/.venv/bin/python');

        // If we are already in an activated environment (conda or venv), use python directly.
        // Otherwise, attempt to run via the expected conda environment or local venv.
        if (process.env.VIRTUAL_ENV || process.env.CONDA_PREFIX || process.env.PYTHON_EXECUTABLE) {
            command = process.env.PYTHON_EXECUTABLE || 'python';
            args = [scriptPath];
        } else if (fs.existsSync(venvPythonPath)) {
            command = venvPythonPath;
            args = [scriptPath];
        } else {
            command = 'conda';
            args = ['run', '-n', 'silicon-studio', '--no-capture-output', 'python', scriptPath];
        }
        log.info('Starting backend in DEV mode:', command, args);
    } else {
        // In production, run the bundled executable
        // PyInstaller one-dir mode creates a directory 'silicon_server' containing the binary 'silicon_server'
        // electron-builder copied the full path 'backend/dist/silicon_server' to Resources
        const binaryName = 'silicon_server';
        scriptPath = path.join(process.resourcesPath, 'backend', 'dist', 'silicon_server', binaryName);
        command = scriptPath;
        log.info('Starting backend in PROD mode:', command);
    }

    try {
        backendProcess = spawn(command, args, {
            cwd: isDev ? path.join(__dirname, '../../backend') : path.join(process.resourcesPath, 'backend', 'dist', 'silicon_server'),
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, SILICON_PARENT_PID: String(process.pid) },
        });

        backendProcess.on('error', (err) => {
            log.error('Failed to spawn backend process:', err);
            dialog.showErrorBox('Backend Error', `Failed to start backend: ${err.message}\nPath: ${command}`);
        });

    } catch (e) {
        log.error('Exception spawning backend:', e);
        if (e instanceof Error) {
            dialog.showErrorBox('Backend Exception', `Exception starting backend: ${e.message}`);
        }
    }

    if (backendProcess && backendProcess.stdout) {
        backendProcess.stdout.on('data', (data) => {
            const text = data.toString();
            log.info(`[Backend]: ${text}`);
            const match = text.match(/SILICON_PORT=(\d+)/);
            if (match && portResolve) {
                backendPort = parseInt(match[1], 10);
                portResolve(backendPort);
                portResolve = null;
            }
        });
    }

    if (backendProcess && backendProcess.stderr) {
        backendProcess.stderr.on('data', (data) => {
            const text = data.toString();
            // macOS noise — not a real error
            if (text.includes('MallocStackLogging')) return;
            log.error(`[Backend Error]: ${text}`);
        });
    }

    if (backendProcess) {
        backendProcess.on('close', (code) => {
            log.info(`Backend process exited with code ${code}`);
            backendProcess = null;

            // If backend crashes during startup before port was resolved,
            // resolve with default so the renderer doesn't hang forever
            if (portResolve) {
                portResolve(8000);
                portResolve = null;
            }

            // Non-zero exit during app lifecycle = fatal
            if (code && code !== 0 && !isQuitting) {
                const logPath = log.transports.file.getFile().path;
                log.error(`Backend crashed with exit code ${code}`);
                dialog.showErrorBox(
                    'Backend Crashed',
                    `The Python backend exited with code ${code}.\n\nCheck logs at:\n${logPath}`
                );
            }
        });
    }
}

function stopBackend() {
    if (backendProcess) {
        log.info('Stopping backend process...');
        const proc = backendProcess;
        backendProcess = null;
        proc.kill('SIGTERM');
        setTimeout(() => {
            if (!proc.killed) {
                log.warn('Backend did not exit, sending SIGKILL...');
                proc.kill('SIGKILL');
            }
        }, 3000);
    }
}

function createWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    mainWindow = new BrowserWindow({
        width: Math.floor(width * 0.8),
        height: Math.floor(height * 0.9),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        titleBarStyle: 'hiddenInset', // Apple Native feel
        vibrancy: 'under-window',     // Apple Native blur
        visualEffectState: 'active',
        backgroundColor: '#00000000', // Transparent for vibrancy
    });

    // Load the Vite dev server URL in development, or the local index.html in production
    const isDev = !app.isPackaged;
    if (isDev) {
        const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
        mainWindow.loadURL(devServerUrl);
        // mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
        // In production, the file structure is:
        // dist/main/main.js (Current file)
        // dist/renderer/index.html
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }

    // macOS: hide window on close instead of destroying it (native behavior)
    if (process.platform === 'darwin') {
        mainWindow.on('close', (e) => {
            if (!isQuitting) {
                e.preventDefault();
                mainWindow?.hide();
            }
        });
    }
}

app.whenReady().then(() => {
    // Start the Python Backend
    startBackend();

    ipcMain.handle('dialog:openFile', async (event) => {
        if (!event.senderFrame) {
            log.warn('Blocked unauthorized dialog:openFile request');
            return null;
        }

        const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'CSV/JSONL', extensions: ['csv', 'jsonl', 'json'] }]
        });
        if (result.canceled) return null;
        return result.filePaths[0];
    });

    ipcMain.handle('dialog:openDirectory', async (event) => {
        if (!event.senderFrame) {
            log.warn('Blocked unauthorized dialog:openDirectory request');
            return null;
        }

        const result = await dialog.showOpenDialog({
            properties: ['openDirectory']
        });
        if (result.canceled) return null;
        return result.filePaths[0];
    });

    createWindow();

    // Port IPC: renderer asks which port the backend chose
    ipcMain.handle('get-backend-port', async () => {
        const timeout = new Promise<number>((_, reject) =>
            setTimeout(() => reject(new Error('Backend port timeout')), 30000)
        );
        try {
            return await Promise.race([portReady, timeout]);
        } catch {
            return 8000;
        }
    });

    // Log path IPC: renderer can show the log file location in Settings
    ipcMain.handle('get-log-path', () => {
        return log.transports.file.getFile().path;
    });

    // Open a filesystem path in Finder
    ipcMain.handle('open-path', (_event, dirPath: string) => {
        return shell.openPath(dirPath);
    });

    // Auto-updater: only in packaged builds
    if (app.isPackaged) {
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;

        autoUpdater.on('update-downloaded', (info) => {
            log.info('Update downloaded:', info.version);
            mainWindow?.webContents.send('update-downloaded', info.version);
        });

        autoUpdater.on('error', (err) => {
            log.error('Auto-updater error:', err);
        });

        autoUpdater.checkForUpdatesAndNotify();
    }

    ipcMain.handle('install-update', () => {
        autoUpdater.quitAndInstall();
    });

    app.on('activate', function () {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
        } else {
            createWindow();
        }
    });
});

app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
});

app.on('before-quit', () => {
    isQuitting = true;
});

app.on('will-quit', () => {
    stopBackend();
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});
