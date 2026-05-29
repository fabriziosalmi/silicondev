import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Server, Copy, Check, Globe, ChevronRight, Terminal } from 'lucide-react'
import { ToggleSwitch } from './ui/ToggleSwitch'
import { useGlobalState } from '../context/GlobalState'
import { apiClient, cleanModelName } from '../api/client'

interface LogEntry {
    timestamp: number
    source: string
    message: string
}

export function Deployment() {
    const { t } = useTranslation()
    const { activeModel } = useGlobalState()
    const [serverRunning, setServerRunning] = useState(false)
    const [host, setHost] = useState('127.0.0.1')
    const [port, setPort] = useState('8080')
    const [errorMsg, setErrorMsg] = useState('')
    const [loading, setLoading] = useState(false)
    const [uptime, setUptime] = useState<number | null>(null)
    const [pid, setPid] = useState<number | null>(null)

    // Logs
    const [logs, setLogs] = useState<LogEntry[]>([])
    const [logSince, setLogSince] = useState(0)
    const logEndRef = useRef<HTMLDivElement>(null)
    const [autoScroll, setAutoScroll] = useState(true)

    // Copy state per snippet
    const [copiedId, setCopiedId] = useState<string | null>(null)

    // Collapsible snippets
    const [showSnippets, setShowSnippets] = useState(false)

    // Poll server status. Skipped when the document tab is hidden so we
    // don't burn cycles fetching state nobody is looking at.
    useEffect(() => {
        const checkStatus = async () => {
            if (document.visibilityState !== 'visible') return
            try {
                const status = await apiClient.deployment.getStatus()
                setServerRunning(status.running)
                setUptime(status.uptime_seconds ?? null)
                setPid(status.pid ?? null)
            } catch {
                // status check failed silently
            }
        }
        checkStatus()
        // 3s ± 500ms jitter so multiple Silicon Studio windows don't all
        // fire on the same wall-clock tick.
        const interval = setInterval(checkStatus, 3000 + Math.floor(Math.random() * 500))
        const onVisibility = () => { if (document.visibilityState === 'visible') checkStatus() }
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
            clearInterval(interval)
            document.removeEventListener('visibilitychange', onVisibility)
        }
    }, [])

    // Poll logs when server is running. Same visibility guard.
    const logSinceRef = useRef(logSince)
    logSinceRef.current = logSince
    useEffect(() => {
        if (!serverRunning) return
        const fetchLogs = async () => {
            if (document.visibilityState !== 'visible') return
            try {
                const data = await apiClient.deployment.getLogs(logSinceRef.current)
                if (data.logs.length > 0) {
                    setLogs(prev => {
                        const merged = [...prev, ...data.logs];
                        return merged.length > 500 ? merged.slice(-500) : merged;
                    })
                    setLogSince(data.logs[data.logs.length - 1].timestamp)
                }
            } catch {
                // ignore log fetch errors
            }
        }
        fetchLogs()
        const interval = setInterval(fetchLogs, 1500 + Math.floor(Math.random() * 250))
        const onVisibility = () => { if (document.visibilityState === 'visible') fetchLogs() }
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
            clearInterval(interval)
            document.removeEventListener('visibilitychange', onVisibility)
        }
    }, [serverRunning])

    // Auto-scroll logs
    useEffect(() => {
        if (autoScroll) {
            logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        }
    }, [logs, autoScroll])

    const handleCopy = (text: string, id: string) => {
        navigator.clipboard.writeText(text)
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
    }

    const toggleServer = async () => {
        setErrorMsg('')
        if (serverRunning) {
            setLoading(true)
            try {
                await apiClient.deployment.stop()
                setServerRunning(false)
                setPid(null)
            } catch (e: unknown) {
                setErrorMsg(e instanceof Error ? e.message : String(e))
            } finally {
                setLoading(false)
            }
        } else {
            if (!activeModel) {
                setErrorMsg("No active model loaded. Select a model in the Models tab first.")
                return
            }
            if (!activeModel.path) {
                setErrorMsg("Active model does not have a valid local path.")
                return
            }

            setLoading(true)
            setLogs([])
            setLogSince(0)
            try {
                await apiClient.deployment.start(activeModel.path, host, parseInt(port))
                setServerRunning(true)
            } catch (e: unknown) {
                setErrorMsg(e instanceof Error ? e.message : String(e))
            } finally {
                setLoading(false)
            }
        }
    }

    const formatUptime = (s: number) => {
        const h = Math.floor(s / 3600)
        const m = Math.floor((s % 3600) / 60)
        const sec = s % 60
        if (h > 0) return `${h}h ${m}m ${sec}s`
        if (m > 0) return `${m}m ${sec}s`
        return `${sec}s`
    }

    const formatLogTime = (ts: number) => {
        const d = new Date(ts * 1000)
        return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }

    const endpoint = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`

    const curlSnippet = `curl ${endpoint}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "local-model",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'`

    const pythonSnippet = `from openai import OpenAI

client = OpenAI(
    base_url="${endpoint}/v1",
    api_key="not-needed"
)

response = client.chat.completions.create(
    model="local-model",
    messages=[
        {"role": "user", "content": "Write a haiku about local AI."}
    ]
)

print(response.choices[0].message.content)`

    return (
        <div className="h-full flex flex-col text-white overflow-hidden pb-4">

            <div className="flex-1 flex flex-col overflow-hidden min-h-0 gap-4">

                {/* Top bar: controls + config */}
                <div className="shrink-0 flex flex-col gap-3 px-1">

                    {/* Server control row */}
                    <div className="flex items-center gap-4">
                        <button
                            type="button"
                            onClick={toggleServer}
                            disabled={loading}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${serverRunning
                                ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20'
                                : 'bg-blue-600 hover:bg-blue-500 text-white'
                                }`}
                        >
                            {loading ? (
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <Server className="w-4 h-4" />
                            )}
                            {serverRunning ? t('deployment.stop') : t('deployment.start')}
                        </button>

                        <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${serverRunning ? 'bg-green-500' : 'bg-gray-600'}`} />
                            <span className="text-xs text-foreground-muted">
                                {serverRunning ? t('deployment.running') : t('deployment.notRunning')}
                            </span>
                        </div>

                        {serverRunning && uptime != null && (
                            <span className="text-xs text-foreground-muted font-mono tabular-nums">
                                {formatUptime(uptime)}
                            </span>
                        )}

                        {serverRunning && pid && (
                            <span className="text-xs text-foreground-subtle font-mono">
                                PID {pid}
                            </span>
                        )}

                        <div className="ml-auto flex items-center gap-3">
                            <div className="flex items-center gap-2">
                                <Globe className="w-3.5 h-3.5 text-foreground-subtle" />
                                <select
                                    title="Bind address"
                                    value={host}
                                    onChange={(e) => setHost(e.target.value)}
                                    disabled={serverRunning}
                                    className="bg-transparent text-xs text-foreground-muted outline-none cursor-pointer hover:text-foreground-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <option value="127.0.0.1" className="bg-elevated">localhost</option>
                                    <option value="0.0.0.0" className="bg-elevated">0.0.0.0</option>
                                </select>
                            </div>
                            <span className="text-foreground-disabled">:</span>
                            <input
                                type="number"
                                title="Port"
                                disabled={serverRunning}
                                value={port}
                                onChange={(e) => setPort(e.target.value)}
                                className="w-16 bg-transparent border-b border-outline text-xs text-foreground-muted outline-none focus:border-white/30 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-center"
                            />
                        </div>
                    </div>

                    {/* Error message */}
                    {errorMsg && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-3 py-2 rounded-lg text-xs flex items-center justify-between gap-2">
                            <span>{errorMsg}</span>
                            <button
                                type="button"
                                onClick={() => setErrorMsg('')}
                                className="text-red-400/60 hover:text-red-400 shrink-0 transition-colors"
                                aria-label="Dismiss error"
                            >✕</button>
                        </div>
                    )}

                    {/* Endpoint URL when running */}
                    {serverRunning && (
                        <div className="flex items-center gap-2 bg-hover border border-outline-subtle rounded-lg px-3 py-2">
                            <span className="text-xs text-foreground-muted">{t('deployment.status')}</span>
                            <code className="text-xs font-mono text-foreground-secondary flex-1">{endpoint}/v1</code>
                            <button
                                type="button"
                                onClick={() => handleCopy(`${endpoint}/v1`, 'endpoint')}
                                className="h-7 w-7 flex items-center justify-center rounded text-foreground-subtle hover:text-foreground hover:bg-hover transition-colors"
                                title="Copy endpoint URL"
                                aria-label="Copy endpoint URL"
                            >
                                {copiedId === 'endpoint' ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                            <div className="w-px h-4 bg-hover mx-1" />
                            <span className="text-xs text-foreground-muted">Model</span>
                            <span className="text-xs text-foreground-muted font-mono truncate max-w-48">
                                {activeModel ? cleanModelName(activeModel.name) : 'none'}
                            </span>
                        </div>
                    )}

                    {/* Collapsible code snippets */}
                    <details
                        open={showSnippets}
                        onToggle={(e) => setShowSnippets((e.target as HTMLDetailsElement).open)}
                    >
                        <summary className="flex items-center gap-1.5 cursor-pointer text-xs text-foreground-muted hover:text-foreground-muted transition-colors select-none py-1">
                            <ChevronRight className={`w-3 h-3 transition-transform ${showSnippets ? 'rotate-90' : ''}`} />
                            <span>Integration snippets</span>
                        </summary>
                        <div className="mt-2 grid grid-cols-2 gap-3">
                            <SnippetBlock
                                label="cURL"
                                code={curlSnippet}
                                copied={copiedId === 'curl'}
                                onCopy={() => handleCopy(curlSnippet, 'curl')}
                            />
                            <SnippetBlock
                                label="Python (OpenAI SDK)"
                                code={pythonSnippet}
                                copied={copiedId === 'python'}
                                onCopy={() => handleCopy(pythonSnippet, 'python')}
                            />
                        </div>
                    </details>
                </div>

                {/* Log panel — takes remaining space */}
                <div className="flex-1 flex flex-col bg-black/30 border border-outline-subtle rounded-xl overflow-hidden min-h-0">
                    <div className="flex items-center justify-between px-4 py-2 border-b border-outline-subtle bg-hover shrink-0">
                        <div className="flex items-center gap-2">
                            <Terminal className="w-3.5 h-3.5 text-foreground-muted" />
                            <span className="text-xs font-medium text-foreground-muted">{t('deployment.logs')}</span>
                            <span className="text-[10px] text-foreground-subtle font-mono">{logs.length} entries</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <label className="flex items-center gap-1.5 text-[10px] text-foreground-subtle cursor-pointer">
                                <ToggleSwitch enabled={autoScroll} onChange={setAutoScroll} size="sm" />
                                Auto-scroll
                            </label>
                            {logs.length > 0 && (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const text = logs.map(e => `${formatLogTime(e.timestamp)}  ${e.source === 'stderr' ? 'err' : 'out'}  ${e.message}`).join('\n')
                                            handleCopy(text, 'logs')
                                        }}
                                        title="Copy all log entries"
                                        className="flex items-center gap-1 text-[10px] text-foreground-subtle hover:text-foreground-muted transition-colors"
                                    >
                                        {copiedId === 'logs' ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                                        <span>{copiedId === 'logs' ? 'Copied' : 'Copy all'}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setLogs([]); setLogSince(0); }}
                                        className="text-[10px] text-foreground-subtle hover:text-foreground-muted transition-colors"
                                    >
                                        Clear
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto font-mono text-xs p-3 space-y-0">
                        {logs.length === 0 ? (
                            <div className="h-full flex items-center justify-center">
                                <p className="text-foreground-subtle text-xs">
                                    {serverRunning ? 'Waiting for log output...' : 'Start the server to see logs here.'}
                                </p>
                            </div>
                        ) : (
                            logs.map((entry, i) => (
                                <div key={i} className="flex gap-3 py-0.5 hover:bg-hover px-1 rounded">
                                    <span className="text-foreground-subtle tabular-nums shrink-0">{formatLogTime(entry.timestamp)}</span>
                                    <span className={`shrink-0 w-12 text-right ${entry.source === 'stderr' ? 'text-yellow-600' : 'text-foreground-subtle'}`}>
                                        {entry.source === 'stderr' ? 'err' : 'out'}
                                    </span>
                                    <span className="text-foreground-muted break-all">{entry.message}</span>
                                </div>
                            ))
                        )}
                        <div ref={logEndRef} />
                    </div>
                </div>

            </div>
        </div>
    )
}

/** Tokenise a line of shell/Python code into coloured spans — no deps required. */
function highlightLine(line: string): React.ReactNode[] {
    // Strategy: split by regex, emit JSX spans per token.
    const out: React.ReactNode[] = []
    // Patterns (order matters — most-specific first)
    const patterns: [RegExp, string][] = [
        [/#.*$/,                       'text-foreground-muted italic'],   // comments
        [/"(?:[^"\\]|\\.)*"/,          'text-amber-300/80'],      // double-quoted strings
        [/'(?:[^'\\]|\\.)*'/,          'text-amber-300/80'],      // single-quoted strings
        [/\b(curl|python|from|import|client|OpenAI|if|else|for|return|def|class|print|True|False|None)\b/, 'text-purple-300/90'], // keywords
        [/\b([A-Z_][A-Z0-9_]+)\b/,    'text-yellow-300/70'],     // CONSTANTS
        [/-[A-Za-z]+|--[A-Za-z-]+/,   'text-cyan-400/80'],       // flags like -H, --header
        [/\b\d+(\.\d+)?\b/,           'text-emerald-400/80'],    // numbers
    ]

    let rest = line
    while (rest.length > 0) {
        let matched = false
        for (const [re, cls] of patterns) {
            const m = rest.match(re)
            if (m && m.index !== undefined) {
                if (m.index > 0) out.push(rest.slice(0, m.index))
                out.push(<span key={out.length} className={cls}>{m[0]}</span>)
                rest = rest.slice(m.index + m[0].length)
                matched = true
                break
            }
        }
        if (!matched) { out.push(rest); break }
    }
    return out
}

function SnippetBlock({ label, code, copied, onCopy }: {
    label: string
    code: string
    copied: boolean
    onCopy: () => void
}) {
    return (
        <div className="rounded-lg border border-outline-subtle bg-black/30 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 bg-hover border-b border-outline-subtle">
                <span className="text-[10px] font-mono text-foreground-muted">{label}</span>
                <button
                    type="button"
                    onClick={onCopy}
                    title={`Copy ${label} snippet`}
                    className="flex items-center gap-1 text-[10px] text-foreground-subtle hover:text-foreground-muted transition-colors"
                >
                    {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
            </div>
            <pre className="p-3 text-[11px] font-mono overflow-x-auto max-h-48 overflow-y-auto leading-relaxed">
                {code.split('\n').map((line, i) => (
                    <div key={i}>{highlightLine(line)}</div>
                ))}
            </pre>
        </div>
    )
}
