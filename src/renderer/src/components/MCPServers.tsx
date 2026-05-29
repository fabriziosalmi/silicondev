import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from './ui/PageHeader'
import { Card } from './ui/Card'
import { Server, Plus, Trash2, Play, ChevronDown, ChevronRight, Search, ExternalLink, Package, Loader2 } from 'lucide-react'
import { useConfirm } from './ui/ConfirmDialog'
import { apiClient } from '../api/client'
import { useToast } from './ui/Toast'

interface MCPServer {
    id: string
    name: string
    command: string
    args: string[]
    env: Record<string, string>
    transport: string
}

interface MCPTool {
    name: string
    description: string
    inputSchema: Record<string, unknown>
}

interface RegistryEntry {
    name: string
    description: string
    version: string
    npm_url: string
    repository: string
    keywords: string[]
}

/** Display name derived from "@modelcontextprotocol/server-foo" → "Foo". */
function prettyName(pkgName: string): string {
    const base = pkgName.split('/').pop() || pkgName
    const stripped = base.replace(/^server-/, '').replace(/-/g, ' ')
    return stripped.replace(/\b\w/g, c => c.toUpperCase())
}

const POPULAR_SERVERS = [
    { name: 'Filesystem', command: 'npx', args: '-y @modelcontextprotocol/server-filesystem /tmp', description: 'Read, write, and manage files on disk' },
    { name: 'Memory', command: 'npx', args: '-y @modelcontextprotocol/server-memory', description: 'Persistent key-value memory for conversations' },
    { name: 'Brave Search', command: 'npx', args: '-y @modelcontextprotocol/server-brave-search', description: 'Web search via Brave Search API' },
    { name: 'GitHub', command: 'npx', args: '-y @modelcontextprotocol/server-github', description: 'GitHub repos, issues, and PRs' },
    { name: 'PostgreSQL', command: 'npx', args: '-y @modelcontextprotocol/server-postgres', description: 'Query PostgreSQL databases' },
    { name: 'SQLite', command: 'npx', args: '-y @modelcontextprotocol/server-sqlite', description: 'Query SQLite databases' },
]

export function MCPServers() {
    const { t } = useTranslation()
    const { confirm } = useConfirm()
    const [servers, setServers] = useState<MCPServer[]>([])
    const [loading, setLoading] = useState(true)
    const [showAdd, setShowAdd] = useState(false)
    const [newName, setNewName] = useState('')
    const [newCommand, setNewCommand] = useState('')
    const [newArgs, setNewArgs] = useState('')
    const [adding, setAdding] = useState(false)
    const [expandedServer, setExpandedServer] = useState<string | null>(null)
    const [serverTools, setServerTools] = useState<Record<string, MCPTool[]>>({})
    const [testing, setTesting] = useState<string | null>(null)
    const [searchTerm, setSearchTerm] = useState('')
    const [registry, setRegistry] = useState<RegistryEntry[]>([])
    const [registryLoading, setRegistryLoading] = useState(false)
    const [registryError, setRegistryError] = useState<string | null>(null)
    const [addingPkg, setAddingPkg] = useState<string | null>(null)
    const { toast } = useToast()

    const fetchServers = async () => {
        try {
            const list = await apiClient.mcp.listServers()
            setServers(list)
        } catch { setServers([]) }
        finally { setLoading(false) }
    }

    const fetchRegistry = async () => {
        setRegistryLoading(true)
        setRegistryError(null)
        try {
            const data = await apiClient.mcp.searchRegistry('')
            setRegistry(data.results)
        } catch (err) {
            setRegistryError(err instanceof Error ? err.message : 'Failed to load npm catalog')
        } finally {
            setRegistryLoading(false)
        }
    }

    useEffect(() => { fetchServers(); fetchRegistry() }, [])

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
            toast('Server added', 'success')
        } catch {
            toast('Failed to add server', 'error')
        } finally { setAdding(false) }
    }

    const handleQuickAdd = async (preset: typeof POPULAR_SERVERS[0]) => {
        setAdding(true)
        try {
            await apiClient.mcp.addServer({
                name: preset.name,
                command: preset.command,
                args: preset.args.split(/\s+/),
            })
            fetchServers()
            toast(`Added ${preset.name} server`, 'success')
        } catch {
            toast('Failed to add server', 'error')
        } finally { setAdding(false) }
    }

    const handleRemove = async (id: string) => {
        const ok = await confirm({ message: 'Remove this MCP server?', destructive: true, confirmLabel: 'Remove' })
        if (!ok) return
        try {
            await apiClient.mcp.removeServer(id)
            setServers(prev => prev.filter(s => s.id !== id))
            if (expandedServer === id) setExpandedServer(null)
            toast('Server removed', 'success')
        } catch {
            toast('Failed to remove server', 'error')
        }
    }

    const handleToggleTools = async (id: string) => {
        if (expandedServer === id) {
            setExpandedServer(null)
            return
        }
        setExpandedServer(id)
        if (!serverTools[id]) {
            setTesting(id)
            try {
                const res = await apiClient.mcp.listTools(id)
                setServerTools(prev => ({ ...prev, [id]: res.tools }))
            } catch {
                toast('Failed to connect to server', 'error')
                setExpandedServer(null)
            } finally { setTesting(null) }
        }
    }

    const handleTestTool = async (serverId: string, toolName: string) => {
        try {
            const result = await apiClient.mcp.executeTool(serverId, toolName, {})
            toast(`${toolName}: ${typeof result.result === 'string' ? result.result.slice(0, 100) : 'OK'}`, 'success')
        } catch (err) {
            toast(`${toolName} failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
        }
    }

    const existingNames = useMemo(() => new Set(servers.map(s => s.name)), [servers])
    // Packages already exposed in the curated "Server Catalog" cards — used
    // to hide them from the npm catalog so the same row doesn't appear twice.
    const presetPackageNames = useMemo(() => new Set(POPULAR_SERVERS.map(p => {
        const m = p.args.match(/@modelcontextprotocol\/[\w-]+/)
        return m ? m[0] : ''
    }).filter(Boolean)), [])

    const filteredPresets = POPULAR_SERVERS.filter(p =>
        !existingNames.has(p.name) &&
        (searchTerm === '' || p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.description.toLowerCase().includes(searchTerm.toLowerCase()))
    )

    const filteredRegistry = useMemo(() => {
        const q = searchTerm.trim().toLowerCase()
        return registry
            .filter(r => !presetPackageNames.has(r.name))
            .filter(r => !existingNames.has(prettyName(r.name)))
            .filter(r => {
                if (!q) return true
                return (
                    r.name.toLowerCase().includes(q)
                    || (r.description || '').toLowerCase().includes(q)
                    || r.keywords.some(k => k.toLowerCase().includes(q))
                )
            })
    }, [registry, searchTerm, presetPackageNames, existingNames])

    const handleRegistryAdd = async (entry: RegistryEntry) => {
        setAddingPkg(entry.name)
        try {
            await apiClient.mcp.addServer({
                name: prettyName(entry.name),
                command: 'npx',
                args: ['-y', entry.name],
            })
            fetchServers()
            toast(`Added ${prettyName(entry.name)} server`, 'success')
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Failed to add server', 'error')
        } finally { setAddingPkg(null) }
    }

    return (
        <div className="h-full flex flex-col text-white overflow-hidden pb-4">
            <PageHeader>
                <div className="flex items-center gap-3">
                    <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted group-focus-within:text-blue-400 transition-colors" />
                        <input
                            type="text"
                            placeholder="Search servers..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="bg-black/40 border border-outline rounded-lg pl-9 pr-4 py-2 text-sm text-white outline-none focus:border-blue-500/50 w-64 transition-all"
                        />
                    </div>
                    <button
                        onClick={() => setShowAdd(!showAdd)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        {t('mcp.addServer')}
                    </button>
                </div>
            </PageHeader>

            <div className="flex-1 overflow-y-auto space-y-6">
                {/* Add Server Form */}
                {showAdd && (
                    <Card className="p-5 bg-black/20 border-outline-subtle">
                        <h3 className="text-[11px] font-bold text-foreground-muted uppercase tracking-wide mb-4">Custom Server</h3>
                        <div className="grid grid-cols-3 gap-3 mb-3">
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold text-foreground-muted uppercase">{t('mcp.serverName')}</label>
                                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="my-server"
                                    className="bg-black/40 border border-outline rounded px-2 py-1.5 text-sm text-white outline-none focus:border-blue-500" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold text-foreground-muted uppercase">Command</label>
                                <input value={newCommand} onChange={(e) => setNewCommand(e.target.value)} placeholder="npx or python"
                                    className="bg-black/40 border border-outline rounded px-2 py-1.5 text-sm text-white outline-none focus:border-blue-500" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold text-foreground-muted uppercase">Args (space-separated)</label>
                                <input value={newArgs} onChange={(e) => setNewArgs(e.target.value)} placeholder="-y @org/server /path"
                                    className="bg-black/40 border border-outline rounded px-2 py-1.5 text-sm text-white outline-none focus:border-blue-500" />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button type="button" onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs text-foreground-muted hover:text-foreground transition-colors">{t('common.cancel')}</button>
                            <button type="button" onClick={handleAdd} disabled={adding || !newName.trim() || !newCommand.trim()}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                                {adding ? 'Adding...' : 'Add'}
                            </button>
                        </div>
                    </Card>
                )}

                {/* Connected Servers */}
                <div>
                    <h3 className="text-[11px] font-bold text-foreground-muted uppercase tracking-wide mb-3 px-1">
                        {t('mcp.connected')}
                        <span className="ml-2 text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full font-bold">{servers.length}</span>
                    </h3>
                    {loading ? (
                        <div className="space-y-2">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="rounded-xl border border-outline-subtle bg-black/20 p-4 flex items-center gap-3 animate-pulse">
                                    <div className="w-8 h-8 rounded-lg bg-hover shrink-0" />
                                    <div className="flex-1 space-y-1.5">
                                        <div className="h-3 bg-hover rounded w-1/3" />
                                        <div className="h-2.5 bg-hover rounded w-1/2" />
                                    </div>
                                    <div className="w-10 h-5 bg-hover rounded-full shrink-0" />
                                </div>
                            ))}
                        </div>
                    ) : servers.length === 0 ? (
                        <Card className="p-8 text-center bg-black/20 border-outline-subtle">
                            <Server className="w-8 h-8 text-foreground-subtle mx-auto mb-2" />
                            <p className="text-sm text-foreground-muted">{t('mcp.noServers')}</p>
                            <p className="text-[11px] text-foreground-subtle mt-1 max-w-xs mx-auto">
                                Pick one from the curated grid below, browse the live npm catalog, or use "+ Add Server" to register a custom command.
                            </p>
                            <button
                                type="button"
                                onClick={() => setShowAdd(true)}
                                className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-accent-foreground text-xs font-semibold rounded-md transition-colors"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                {t('mcp.addServer')}
                            </button>
                        </Card>
                    ) : (
                        <div className="space-y-2">
                            {servers.filter(s => searchTerm === '' || s.name.toLowerCase().includes(searchTerm.toLowerCase())).map(s => (
                                <Card key={s.id} className="bg-black/20 border-outline-subtle overflow-hidden">
                                    <div className="flex items-center gap-3 px-4 py-3">
                                        <button onClick={() => handleToggleTools(s.id)} className="text-foreground-muted hover:text-foreground transition-colors">
                                            {expandedServer === s.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                        </button>
                                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                                            <Server size={14} className="text-blue-400" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm text-white font-semibold">{s.name}</div>
                                            <div className="text-[10px] text-foreground-subtle truncate font-mono">{s.command} {s.args.join(' ')}</div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {serverTools[s.id] && (
                                                <span className="text-[10px] bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full font-bold mr-2">
                                                    {serverTools[s.id].length} {t('mcp.tools').toLowerCase()}
                                                </span>
                                            )}
                                            <button onClick={() => handleToggleTools(s.id)} disabled={testing === s.id}
                                                className="text-[10px] text-blue-400 hover:text-blue-300 px-2 py-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                                                {testing === s.id ? 'Connecting...' : 'Discover'}
                                            </button>
                                            <button onClick={() => handleRemove(s.id)} title="Remove server"
                                                className="p-1.5 text-foreground-subtle hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                    {expandedServer === s.id && serverTools[s.id] && (
                                        <div className="border-t border-outline-subtle px-4 py-3 bg-black/20">
                                            {serverTools[s.id].length === 0 ? (
                                                <p className="text-xs text-foreground-muted">No tools exposed by this server.</p>
                                            ) : (
                                                <div className="space-y-2">
                                                    {serverTools[s.id].map(tool => (
                                                        <div key={tool.name} className="flex items-start gap-3 p-2 rounded-lg hover:bg-hover">
                                                            <div className="flex-1 min-w-0">
                                                                <div className="text-xs text-white font-semibold font-mono">{tool.name}</div>
                                                                <div className="text-[10px] text-foreground-muted mt-0.5">{tool.description || 'No description'}</div>
                                                            </div>
                                                            <button onClick={() => handleTestTool(s.id, tool.name)}
                                                                className="flex items-center gap-1 px-2 py-1 text-[10px] text-green-400 hover:bg-green-500/10 rounded transition-colors shrink-0">
                                                                <Play size={10} /> Test
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </Card>
                            ))}
                        </div>
                    )}
                </div>

                {/* Server Catalog */}
                {filteredPresets.length > 0 && (
                    <div>
                        <h3 className="text-[11px] font-bold text-foreground-muted uppercase tracking-wide mb-3 px-1">Server Catalog</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {filteredPresets.map(preset => (
                                <Card key={preset.name} className="p-4 bg-black/20 border-outline-subtle hover:border-outline transition-colors group">
                                    <div className="flex items-start gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center border border-outline-subtle shrink-0">
                                            <Server size={14} className="text-foreground-muted" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm text-white font-semibold">{preset.name}</div>
                                            <div className="text-[10px] text-foreground-muted mt-0.5">{preset.description}</div>
                                            <div className="text-[10px] text-foreground-disabled font-mono mt-1 truncate">{preset.command} {preset.args}</div>
                                        </div>
                                    </div>
                                    <div className="flex justify-end mt-3">
                                        <button onClick={() => handleQuickAdd(preset)} disabled={adding}
                                            className="flex items-center gap-1 px-3 py-1 text-[10px] font-bold text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                                            <Plus size={10} /> Add
                                        </button>
                                    </div>
                                </Card>
                            ))}
                        </div>
                        <p className="text-[10px] text-foreground-subtle mt-3 px-1 flex items-center gap-1">
                            <ExternalLink size={10} />
                            Browse more servers at modelcontextprotocol.io
                        </p>
                    </div>
                )}

                {/* Live npm catalog */}
                <div>
                    <div className="flex items-center gap-2 mb-3 px-1">
                        <Package size={11} className="text-foreground-muted" />
                        <h3 className="text-[11px] font-bold text-foreground-muted uppercase tracking-wide">
                            From npm
                            {!registryLoading && registry.length > 0 && (
                                <span className="ml-2 text-[10px] bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded-full font-bold">{filteredRegistry.length}</span>
                            )}
                        </h3>
                        {registryLoading && <Loader2 size={11} className="animate-spin text-foreground-muted" />}
                    </div>
                    {registryError ? (
                        <Card className="p-4 bg-black/20 border-outline-subtle text-[11px] text-foreground-muted">
                            {registryError} — <button type="button" onClick={fetchRegistry} className="text-accent hover:underline">retry</button>
                        </Card>
                    ) : registryLoading && registry.length === 0 ? (
                        <Card className="p-6 text-center bg-black/20 border-outline-subtle">
                            <Loader2 className="w-5 h-5 text-foreground-muted mx-auto animate-spin" />
                            <p className="text-[11px] text-foreground-muted mt-2">Fetching live MCP catalog from npm…</p>
                        </Card>
                    ) : filteredRegistry.length === 0 ? (
                        <Card className="p-4 bg-black/20 border-outline-subtle">
                            <p className="text-[11px] text-foreground-muted">
                                {searchTerm
                                    ? `No npm packages match "${searchTerm}".`
                                    : 'No additional packages available right now.'}
                            </p>
                        </Card>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                            {filteredRegistry.map(entry => (
                                <Card key={entry.name} className="p-3 bg-black/20 border-outline-subtle hover:border-outline transition-colors">
                                    <div className="flex items-start gap-2.5">
                                        <div className="w-7 h-7 rounded-md bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                                            <Package size={12} className="text-purple-400" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[12px] text-foreground font-semibold truncate">{prettyName(entry.name)}</span>
                                                {entry.version && (
                                                    <span className="text-[9px] text-foreground-subtle font-mono shrink-0">v{entry.version}</span>
                                                )}
                                            </div>
                                            <div className="text-[10px] text-foreground-muted mt-0.5 line-clamp-2">{entry.description || 'No description provided.'}</div>
                                            <div className="text-[9px] text-foreground-disabled font-mono mt-1 truncate" title={entry.name}>{entry.name}</div>
                                        </div>
                                    </div>
                                    <div className="flex justify-between items-center mt-2.5">
                                        {entry.repository ? (
                                            <a
                                                href={entry.repository}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-[10px] text-foreground-subtle hover:text-foreground-muted inline-flex items-center gap-1"
                                            >
                                                <ExternalLink size={9} /> repo
                                            </a>
                                        ) : <span />}
                                        <button
                                            type="button"
                                            onClick={() => handleRegistryAdd(entry)}
                                            disabled={addingPkg === entry.name}
                                            className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-accent hover:bg-accent-muted rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {addingPkg === entry.name
                                                ? <><Loader2 size={9} className="animate-spin" /> Adding…</>
                                                : <><Plus size={10} /> Add</>}
                                        </button>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
