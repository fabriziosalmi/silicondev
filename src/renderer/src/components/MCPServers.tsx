import { useState, useEffect } from 'react'
import { PageHeader } from './ui/PageHeader'
import { Card } from './ui/Card'
import { Server, Plus, Trash2, Play, ChevronDown, ChevronRight, Search, ExternalLink } from 'lucide-react'
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

const POPULAR_SERVERS = [
    { name: 'Filesystem', command: 'npx', args: '-y @modelcontextprotocol/server-filesystem /tmp', description: 'Read, write, and manage files on disk' },
    { name: 'Memory', command: 'npx', args: '-y @modelcontextprotocol/server-memory', description: 'Persistent key-value memory for conversations' },
    { name: 'Brave Search', command: 'npx', args: '-y @modelcontextprotocol/server-brave-search', description: 'Web search via Brave Search API' },
    { name: 'GitHub', command: 'npx', args: '-y @modelcontextprotocol/server-github', description: 'GitHub repos, issues, and PRs' },
    { name: 'PostgreSQL', command: 'npx', args: '-y @modelcontextprotocol/server-postgres', description: 'Query PostgreSQL databases' },
    { name: 'SQLite', command: 'npx', args: '-y @modelcontextprotocol/server-sqlite', description: 'Query SQLite databases' },
]

export function MCPServers() {
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
    const { toast } = useToast()

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
        if (!window.confirm('Remove this MCP server?')) return
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

    const existingNames = new Set(servers.map(s => s.name))
    const filteredPresets = POPULAR_SERVERS.filter(p =>
        !existingNames.has(p.name) &&
        (searchTerm === '' || p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.description.toLowerCase().includes(searchTerm.toLowerCase()))
    )

    return (
        <div className="h-full flex flex-col text-white overflow-hidden pb-4">
            <PageHeader>
                <div className="flex items-center gap-3">
                    <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within:text-blue-400 transition-colors" />
                        <input
                            type="text"
                            placeholder="Search servers..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="bg-black/40 border border-white/10 rounded-lg pl-9 pr-4 py-2 text-sm text-white outline-none focus:border-blue-500/50 w-64 transition-all"
                        />
                    </div>
                    <button
                        onClick={() => setShowAdd(!showAdd)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        Add Server
                    </button>
                </div>
            </PageHeader>

            <div className="flex-1 overflow-y-auto space-y-6">
                {/* Add Server Form */}
                {showAdd && (
                    <Card className="p-5 bg-black/20 border-white/5">
                        <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-4">Custom Server</h3>
                        <div className="grid grid-cols-3 gap-3 mb-3">
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold text-gray-500 uppercase">Name</label>
                                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="my-server"
                                    className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-blue-500" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold text-gray-500 uppercase">Command</label>
                                <input value={newCommand} onChange={(e) => setNewCommand(e.target.value)} placeholder="npx or python"
                                    className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-blue-500" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold text-gray-500 uppercase">Args (space-separated)</label>
                                <input value={newArgs} onChange={(e) => setNewArgs(e.target.value)} placeholder="-y @org/server /path"
                                    className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-blue-500" />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors">Cancel</button>
                            <button onClick={handleAdd} disabled={adding || !newName.trim() || !newCommand.trim()}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                                {adding ? 'Adding...' : 'Add'}
                            </button>
                        </div>
                    </Card>
                )}

                {/* Connected Servers */}
                <div>
                    <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3 px-1">
                        Connected Servers
                        <span className="ml-2 text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full font-bold">{servers.length}</span>
                    </h3>
                    {loading ? (
                        <Card className="p-8 text-center bg-black/20 border-white/5">
                            <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto" />
                        </Card>
                    ) : servers.length === 0 ? (
                        <Card className="p-8 text-center bg-black/20 border-white/5">
                            <Server className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                            <p className="text-sm text-gray-500">No servers connected. Add one above or pick from the catalog below.</p>
                        </Card>
                    ) : (
                        <div className="space-y-2">
                            {servers.filter(s => searchTerm === '' || s.name.toLowerCase().includes(searchTerm.toLowerCase())).map(s => (
                                <Card key={s.id} className="bg-black/20 border-white/5 overflow-hidden">
                                    <div className="flex items-center gap-3 px-4 py-3">
                                        <button onClick={() => handleToggleTools(s.id)} className="text-gray-500 hover:text-white transition-colors">
                                            {expandedServer === s.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                        </button>
                                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                                            <Server size={14} className="text-blue-400" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm text-white font-semibold">{s.name}</div>
                                            <div className="text-[10px] text-gray-600 truncate font-mono">{s.command} {s.args.join(' ')}</div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {serverTools[s.id] && (
                                                <span className="text-[10px] bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full font-bold mr-2">
                                                    {serverTools[s.id].length} tools
                                                </span>
                                            )}
                                            <button onClick={() => handleToggleTools(s.id)} disabled={testing === s.id}
                                                className="text-[10px] text-blue-400 hover:text-blue-300 px-2 py-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                                                {testing === s.id ? 'Connecting...' : 'Discover'}
                                            </button>
                                            <button onClick={() => handleRemove(s.id)} title="Remove server"
                                                className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                    {expandedServer === s.id && serverTools[s.id] && (
                                        <div className="border-t border-white/5 px-4 py-3 bg-black/20">
                                            {serverTools[s.id].length === 0 ? (
                                                <p className="text-xs text-gray-500">No tools exposed by this server.</p>
                                            ) : (
                                                <div className="space-y-2">
                                                    {serverTools[s.id].map(tool => (
                                                        <div key={tool.name} className="flex items-start gap-3 p-2 rounded-lg hover:bg-white/[0.02]">
                                                            <div className="flex-1 min-w-0">
                                                                <div className="text-xs text-white font-semibold font-mono">{tool.name}</div>
                                                                <div className="text-[10px] text-gray-500 mt-0.5">{tool.description || 'No description'}</div>
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
                        <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3 px-1">Server Catalog</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {filteredPresets.map(preset => (
                                <Card key={preset.name} className="p-4 bg-black/20 border-white/5 hover:border-white/10 transition-colors group">
                                    <div className="flex items-start gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center border border-white/5 shrink-0">
                                            <Server size={14} className="text-gray-400" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm text-white font-semibold">{preset.name}</div>
                                            <div className="text-[10px] text-gray-500 mt-0.5">{preset.description}</div>
                                            <div className="text-[10px] text-gray-700 font-mono mt-1 truncate">{preset.command} {preset.args}</div>
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
                        <p className="text-[10px] text-gray-600 mt-3 px-1 flex items-center gap-1">
                            <ExternalLink size={10} />
                            Browse more servers at modelcontextprotocol.io
                        </p>
                    </div>
                )}
            </div>
        </div>
    )
}
