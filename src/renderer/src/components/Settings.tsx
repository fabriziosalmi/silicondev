import { useState, useEffect } from 'react'
import { Card } from './ui/Card'
import { apiClient } from '../api/client'
import { Settings2, MessageSquare, Brain, RotateCcw, Info, Server, Plus, Trash2, Loader2 } from 'lucide-react'

const CHAT_SETTINGS_KEY = 'silicon-studio-chat-settings'
const RAG_SETTINGS_KEY = 'silicon-studio-rag-settings'

interface ChatDefaults {
    systemPrompt: string
    temperature: number
    maxTokens: number
    maxContext: number
    topP: number
    repetitionPenalty: number
    reasoningMode: 'off' | 'auto' | 'low' | 'high'
    webSearchEnabled: boolean
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
}

const defaultRag: RagDefaults = {
    chunkSize: 512,
    chunkOverlap: 50,
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

export function Settings() {
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

    // Persist RAG settings on change
    useEffect(() => {
        localStorage.setItem(RAG_SETTINGS_KEY, JSON.stringify(rag))
    }, [rag])

    const updateChat = <K extends keyof ChatDefaults>(key: K, value: ChatDefaults[K]) => {
        setChat(prev => ({ ...prev, [key]: value }))
    }

    const handleReset = () => {
        if (!confirm('Reset all settings to defaults?')) return
        setChat({ ...defaultChat })
        setRag({ ...defaultRag })
        localStorage.removeItem(CHAT_SETTINGS_KEY)
        localStorage.removeItem(RAG_SETTINGS_KEY)
    }

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Settings2 size={20} className="text-blue-400" />
                    <h2 className="text-lg font-bold text-white">Settings</h2>
                </div>
            </div>

            {/* General */}
            <Card className="p-5">
                <SectionHeader icon={<Info size={16} />} title="General" />
                <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-500 uppercase">Backend URL</label>
                        <div className="flex items-center px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm text-gray-400">
                            http://127.0.0.1:8000
                        </div>
                        <span className="text-[10px] text-gray-600">Read-only. Configured at build time.</span>
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
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={chat.webSearchEnabled}
                                onChange={(e) => updateChat('webSearchEnabled', e.target.checked)}
                                className="accent-blue-500"
                            />
                            <span className="text-sm text-gray-300">Enable web search by default</span>
                        </label>
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

            {/* MCP Servers */}
            <MCPServersSection />

            {/* About / Reset */}
            <Card className="p-5">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-bold text-white">Silicon Studio</h3>
                        <p className="text-xs text-gray-500 mt-1">Local AI development environment for Apple Silicon</p>
                    </div>
                    <button
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
