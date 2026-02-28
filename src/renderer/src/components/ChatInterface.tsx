import { useState, useEffect, useRef } from 'react'
import { apiClient } from '../api/client'
import { PageHeader } from './ui/PageHeader'
import { MessageSquare, Settings2, SlidersHorizontal, Cpu, Copy, Check, Paperclip, Eraser, Send, Mic, Brain, Zap, Clock, BarChart3 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { useGlobalState } from '../context/GlobalState'

interface Message {
    id?: string
    role: 'system' | 'user' | 'assistant'
    content: string
    stats?: {
        tokensPerSecond: number;
        timeToFirstToken: number;
        totalTokens: number;
    }
}

interface Model {
    id: string
    name: string
    is_custom?: boolean
    is_finetuned?: boolean
}

const CHAT_STORAGE_KEY = 'silicon-studio-chat-history';
const SETTINGS_STORAGE_KEY = 'silicon-studio-chat-settings';

export function ChatInterface() {
    const { activeModel } = useGlobalState()

    // Chat State
    const [messages, setMessages] = useState<Message[]>(() => {
        try {
            const saved = localStorage.getItem(CHAT_STORAGE_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    })
    const [input, setInput] = useState('')
    const messagesEndRef = useRef<HTMLDivElement>(null)

    // Models State for dropdown fallback
    const [models, setModels] = useState<Model[]>([])
    const [selectedModelId, setSelectedModelId] = useState<string>('')

    // Settings State
    const [showSettings, setShowSettings] = useState(true)
    const [settings, setSettings] = useState(() => {
        try {
            const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
            return saved ? JSON.parse(saved) : {
                systemPrompt: "You are a helpful, brilliant AI assistant running locally on Apple Silicon.",
                temperature: 0.7,
                maxTokens: 1024,
                maxContext: 4096,
                topP: 0.9,
                repetitionPenalty: 1.1
            };
        } catch {
            return {
                systemPrompt: "You are a helpful, brilliant AI assistant running locally on Apple Silicon.",
                temperature: 0.7,
                maxTokens: 1024,
                maxContext: 4096,
                topP: 0.9,
                repetitionPenalty: 1.1
            };
        }
    })

    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
    const [isListening, setIsListening] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false)

    // Persist changes
    useEffect(() => {
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
    }, [messages]);

    useEffect(() => {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    }, [settings]);

    useEffect(() => {
        // Fetch available models as fallback if activeModel is not set
        apiClient.engine.getModels().then((data: any[]) => {
            const playable = data.filter(m => m.downloaded || m.is_custom || m.is_finetuned);
            setModels(playable)
            if (playable.length > 0 && !activeModel) setSelectedModelId(playable[0].id)
        }).catch(console.error)
    }, [activeModel])

    // Use activeModel if available, else fallback to dropdown selection
    const currentModelId = activeModel ? activeModel.id : selectedModelId;

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    const handleClearChat = () => {
        if (window.confirm("Are you sure you want to clear the entire chat history?")) {
            setMessages([]);
            localStorage.removeItem(CHAT_STORAGE_KEY);
        }
    };

    const handleStop = async () => {
        try {
            await apiClient.engine.stopChat();
            setIsGenerating(false);
        } catch (e) {
            console.error("Failed to stop generation", e);
        }
    }

    const handleSend = async () => {
        if (!input.trim() || !currentModelId || isGenerating) return

        const userMsg: Message = { role: 'user', content: input }
        const systemMsg: Message | null = settings.systemPrompt?.trim()
            ? { role: 'system', content: settings.systemPrompt.trim() }
            : null
        const conversation = [
            ...(systemMsg ? [systemMsg] : []),
            ...messages,
            userMsg
        ]
        setMessages(prev => [...prev, userMsg])
        setInput('')
        setIsGenerating(true)

        const assistantMsgId = Date.now().toString()
        const initialAssistantMsg: Message = {
            role: 'assistant',
            content: '',
            id: assistantMsgId,
            stats: { tokensPerSecond: 0, timeToFirstToken: 0, totalTokens: 0 }
        }
        setMessages(prev => [...prev, initialAssistantMsg])

        try {
            const startTime = Date.now()
            let firstTokenTime = 0
            let tokenCount = 0

            const response = await fetch(`${apiClient.API_BASE}/api/engine/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model_id: currentModelId,
                    messages: conversation.map(m => ({ role: m.role, content: m.content })),
                    temperature: settings.temperature,
                    max_tokens: settings.maxTokens,
                    top_p: settings.topP,
                    repetition_penalty: settings.repetitionPenalty
                })
            })

            if (!response.ok) {
                const errBody = await response.text()
                throw new Error(errBody || `HTTP ${response.status}`)
            }

            const reader = response.body?.getReader()
            const decoder = new TextDecoder()
            let accumulated = ""
            let lineBuffer = ""

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break

                    lineBuffer += decoder.decode(value, { stream: true })
                    const lines = lineBuffer.split('\n')
                    lineBuffer = lines.pop() ?? ''

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const dataString = line.slice(6).trim()
                            if (!dataString) continue

                            let data: any
                            try {
                                data = JSON.parse(dataString)
                            } catch {
                                continue
                            }

                            if (data.error) throw new Error(data.error)

                            if (data.text) {
                                if (tokenCount === 0) {
                                    firstTokenTime = (Date.now() - startTime) / 1000
                                }
                                accumulated += data.text
                                tokenCount++

                                setMessages(prev => prev.map(m =>
                                    m.id === assistantMsgId
                                        ? {
                                            ...m,
                                            content: accumulated,
                                            stats: {
                                                tokensPerSecond: parseFloat((tokenCount / ((Date.now() - startTime) / 1000)).toFixed(1)),
                                                timeToFirstToken: parseFloat(firstTokenTime.toFixed(2)),
                                                totalTokens: tokenCount
                                            }
                                        }
                                        : m
                                ))
                            }
                            if (data.done) break
                        }
                    }
                }
            }
        } catch (err: any) {
            console.error(err)
            setMessages(prev => prev.map(m =>
                m.id === assistantMsgId ? { ...m, content: `Error: ${err.message}` } : m
            ))
        } finally {
            setIsGenerating(false)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
    }

    const copyToClipboard = (text: string, index: number) => {
        navigator.clipboard.writeText(text);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
    }

    return (
        <div className="h-full flex flex-col text-white overflow-hidden pb-4">
            <PageHeader
                title="Chat Workspace"
                description="Interact with local models with full markdown support and parameter control."
            >
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${showSettings ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white hover:bg-white/10'}`}
                    >
                        <Settings2 className="w-4 h-4" />
                        Parameters
                    </button>
                </div>
            </PageHeader>

            <div className="flex-1 flex gap-4 overflow-hidden min-h-0 pr-4">
                <div className="flex-1 flex flex-col bg-black/20 border border-white/10 rounded-xl overflow-hidden relative shadow-2xl">

                    {/* Model Selector Bar */}
                    <div className="p-3 border-b border-white/5 bg-white/[0.02] flex items-center justify-between z-20">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                                <Cpu className="w-4 h-4 text-blue-400" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Active Model</span>
                                <select
                                    className="bg-transparent text-sm font-bold text-gray-200 outline-none cursor-pointer hover:text-blue-400 transition-colors"
                                    value={currentModelId}
                                    onChange={(e) => setSelectedModelId(e.target.value)}
                                    disabled={!!activeModel || isGenerating}
                                >
                                    {models.map(m => (
                                        <option key={m.id} value={m.id} className="bg-[#18181B]">{m.name}</option>
                                    ))}
                                    {models.length === 0 && <option value="">No models available</option>}
                                </select>
                            </div>
                        </div>
                        {activeModel && (
                            <div className="flex items-center gap-2 bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20">
                                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                                <span className="text-[10px] font-bold text-green-400 uppercase tracking-widest">Loaded</span>
                            </div>
                        )}
                    </div>

                    {/* Messages Area */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                        {messages.length === 0 && (
                            <div className="h-full flex flex-col items-center justify-center opacity-20 pointer-events-none">
                                <MessageSquare className="w-16 h-16 mb-4" />
                                <p className="text-xl font-bold">Start a new conversation</p>
                                <p className="text-sm">Select a model and type your message below.</p>
                            </div>
                        )}
                        {messages.map((msg, idx) => {
                            // Parse thinking blocks for reasoning models (Qwen3, DeepSeek, etc.)
                            let thinkingContent = '';
                            let visibleContent = msg.content;

                            if (msg.role === 'assistant') {
                                const thinkMatch = msg.content.match(/<think>([\s\S]*?)(<\/think>|$)/);
                                if (thinkMatch) {
                                    thinkingContent = thinkMatch[1].trim();
                                    // Remove the entire <think>...</think> block from visible content
                                    visibleContent = msg.content.replace(/<think>[\s\S]*?(<\/think>|$)/, '').trim();
                                }
                            }

                            return (
                                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300 group`}>
                                    <div className={`max-w-[85%] relative rounded-2xl px-5 py-4 shadow-xl ${msg.role === 'user'
                                        ? 'bg-blue-600 text-white rounded-tr-sm'
                                        : 'bg-[#18181B] border border-white/10 text-gray-200 rounded-tl-sm'
                                        }`}>
                                        {msg.role === 'assistant' && (
                                            <button
                                                onClick={() => copyToClipboard(msg.content, idx)}
                                                className="absolute top-2 right-2 p-1.5 text-gray-500 hover:text-white opacity-0 group-hover:opacity-100 transition-all rounded bg-white/5"
                                            >
                                                {copiedIndex === idx ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                                            </button>
                                        )}

                                        {/* Thinking/Reasoning Block */}
                                        {msg.role === 'assistant' && thinkingContent && (
                                            <details className="mb-3 group/think">
                                                <summary className="flex items-center gap-2 cursor-pointer text-[11px] font-bold text-purple-400 uppercase tracking-widest select-none hover:text-purple-300 transition-colors py-1">
                                                    <Brain className="w-4 h-4" />
                                                    <span>Reasoning</span>
                                                    <span className="text-[9px] text-gray-600 font-normal normal-case tracking-normal ml-1">
                                                        ({thinkingContent.split(/\s+/).length} words)
                                                    </span>
                                                    <span className="ml-auto text-[10px] text-gray-600 group-open/think:hidden">▸ Show</span>
                                                    <span className="ml-auto text-[10px] text-gray-600 hidden group-open/think:inline">▾ Hide</span>
                                                </summary>
                                                <div className="mt-2 p-3 bg-purple-500/5 border border-purple-500/10 rounded-lg text-[12px] text-gray-400 leading-relaxed max-h-[300px] overflow-y-auto custom-scrollbar">
                                                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                                                        {thinkingContent}
                                                    </ReactMarkdown>
                                                </div>
                                            </details>
                                        )}

                                        {/* Visible Response */}
                                        <div className="prose prose-invert prose-sm max-w-none prose-pre:bg-black/40 prose-pre:border prose-pre:border-white/5">
                                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                                                {visibleContent}
                                            </ReactMarkdown>
                                        </div>

                                        {msg.role === 'assistant' && msg.stats && msg.stats.totalTokens > 0 && (
                                            <div className="mt-3 pt-3 border-t border-white/5 flex gap-4 text-[10px] font-mono text-gray-500 uppercase tracking-widest">
                                                <span title="Tokens Per Second" className="flex items-center gap-1"><Zap className="w-3 h-3" /> {msg.stats.tokensPerSecond} t/s</span>
                                                <span title="Time To First Token" className="flex items-center gap-1"><Clock className="w-3 h-3" /> {msg.stats.timeToFirstToken}s ttft</span>
                                                <span title="Total Tokens Generated" className="flex items-center gap-1"><BarChart3 className="w-3 h-3" /> {msg.stats.totalTokens} tkns</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input Area */}
                    <div className="p-4 bg-black/40 border-t border-white/5 backdrop-blur-md">
                        <div className="relative flex items-end gap-2 max-w-5xl mx-auto">
                            {messages.length > 0 && (
                                <button
                                    onClick={handleClearChat}
                                    className="p-3.5 mb-0.5 rounded-xl bg-white/5 hover:bg-red-500/10 text-gray-500 hover:text-red-400 border border-white/5 hover:border-red-500/20 transition-all shrink-0 group"
                                    title="Clear chat history"
                                >
                                    <Eraser className="w-5 h-5 transition-transform group-hover:scale-110" />
                                </button>
                            )}
                            <div className="relative flex-1 bg-black/40 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-[inset_0_2px_10px_rgba(255,255,255,0.02),0_4px_20px_rgba(0,0,0,0.5)] focus-within:border-blue-500/50 focus-within:ring-2 focus-within:ring-blue-500/30 transition-all duration-300 flex items-center">
                                <div className="absolute left-2 bottom-2">
                                    <button
                                        className="p-2 rounded-lg text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 transition-all"
                                        title="Attach file"
                                    >
                                        <Paperclip className="w-5 h-5" />
                                    </button>
                                </div>
                                <textarea
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder={isGenerating ? "Generation in progress..." : "Type a message..."}
                                    disabled={isGenerating}
                                    className={`flex-1 bg-transparent pl-12 pr-28 py-4 text-sm text-white placeholder-gray-500 outline-none transition-all resize-none min-h-[56px] max-h-[200px] custom-scrollbar ${isGenerating ? 'opacity-50' : ''}`}
                                    rows={1}
                                />
                                <div className="absolute right-2 bottom-2 flex items-center gap-2">
                                    <button
                                        onClick={() => setIsListening(!isListening)}
                                        className={`p-2 rounded-lg transition-all ${isListening ? 'bg-red-500/20 text-red-500 animate-pulse' : 'bg-transparent text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}
                                        title="Voice Input"
                                    >
                                        <Mic className="w-5 h-5" />
                                    </button>

                                    {isGenerating ? (
                                        <button
                                            onClick={handleStop}
                                            className="p-2.5 bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white rounded-xl transition-all border border-red-500/20 group"
                                            title="Stop Generation"
                                        >
                                            <div className="w-4 h-4 bg-current rounded-sm group-hover:scale-90 transition-transform" />
                                        </button>
                                    ) : (
                                        <button
                                            onClick={handleSend}
                                            disabled={!input.trim() || !currentModelId}
                                            className={`p-2.5 rounded-xl transition-all ${input.trim() && currentModelId ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:scale-105 active:scale-95' : 'bg-white/5 text-gray-600 cursor-not-allowed'}`}
                                        >
                                            <Send className="w-5 h-5" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Parameter Sidebar */}
                {showSettings && (
                    <div className="w-80 bg-black/20 border border-white/10 rounded-xl flex flex-col shrink-0 overflow-y-auto custom-scrollbar animate-in slide-in-from-right-4 duration-200">
                        <div className="p-4 border-b border-white/5 bg-white/[0.02] flex items-center gap-2 sticky top-0 backdrop-blur-md z-10">
                            <SlidersHorizontal className="w-4 h-4 text-blue-400" />
                            <h3 className="font-semibold text-sm uppercase tracking-widest text-gray-400">Parameters</h3>
                        </div>

                        <div className="p-5 space-y-6">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Temperature</label>
                                        <span className="text-xs font-mono text-blue-400">{settings.temperature.toFixed(2)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0" max="2" step="0.05"
                                        value={settings.temperature}
                                        onChange={(e) => setSettings({ ...settings, temperature: parseFloat(e.target.value) })}
                                        className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Max Tokens</label>
                                        <span className="text-xs font-mono text-blue-400">{settings.maxTokens}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="64" max="8192" step="64"
                                        value={settings.maxTokens}
                                        onChange={(e) => setSettings({ ...settings, maxTokens: parseInt(e.target.value) })}
                                        className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                    />
                                </div>

                                <div className="space-y-2 border-t border-white/5 pt-4">
                                    <div className="flex justify-between items-center">
                                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Top-P</label>
                                        <span className="text-xs font-mono text-purple-400">{settings.topP.toFixed(2)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0" max="1" step="0.05"
                                        value={settings.topP}
                                        onChange={(e) => setSettings({ ...settings, topP: parseFloat(e.target.value) })}
                                        className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-purple-500"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Rep. Penalty</label>
                                        <span className="text-xs font-mono text-purple-400">{settings.repetitionPenalty.toFixed(2)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0.5" max="2" step="0.05"
                                        value={settings.repetitionPenalty}
                                        onChange={(e) => setSettings({ ...settings, repetitionPenalty: parseFloat(e.target.value) })}
                                        className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-purple-500"
                                    />
                                </div>
                            </div>

                            <div className="pt-6 border-t border-white/5">
                                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-2">System Instructions</label>
                                <textarea
                                    value={settings.systemPrompt}
                                    onChange={(e) => setSettings({ ...settings, systemPrompt: e.target.value })}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-gray-300 h-32 resize-none outline-none focus:border-blue-500/50"
                                    placeholder="Set model behavior..."
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
