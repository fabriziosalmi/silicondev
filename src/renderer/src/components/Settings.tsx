import { useState, useEffect } from 'react'
import { Card } from './ui/Card'
import { ToggleSwitch } from './ui/ToggleSwitch'
import { apiClient } from '../api/client'
import { Settings2, MessageSquare, Brain, RotateCcw, Info, Server, Plus, Trash2, Loader2, Gauge, Globe, Play, Square, RefreshCcw, HardDrive, FolderSearch, FolderOpen, Bug, ScrollText, Copy, RefreshCw, Shield, Bot } from 'lucide-react'
import { useGlobalState } from '../context/GlobalState'
import type { IndexerSource, IndexerStatus } from '../api/client'

const CHAT_SETTINGS_KEY = 'silicon-studio-chat-settings'
const RAG_SETTINGS_KEY = 'silicon-studio-rag-settings'
const TOPBAR_SETTINGS_KEY = 'silicon-studio-topbar-settings'

interface ChatDefaults {
    systemPrompt: string
    temperature: number
    maxTokens: number
    maxContext: number
    topP: number
    repetitionPenalty: number
    reasoningMode: 'off' | 'auto' | 'low' | 'high'
    webSearchEnabled: boolean
    enableMoA: boolean
    airGappedMode: boolean
    enablePythonSandbox: boolean
}

interface RagDefaults {
    chunkSize: number
    chunkOverlap: number
}

const defaultChat: ChatDefaults = {
    systemPrompt: "You are a helpful AI assistant running locally on Apple Silicon.",
    temperature: 0.7,
    maxTokens: 2048,
    maxContext: 4096,
    topP: 0.9,
    repetitionPenalty: 1.1,
    reasoningMode: 'auto',
    webSearchEnabled: false,
    enableMoA: true,
    airGappedMode: false,
    enablePythonSandbox: false,
}

const defaultRag: RagDefaults = {
    chunkSize: 512,
    chunkOverlap: 50,
}

interface TopBarDefaults {
    warn: number
    critical: number
}

const defaultTopBar: TopBarDefaults = {
    warn: 60,
    critical: 85,
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
    return (
        <div className="flex items-center gap-2 mb-4">
            <span className="text-blue-400">{icon}</span>
            <h3 className="text-sm font-bold text-white uppercase tracking-wide">{title}</h3>
        </div>
    )
}

function SliderField({ label, value, onChange, min, max, step = 1, hint }: {
    label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; hint?: string
}) {
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-gray-500 uppercase">{label}</label>
                <input
                    type="number"
                    value={value}
                    onChange={(e) => onChange(Number(e.target.value))}
                    min={min}
                    max={max}
                    step={step}
                    className="w-20 bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white text-right outline-none focus:border-blue-500"
                />
            </div>
            <input
                type="range"
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                min={min}
                max={max}
                step={step}
                className="w-full accent-blue-500 h-1"
            />
            {hint && <span className="text-[10px] text-gray-600">{hint}</span>}
        </div>
    )
}

interface MCPServer {
    id: string
    name: string
    command: string
    args: string[]
    env: Record<string, string>
    transport: string
}

function MCPServersSection() {
    const [servers, setServers] = useState<MCPServer[]>([])
    const [loading, setLoading] = useState(true)
    const [showAdd, setShowAdd] = useState(false)
    const [newName, setNewName] = useState('')
    const [newCommand, setNewCommand] = useState('')
    const [newArgs, setNewArgs] = useState('')
    const [adding, setAdding] = useState(false)
    const [testing, setTesting] = useState<string | null>(null)
    const [testResult, setTestResult] = useState<{ id: string; msg: string; ok: boolean } | null>(null)

    const fetchServers = async () => {
        try {
            const list = await apiClient.mcp.listServers()
            setServers(list)
        } catch { setServers([]) }
        finally { setLoading(false) }
    }

    useEffect(() => { fetchServers() }, [])

    const handleAdd = async () => {
        if (!newName.trim() || !newCommand.trim()) return
        setAdding(true)
        try {
            await apiClient.mcp.addServer({
                name: newName.trim(),
                command: newCommand.trim(),
                args: newArgs.trim() ? newArgs.split(/\s+/) : [],
            })
            setNewName('')
            setNewCommand('')
            setNewArgs('')
            setShowAdd(false)
            fetchServers()
        } catch { /* ignore */ }
        finally { setAdding(false) }
    }

    const handleRemove = async (id: string) => {
        try {
            await apiClient.mcp.removeServer(id)
            setServers(prev => prev.filter(s => s.id !== id))
        } catch { /* ignore */ }
    }

    const handleTest = async (id: string) => {
        setTesting(id)
        setTestResult(null)
        try {
            const res = await apiClient.mcp.listTools(id)
            setTestResult({ id, msg: `Connected — ${res.tools.length} tool(s) found`, ok: true })
        } catch (err) {
            setTestResult({ id, msg: err instanceof Error ? err.message : 'Connection failed', ok: false })
        } finally { setTesting(null) }
    }

    return (
        <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <span className="text-blue-400"><Server size={16} /></span>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wide">MCP Servers</h3>
                </div>
                <button
                    onClick={() => setShowAdd(!showAdd)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs text-blue-400 hover:bg-blue-500/10 transition-colors"
                >
                    <Plus size={14} /> Add Server
                </button>
            </div>

            {showAdd && (
                <div className="mb-4 p-3 rounded-lg bg-black/30 border border-white/5 space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-gray-500 uppercase">Name</label>
                            <input
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="my-server"
                                className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-blue-500"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-gray-500 uppercase">Command</label>
                            <input
                                value={newCommand}
                                onChange={(e) => setNewCommand(e.target.value)}
                                placeholder="npx or python"
                                className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-blue-500"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-gray-500 uppercase">Args (space-separated)</label>
                            <input
                                value={newArgs}
                                onChange={(e) => setNewArgs(e.target.value)}
                                placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                                className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-blue-500"
                            />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors">Cancel</button>
                        <button
                            onClick={handleAdd}
                            disabled={adding || !newName.trim() || !newCommand.trim()}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded transition-all disabled:opacity-50"
                        >
                            {adding ? 'Adding...' : 'Add'}
                        </button>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="flex justify-center py-4">
                    <Loader2 size={16} className="animate-spin text-gray-500" />
                </div>
            ) : servers.length === 0 ? (
                <p className="text-sm text-gray-500">No MCP servers configured. Click "Add Server" to connect to an MCP server.</p>
            ) : (
                <div className="space-y-2">
                    {servers.map(s => (
                        <div key={s.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-black/20 border border-white/5">
                            <Server size={14} className="text-gray-500 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <div className="text-sm text-white font-medium">{s.name}</div>
                                <div className="text-[10px] text-gray-600 truncate">{s.command} {s.args.join(' ')}</div>
                            </div>
                            <button
                                onClick={() => handleTest(s.id)}
                                disabled={testing === s.id}
                                className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
                            >
                                {testing === s.id ? 'Testing...' : 'Test'}
                            </button>
                            <button onClick={() => handleRemove(s.id)} title="Remove server" className="text-gray-600 hover:text-red-400 transition-colors">
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))}
                    {testResult && (
                        <div className={`text-xs px-3 py-2 rounded ${testResult.ok ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'}`}>
                            {testResult.msg}
                        </div>
                    )}
                </div>
            )}
        </Card>
    )
}

function WebIndexerSection() {
    const [sources, setSources] = useState<IndexerSource[]>([])
    const [status, setStatus] = useState<IndexerStatus | null>(null)
    const [loading, setLoading] = useState(true)
    const [crawling, setCrawling] = useState(false)
    const [crawlResult, setCrawlResult] = useState<string | null>(null)
    const [newUrl, setNewUrl] = useState('')
    const [newLabel, setNewLabel] = useState('')
    const [showAdd, setShowAdd] = useState(false)

    const fetchData = async () => {
        try {
            const [srcRes, statusRes] = await Promise.all([
                apiClient.indexer.getSources(),
                apiClient.indexer.getStatus(),
            ])
            setSources(srcRes.sources)
            setStatus(statusRes)
        } catch { /* ignore */ }
        finally { setLoading(false) }
    }

    useEffect(() => { fetchData() }, [])

    const handleAdd = async () => {
        if (!newUrl.trim()) return
        try {
            await apiClient.indexer.addSource(newUrl.trim(), newLabel.trim() || undefined)
            setNewUrl('')
            setNewLabel('')
            setShowAdd(false)
            fetchData()
        } catch { /* ignore */ }
    }

    const handleRemove = async (id: string) => {
        try {
            await apiClient.indexer.removeSource(id)
            setSources(prev => prev.filter(s => s.id !== id))
        } catch { /* ignore */ }
    }

    const handleToggle = async (id: string, enabled: boolean) => {
        try {
            await apiClient.indexer.toggleSource(id, enabled)
            setSources(prev => prev.map(s => s.id === id ? { ...s, enabled } : s))
        } catch { /* ignore */ }
    }

    const handleCrawl = async () => {
        setCrawling(true)
        setCrawlResult(null)
        try {
            const res = await apiClient.indexer.crawl()
            setCrawlResult(`Indexed ${res.indexed} chunks from ${res.fetched ?? 0} pages`)
            fetchData()
        } catch (err) {
            setCrawlResult(err instanceof Error ? err.message : 'Crawl failed')
        } finally { setCrawling(false) }
    }

    const handleToggleBackground = async () => {
        if (!status) return
        try {
            if (status.running) {
                await apiClient.indexer.stop()
            } else {
                await apiClient.indexer.start(60)
            }
            fetchData()
        } catch { /* ignore */ }
    }

    return (
        <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <span className="text-blue-400"><Globe size={16} /></span>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wide">Web Indexer</h3>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleCrawl}
                        disabled={crawling || sources.filter(s => s.enabled).length === 0}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs text-green-400 hover:bg-green-500/10 transition-colors disabled:opacity-50"
                    >
                        {crawling ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
                        {crawling ? 'Crawling...' : 'Crawl Now'}
                    </button>
                    {status && (
                        <button
                            onClick={handleToggleBackground}
                            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${status.running ? 'text-red-400 hover:bg-red-500/10' : 'text-blue-400 hover:bg-blue-500/10'}`}
                        >
                            {status.running ? <><Square size={14} /> Stop</> : <><Play size={14} /> Auto</>}
                        </button>
                    )}
                    <button
                        onClick={() => setShowAdd(!showAdd)}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs text-blue-400 hover:bg-blue-500/10 transition-colors"
                    >
                        <Plus size={14} /> Add URL
                    </button>
                </div>
            </div>

            {status && (
                <div className="flex items-center gap-4 mb-3 text-[10px] text-gray-500">
                    <span className={`flex items-center gap-1 ${status.running ? 'text-green-500' : 'text-gray-600'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${status.running ? 'bg-green-500' : 'bg-gray-600'}`} />
                        {status.running ? 'Running (hourly)' : 'Stopped'}
                    </span>
                    {status.last_run && (
                        <span>Last crawl: {new Date(status.last_run * 1000).toLocaleString()}</span>
                    )}
                    <span>{status.enabled_sources}/{status.total_sources} sources enabled</span>
                </div>
            )}

            {showAdd && (
                <div className="mb-4 p-3 rounded-lg bg-black/30 border border-white/5 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-gray-500 uppercase">URL</label>
                            <input
                                value={newUrl}
                                onChange={(e) => setNewUrl(e.target.value)}
                                placeholder="https://docs.example.com"
                                className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-blue-500"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-gray-500 uppercase">Label (optional)</label>
                            <input
                                value={newLabel}
                                onChange={(e) => setNewLabel(e.target.value)}
                                placeholder="Python docs"
                                className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-blue-500"
                            />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors">Cancel</button>
                        <button
                            onClick={handleAdd}
                            disabled={!newUrl.trim()}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded transition-all disabled:opacity-50"
                        >
                            Add
                        </button>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="flex justify-center py-4">
                    <Loader2 size={16} className="animate-spin text-gray-500" />
                </div>
            ) : sources.length === 0 ? (
                <p className="text-sm text-gray-500">No URLs configured. Add URLs to automatically crawl, chunk, and index web content into your RAG knowledge base.</p>
            ) : (
                <div className="space-y-2">
                    {sources.map(s => (
                        <div key={s.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg bg-black/20 border border-white/5 ${!s.enabled ? 'opacity-50' : ''}`}>
                            <ToggleSwitch
                                enabled={s.enabled}
                                onChange={(v) => handleToggle(s.id, v)}
                                size="sm"
                                label={`Toggle ${s.label}`}
                            />
                            <Globe size={14} className="text-gray-500 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <div className="text-sm text-white font-medium truncate">{s.label}</div>
                                <div className="text-[10px] text-gray-600 truncate">{s.url}</div>
                            </div>
                            <button onClick={() => handleRemove(s.id)} title="Remove source" className="text-gray-600 hover:text-red-400 transition-colors">
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {crawlResult && (
                <div className="mt-3 text-xs text-gray-400 bg-black/20 rounded px-3 py-2">
                    {crawlResult}
                </div>
            )}
        </Card>
    )
}

function CodebaseIndexSection() {
    const [status, setStatus] = useState<{ indexed: boolean; directory?: string; file_count?: number; chunk_count?: number; indexed_at?: number; has_embeddings?: boolean } | null>(null)
    const [loading, setLoading] = useState(true)
    const [indexing, setIndexing] = useState(false)
    const [indexResult, setIndexResult] = useState<string | null>(null)

    const fetchStatus = async () => {
        try {
            const s = await apiClient.codebase.getStatus()
            setStatus(s)
        } catch { setStatus({ indexed: false }) }
        finally { setLoading(false) }
    }

    useEffect(() => { fetchStatus() }, [])

    const handlePickDirectory = async () => {
        try {
            const dir = await window.electronAPI?.selectDirectory?.()
            if (dir) {
                handleIndex(dir)
            }
        } catch {
            // Fallback: prompt for path
            const dir = prompt('Enter absolute path to your project directory:')
            if (dir?.trim()) handleIndex(dir.trim())
        }
    }

    const handleIndex = async (directory: string) => {
        setIndexing(true)
        setIndexResult(null)
        // Always set workspace dir so the Code tab can browse files,
        // even if the codebase indexer finds no source files to index.
        localStorage.setItem('silicon-studio-workspace-dir', directory)
        window.dispatchEvent(new CustomEvent('workspace-dir-changed', { detail: directory }))
        try {
            const result = await apiClient.codebase.index(directory)
            setIndexResult(`Indexed ${result.file_count} files into ${result.chunk_count} chunks`)
            fetchStatus()
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Indexing failed'
            setIndexResult(msg.includes('No source files') ? 'Workspace set. No source files found for semantic search, but you can browse files in the Code tab.' : msg)
        } finally { setIndexing(false) }
    }

    const handleDelete = async () => {
        if (!confirm('Delete the codebase index? You can re-index at any time.')) return
        try {
            await apiClient.codebase.deleteIndex()
            localStorage.removeItem('silicon-studio-workspace-dir')
            window.dispatchEvent(new CustomEvent('workspace-dir-changed', { detail: null }))
            setStatus({ indexed: false })
            setIndexResult(null)
        } catch { /* ignore */ }
    }

    return (
        <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <span className="text-blue-400"><FolderSearch size={16} /></span>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wide">Codebase Index</h3>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handlePickDirectory}
                        disabled={indexing}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-50"
                    >
                        {indexing ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                        {indexing ? 'Indexing...' : status?.indexed ? 'Re-index' : 'Select Directory'}
                    </button>
                    {status?.indexed && (
                        <button
                            onClick={handleDelete}
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                            <Trash2 size={14} /> Delete
                        </button>
                    )}
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-4">
                    <Loader2 size={16} className="animate-spin text-gray-500" />
                </div>
            ) : status?.indexed ? (
                <div className="space-y-2">
                    <div className="flex items-center gap-4 text-[10px] text-gray-500">
                        <span className="flex items-center gap-1 text-green-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            Indexed
                        </span>
                        <span>{status.file_count} files</span>
                        <span>{status.chunk_count} chunks</span>
                        {status.has_embeddings && <span className="text-blue-400">vector search enabled</span>}
                        {status.indexed_at && (
                            <span>Last indexed: {new Date(status.indexed_at * 1000).toLocaleString()}</span>
                        )}
                    </div>
                    <div className="flex items-center px-3 py-2 rounded-lg bg-black/30 border border-white/5">
                        <span className="text-xs text-gray-400 font-mono truncate">{status.directory}</span>
                    </div>
                </div>
            ) : (
                <p className="text-sm text-gray-500">
                    Select a project directory to enable semantic code search in the NanoCore terminal. AST-aware chunking for Python, line-based for other languages.
                </p>
            )}

            {indexResult && (
                <div className="mt-3 text-xs text-gray-400 bg-black/20 rounded px-3 py-2">
                    {indexResult}
                </div>
            )}
        </Card>
    )
}

function LogViewerSection() {
    const [logs, setLogs] = useState<string[]>([])
    const [expanded, setExpanded] = useState(false)
    const [loading, setLoading] = useState(false)

    const fetchLogs = async () => {
        setLoading(true)
        try {
            const data = await apiClient.monitor.getLogs(300)
            setLogs(data.lines)
        } catch { setLogs(['Failed to fetch logs']) }
        finally { setLoading(false) }
    }

    const handleCopy = () => {
        navigator.clipboard.writeText(logs.join('\n')).catch(() => { })
    }

    return (
        <Card className="p-5">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-blue-400"><ScrollText size={16} /></span>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wide">Debug Logs</h3>
                </div>
                <div className="flex items-center gap-2">
                    {expanded && logs.length > 0 && (
                        <button onClick={handleCopy} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors">
                            <Copy size={14} /> Copy
                        </button>
                    )}
                    {expanded && (
                        <button onClick={fetchLogs} disabled={loading} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-50">
                            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            Refresh
                        </button>
                    )}
                    <button
                        onClick={() => { if (!expanded) fetchLogs(); setExpanded(!expanded) }}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                    >
                        {expanded ? 'Hide' : 'Show Logs'}
                    </button>
                </div>
            </div>
            {!expanded && (
                <p className="text-sm text-gray-500">View backend logs for debugging. Useful when reporting bugs.</p>
            )}
            {expanded && (
                <div className="mt-2 max-h-80 overflow-y-auto bg-black/40 border border-white/5 rounded-lg p-3 font-mono text-[11px] text-gray-400 leading-relaxed">
                    {loading && logs.length === 0 ? (
                        <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-gray-500" /></div>
                    ) : logs.length === 0 ? (
                        <span className="text-gray-600">No log entries found.</span>
                    ) : (
                        logs.map((line, i) => (
                            <div key={i} className={`whitespace-pre-wrap break-all ${line.includes('ERROR') ? 'text-red-400' : line.includes('WARNING') ? 'text-yellow-400' : ''}`}>
                                {line}
                            </div>
                        ))
                    )}
                </div>
            )}
        </Card>
    )
}

export function Settings() {
    const { systemStats } = useGlobalState()

    const [chat, setChat] = useState<ChatDefaults>(() => {
        try {
            const saved = localStorage.getItem(CHAT_SETTINGS_KEY)
            if (saved) {
                const parsed = JSON.parse(saved)
                return { ...defaultChat, ...parsed }
            }
        } catch { /* ignore */ }
        return { ...defaultChat }
    })

    const [rag, setRag] = useState<RagDefaults>(() => {
        try {
            const saved = localStorage.getItem(RAG_SETTINGS_KEY)
            if (saved) return { ...defaultRag, ...JSON.parse(saved) }
        } catch { /* ignore */ }
        return { ...defaultRag }
    })

    // Persist chat settings on change
    useEffect(() => {
        try {
            const existing = localStorage.getItem(CHAT_SETTINGS_KEY)
            const merged = existing ? { ...JSON.parse(existing), ...chat } : chat
            localStorage.setItem(CHAT_SETTINGS_KEY, JSON.stringify(merged))
        } catch { /* ignore */ }
    }, [chat])

    const [topBar, setTopBar] = useState<TopBarDefaults>(() => {
        try {
            const saved = localStorage.getItem(TOPBAR_SETTINGS_KEY)
            if (saved) return { ...defaultTopBar, ...JSON.parse(saved) }
        } catch { /* ignore */ }
        return { ...defaultTopBar }
    })

    // Persist RAG settings on change
    useEffect(() => {
        localStorage.setItem(RAG_SETTINGS_KEY, JSON.stringify(rag))
    }, [rag])

    // Persist TopBar settings on change
    useEffect(() => {
        localStorage.setItem(TOPBAR_SETTINGS_KEY, JSON.stringify(topBar))
    }, [topBar])

    // PII redaction toggle (stored in CHAT_SETTINGS_KEY alongside chat settings)
    const [piiRedaction, setPiiRedaction] = useState(() => {
        try {
            const saved = localStorage.getItem(CHAT_SETTINGS_KEY)
            if (saved) return JSON.parse(saved).piiRedaction ?? false
        } catch { /* ignore */ }
        return false
    })

    useEffect(() => {
        try {
            const existing = localStorage.getItem(CHAT_SETTINGS_KEY)
            const merged = existing ? { ...JSON.parse(existing), piiRedaction } : { piiRedaction }
            localStorage.setItem(CHAT_SETTINGS_KEY, JSON.stringify(merged))
            window.dispatchEvent(new CustomEvent('silicon-studio-settings-changed', { detail: { piiRedaction } }))
        } catch { /* ignore */ }
    }, [piiRedaction])

    const updateChat = <K extends keyof ChatDefaults>(key: K, value: ChatDefaults[K]) => {
        setChat(prev => ({ ...prev, [key]: value }))
    }

    const handleReset = () => {
        if (!confirm('Reset all settings to defaults?')) return
        setChat({ ...defaultChat })
        setRag({ ...defaultRag })
        setTopBar({ ...defaultTopBar })
        setPiiRedaction(false)
        localStorage.removeItem(CHAT_SETTINGS_KEY)
        localStorage.removeItem(RAG_SETTINGS_KEY)
        localStorage.removeItem(TOPBAR_SETTINGS_KEY)
    }

    // Log path from Electron
    const [logPath, setLogPath] = useState<string | null>(null)
    useEffect(() => {
        window.electronAPI?.getLogPath?.().then(p => setLogPath(p)).catch(err => console.error('Failed to get log path:', err))
    }, [])

    // Storage management
    const [storageInfo, setStorageInfo] = useState<{ total_bytes: number; breakdown: Record<string, number>; path: string } | null>(null)
    const [storageCleaning, setStorageCleaning] = useState(false)

    const fetchStorage = async () => {
        try {
            const info = await apiClient.monitor.getStorage()
            setStorageInfo(info)
        } catch { /* ignore */ }
    }

    const formatBytes = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
    }

    const handleCleanup = async (targets: string[]) => {
        const label = targets.join(', ')
        if (!confirm(`Delete all ${label}? This cannot be undone.`)) return
        setStorageCleaning(true)
        try {
            const result = await apiClient.monitor.cleanupStorage(targets)
            if (result.freed_bytes > 0) {
                fetchStorage()
            }
        } catch { /* ignore */ }
        setStorageCleaning(false)
    }

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Settings2 size={20} className="text-blue-400" />
                    <h2 className="text-lg font-bold text-white">Settings</h2>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        const platform = systemStats?.platform
                        const sysInfo = platform ? `${platform.system} ${platform.release} (${platform.processor})` : 'Unknown'
                        const params = new URLSearchParams({
                            title: '[Bug] ',
                            body: `## Description\n\nDescribe the bug...\n\n## System Info\n\n- OS: ${sysInfo}\n- App Version: 0.7.4\n\n## Steps to Reproduce\n\n1. \n2. \n3. \n\n## Expected Behavior\n\n\n## Logs\n\nPaste relevant logs from Settings > Debug Logs\n`,
                        })
                        window.open(`https://github.com/fabriziosalmi/silicondev/issues/new?${params.toString()}`, '_blank')
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-400 text-xs hover:bg-white/10 hover:text-white transition-colors"
                >
                    <Bug size={14} />
                    Report a Bug
                </button>
            </div>

            {/* General */}
            <Card className="p-5">
                <SectionHeader icon={<Info size={16} />} title="General" />
                <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-500 uppercase">Backend URL</label>
                        <div className="flex items-center px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm text-gray-400">
                            {apiClient.API_BASE}
                        </div>
                        <span className="text-[10px] text-gray-600">Auto-detected at startup.</span>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-500 uppercase">Reasoning Mode</label>
                        <select
                            value={chat.reasoningMode}
                            onChange={(e) => updateChat('reasoningMode', e.target.value as ChatDefaults['reasoningMode'])}
                            className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-blue-500"
                        >
                            <option value="off">Off</option>
                            <option value="auto">Auto</option>
                            <option value="low">Low</option>
                            <option value="high">High</option>
                        </select>
                    </div>
                    {logPath && (
                        <div className="flex flex-col gap-1 col-span-2">
                            <label className="text-xs font-bold text-gray-500 uppercase">Log File</label>
                            <div className="flex items-center px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm text-gray-400 truncate">
                                {logPath}
                            </div>
                            <span className="text-[10px] text-gray-600">Share this file when reporting bugs.</span>
                        </div>
                    )}
                </div>
            </Card>

            {/* Status Bar Thresholds */}
            <Card className="p-5">
                <SectionHeader icon={<Gauge size={16} />} title="Status Bar Thresholds" />
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                    <SliderField label="Warning %" value={topBar.warn} onChange={(v) => setTopBar(prev => ({ ...prev, warn: v }))} min={20} max={95} step={5} hint="Yellow threshold" />
                    <SliderField label="Critical %" value={topBar.critical} onChange={(v) => setTopBar(prev => ({ ...prev, critical: v }))} min={30} max={99} step={5} hint="Red threshold" />
                </div>
            </Card>

            {/* Chat Defaults */}
            <Card className="p-5">
                <SectionHeader icon={<MessageSquare size={16} />} title="Chat Defaults" />
                <div className="space-y-4">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-500 uppercase">System Prompt</label>
                        <textarea
                            value={chat.systemPrompt}
                            onChange={(e) => updateChat('systemPrompt', e.target.value)}
                            rows={3}
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-blue-500 resize-none"
                        />
                    </div>
                    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                        <SliderField label="Temperature" value={chat.temperature} onChange={(v) => updateChat('temperature', v)} min={0} max={2} step={0.05} hint="Creativity (0=deterministic)" />
                        <SliderField label="Max Tokens" value={chat.maxTokens} onChange={(v) => updateChat('maxTokens', v)} min={64} max={8192} step={64} hint="Max response length" />
                        <SliderField label="Max Context" value={chat.maxContext} onChange={(v) => updateChat('maxContext', v)} min={512} max={32768} step={512} hint="Conversation window" />
                        <SliderField label="Top P" value={chat.topP} onChange={(v) => updateChat('topP', v)} min={0} max={1} step={0.05} hint="Nucleus sampling" />
                    </div>
                    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                        <SliderField label="Repetition Penalty" value={chat.repetitionPenalty} onChange={(v) => updateChat('repetitionPenalty', v)} min={1} max={2} step={0.05} hint="Penalize repeated tokens" />
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-300">Enable web search by default</span>
                        <ToggleSwitch
                            enabled={chat.webSearchEnabled}
                            onChange={(v) => updateChat('webSearchEnabled', v)}
                            size="sm"
                            label="Enable web search by default"
                        />
                    </div>
                </div>
            </Card>

            {/* RAG Defaults */}
            <Card className="p-5">
                <SectionHeader icon={<Brain size={16} />} title="RAG Defaults" />
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                    <SliderField label="Chunk Size" value={rag.chunkSize} onChange={(v) => setRag(prev => ({ ...prev, chunkSize: v }))} min={128} max={2048} step={64} hint="Characters per chunk" />
                    <SliderField label="Chunk Overlap" value={rag.chunkOverlap} onChange={(v) => setRag(prev => ({ ...prev, chunkOverlap: v }))} min={0} max={512} step={10} hint="Overlap between chunks" />
                </div>
            </Card>

            {/* Privacy */}
            <Card className="p-5">
                <SectionHeader icon={<Shield size={16} />} title="Privacy" />
                <div className="flex items-center justify-between">
                    <div>
                        <span className="text-sm text-gray-300">PII Redaction</span>
                        <p className="text-[10px] text-gray-600 mt-0.5">Redact emails, phone numbers, IPs, credit cards, SSNs, and API keys from chat messages</p>
                    </div>
                    <ToggleSwitch
                        enabled={piiRedaction}
                        onChange={setPiiRedaction}
                        size="sm"
                        label="PII Redaction"
                    />
                </div>
            </Card>

            {/* Agent Capabilities & Security */}
            <Card className="p-5">
                <SectionHeader icon={<Bot size={16} />} title="Agent Capabilities & Security" />
                <div className="space-y-4">
                    <div className="flex items-start justify-between">
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-300 font-bold">Mixture of Agents (MoA) Swarm</span>
                                <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 text-[10px] font-bold">NEW</span>
                            </div>
                            <p className="text-[10px] text-gray-600 mt-1 max-w-sm">
                                Allows the Agent to spawn 3 specialized parallel personas (Security, Performance, Syntax) to tackle complex tasks with extremely high reasoning capabilities.
                            </p>
                        </div>
                        <ToggleSwitch
                            enabled={chat.enableMoA}
                            onChange={(v) => updateChat('enableMoA', v)}
                            size="sm"
                            label="Enable Mixture of Agents"
                        />
                    </div>

                    <div className="flex items-start justify-between border-t border-white/5 pt-4">
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-300 font-bold">Air-Gapped Mode</span>
                                <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 text-[10px] font-bold">SECURITY</span>
                            </div>
                            <p className="text-[10px] text-gray-600 mt-1 max-w-sm">
                                Strictly blocks the Agent from accessing the internet using curl, wget, or python requests. Forces 100% offline local operation.
                            </p>
                        </div>
                        <ToggleSwitch
                            enabled={chat.airGappedMode}
                            onChange={(v) => updateChat('airGappedMode', v)}
                            size="sm"
                            label="Enable Air-Gapped Mode"
                        />
                    </div>

                    <div className="flex items-start justify-between border-t border-white/5 pt-4">
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-300 font-bold">Programmatic Sandboxing</span>
                                <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 text-[10px] font-bold">EXPERIMENTAL</span>
                            </div>
                            <p className="text-[10px] text-gray-600 mt-1 max-w-sm">
                                Allows the Agent to write and execute isolated Python scripts to process data, parse strings, and compute logic before returning answers.
                            </p>
                        </div>
                        <ToggleSwitch
                            enabled={chat.enablePythonSandbox}
                            onChange={(v) => updateChat('enablePythonSandbox', v)}
                            size="sm"
                            label="Enable Python Sandbox"
                        />
                    </div>
                </div>
            </Card>

            {/* MCP Servers */}
            <MCPServersSection />

            {/* Codebase Index */}
            <CodebaseIndexSection />

            {/* Web Indexer */}
            <WebIndexerSection />

            {/* About / Reset */}
            {/* Storage Management */}
            <Card className="p-5">
                <SectionHeader icon={<HardDrive size={16} />} title="Storage" />
                {storageInfo ? (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 font-mono">{storageInfo.path}</span>
                            <button
                                type="button"
                                onClick={() => window.electronAPI?.openPath?.(storageInfo.path)}
                                className="text-[10px] px-2 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 transition-colors"
                            >
                                Open in Finder
                            </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {Object.entries(storageInfo.breakdown).map(([key, bytes]) => (
                                <div key={key} className="flex items-center justify-between px-3 py-2 rounded-lg bg-black/30 border border-white/5">
                                    <span className="text-xs text-gray-400 capitalize">{key}</span>
                                    <span className="text-xs font-mono text-white">{formatBytes(bytes)}</span>
                                </div>
                            ))}
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-white/5">
                            <span className="text-xs text-gray-400">Total: <span className="text-white font-mono">{formatBytes(storageInfo.total_bytes)}</span></span>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => handleCleanup(['logs'])}
                                    disabled={storageCleaning}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-400 text-[11px] hover:bg-white/10 transition-colors disabled:opacity-50"
                                >
                                    <Trash2 size={12} />
                                    Clear Logs
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleCleanup(['logs', 'conversations', 'notes'])}
                                    disabled={storageCleaning}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] hover:bg-red-500/20 transition-colors disabled:opacity-50"
                                >
                                    {storageCleaning ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                    Clear All Data
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={fetchStorage}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-400 text-sm hover:bg-white/10 transition-colors"
                    >
                        <HardDrive size={14} />
                        Check Storage Usage
                    </button>
                )}
            </Card>

            {/* Debug Logs */}
            <LogViewerSection />

            <Card className="p-5">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-bold text-white">SiliconDev</h3>
                        <p className="text-xs text-gray-500 mt-1">Local AI development environment for Apple Silicon</p>
                    </div>
                    <button
                        type="button"
                        onClick={handleReset}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm hover:bg-red-500/20 transition-colors"
                    >
                        <RotateCcw size={14} />
                        Reset All Settings
                    </button>
                </div>
            </Card>
        </div>
    )
}
