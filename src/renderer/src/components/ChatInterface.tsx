import { useState, useEffect, useRef } from 'react'
import { apiClient } from '../api/client'
import { PageHeader } from './ui/PageHeader'
import { Settings2, SlidersHorizontal, Cpu, Copy, Check, Eraser, ChevronRight, Square, ArrowUp, Wand2, Shield, Zap, FileText, TestTube2, Expand, Shrink, Languages, Briefcase, MessageCircle, GraduationCap } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { useGlobalState } from '../context/GlobalState'

interface Message {
    id?: string
    role: 'system' | 'user' | 'assistant'
    content: string
    displayContent?: string
    stats?: {
        tokensPerSecond: number;
        timeToFirstToken: number;
        totalTokens: number;
    }
}

const CHAT_STORAGE_KEY = 'silicon-studio-chat-history';
const SETTINGS_STORAGE_KEY = 'silicon-studio-chat-settings';

export function ChatInterface() {
    const { activeModel } = useGlobalState()

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
    const textareaRef = useRef<HTMLTextAreaElement>(null)


    const [showSettings, setShowSettings] = useState(false)
    const [settings, setSettings] = useState(() => {
        const defaults = {
            systemPrompt: "You are a helpful AI assistant running locally on Apple Silicon.",
            temperature: 0.7,
            maxTokens: 2048,
            maxContext: 4096,
            topP: 0.9,
            repetitionPenalty: 1.1,
            reasoningMode: 'auto' as 'off' | 'auto' | 'low' | 'high',
        };
        try {
            const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
            return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
        } catch {
            return defaults;
        }
    })

    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
    const [isGenerating, setIsGenerating] = useState(false)

    // Dynamic defaults: adjust maxTokens when a model with known context_window is loaded
    useEffect(() => {
        const cw = activeModel?.context_window;
        if (!cw) return;
        // Set maxTokens to half the context window, clamped between 2048 and 16384
        const recommended = Math.min(Math.max(Math.floor(cw / 2), 2048), 16384);
        setSettings((prev: Record<string, unknown>) => {
            // Only auto-adjust if user hasn't manually changed from a previous default
            // (i.e., the current value is one of the known static defaults)
            const isDefault = prev.maxTokens === 1024 || prev.maxTokens === 512 || prev.maxTokens === 2048;
            if (isDefault || (prev.maxTokens as number) > cw) {
                return { ...prev, maxTokens: recommended };
            }
            return prev;
        });
    }, [activeModel?.context_window]);

    useEffect(() => {
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
    }, [messages]);

    useEffect(() => {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    }, [settings]);

    const currentModelId = activeModel?.id ?? '';
    const currentModelName = activeModel?.name ?? '';

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = '0';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
        }
    }, [input])

    const handleClearChat = () => {
        if (window.confirm("Clear chat history?")) {
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

    const handleSend = async (directPrompt?: string, displayContent?: string) => {
        const text = directPrompt ?? input;
        if (!text.trim() || !currentModelId || isGenerating) return

        const userMsg: Message = { role: 'user', content: text, ...(displayContent && { displayContent }) }

        // Build system prompt with optional reasoning instructions
        let systemContent = settings.systemPrompt?.trim() || '';
        const reasoningInstructions: Record<string, string> = {
            off: '',
            auto: '',
            low: '\n\nBefore answering, briefly outline your reasoning in 2-3 sentences, then provide your response. Keep the reasoning concise.',
            high: '\n\nBefore answering, think through the problem step by step. Consider multiple angles, edge cases, and potential issues. Show your full reasoning process, then provide a thorough response.',
        };
        const cotSuffix = reasoningInstructions[settings.reasoningMode] || '';
        if (cotSuffix) systemContent += cotSuffix;

        const systemMsg: Message | null = systemContent
            ? { role: 'system', content: systemContent }
            : null
        const conversation = [
            ...(systemMsg ? [systemMsg] : []),
            ...messages,
            userMsg
        ]
        setMessages(prev => [...prev, userMsg])
        if (!directPrompt) setInput('')
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

    const sendCodeAction = (code: string, action: string) => {
        if (isGenerating || !currentModelId) return;
        const prompts: Record<string, string> = {
            improve: `Improve the following code. Make it cleaner, more readable, and more idiomatic. Return only the improved code with brief comments explaining what changed.\n\n\`\`\`\n${code}\n\`\`\``,
            secure: `Review the following code for security vulnerabilities. Fix any issues you find (injection, XSS, unsafe operations, etc). Return the secured code with comments on what was fixed.\n\n\`\`\`\n${code}\n\`\`\``,
            faster: `Optimize the following code for performance. Reduce unnecessary allocations, improve algorithmic complexity, or use more efficient APIs. Return the optimized code with comments on what changed.\n\n\`\`\`\n${code}\n\`\`\``,
            docs: `Add documentation to the following code. Add docstrings, type hints, and inline comments where helpful. Do NOT change any logic or behavior — only add documentation. Return the fully documented code.\n\n\`\`\`\n${code}\n\`\`\``,
            tests: `Write tests for the following code. Do NOT modify the original code. Generate a complete test file with good coverage of edge cases, typical usage, and error conditions. Use the most appropriate testing framework for the language.\n\n\`\`\`\n${code}\n\`\`\``,
        };
        const labels: Record<string, string> = {
            improve: 'Improve',
            secure: 'Secure',
            faster: 'Faster',
            docs: 'Docs',
            tests: 'Tests',
        };
        const lineCount = code.split('\n').length;
        const prompt = prompts[action];
        const display = `**${labels[action]}** — ${lineCount} lines`;
        if (prompt) handleSend(prompt, display);
    }

    const sendResponseAction = (response: string, action: string) => {
        if (isGenerating || !currentModelId) return;
        const browserLang = navigator.language.split('-')[0];
        const langName: Record<string, string> = { en: 'English', it: 'Italian', fr: 'French', de: 'German', es: 'Spanish', pt: 'Portuguese', ja: 'Japanese', zh: 'Chinese', ko: 'Korean' };
        const targetLang = langName[browserLang] || browserLang;

        const prompts: Record<string, string> = {
            longer: `Expand and elaborate on the following response. Add more detail, examples, and depth while keeping the same structure and meaning.\n\n---\n${response}\n---`,
            shorter: `Condense the following response to be much shorter and more concise. Keep only the essential points.\n\n---\n${response}\n---`,
            formal: `Rewrite the following response in a formal, professional tone. Keep the same content and meaning.\n\n---\n${response}\n---`,
            casual: `Rewrite the following response in a casual, friendly tone. Keep the same content and meaning.\n\n---\n${response}\n---`,
            technical: `Rewrite the following response in a precise, technical tone with proper terminology. Keep the same meaning.\n\n---\n${response}\n---`,
            translate: `Translate the following response to ${targetLang}. Preserve formatting, code blocks, and technical terms.\n\n---\n${response}\n---`,
        };
        const labels: Record<string, string> = {
            longer: 'Longer',
            shorter: 'Shorter',
            formal: 'Formal',
            casual: 'Casual',
            technical: 'Technical',
            translate: `Translate → ${targetLang}`,
        };
        const prompt = prompts[action];
        const wordCount = response.split(/\s+/).length;
        const display = `**${labels[action]}** — ${wordCount} words`;
        if (prompt) handleSend(prompt, display);
    }

    return (
        <div className="h-full flex flex-col text-white overflow-hidden pb-4">
            <PageHeader>
                <div className="flex items-center gap-2">
                    {messages.length > 0 && (
                        <button
                            onClick={handleClearChat}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:text-red-400 hover:bg-red-500/5 transition-colors"
                        >
                            <Eraser className="w-3.5 h-3.5" />
                            Clear
                        </button>
                    )}
                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${showSettings ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                    >
                        <Settings2 className="w-3.5 h-3.5" />
                        Parameters
                    </button>
                </div>
            </PageHeader>

            <div className="flex-1 flex gap-4 overflow-hidden min-h-0 pr-4">
                {/* Main Chat Area */}
                <div className="flex-1 flex flex-col overflow-hidden relative">

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto">
                        {messages.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center">
                                <div className="text-center max-w-md">
                                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-4">
                                        <Cpu className="w-5 h-5 text-gray-500" />
                                    </div>
                                    <p className="text-sm text-gray-400 mb-1">
                                        {currentModelName
                                            ? <>Ready with <span className="text-gray-200 font-medium">{currentModelName}</span></>
                                            : 'No model loaded'
                                        }
                                    </p>
                                    <p className="text-xs text-gray-600">
                                        {currentModelId
                                            ? 'Type a message below. Shift+Enter for newlines.'
                                            : 'Load a model from the Models tab to start chatting.'
                                        }
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="max-w-3xl mx-auto py-6 px-4">
                                {messages.map((msg, idx) => {
                                    let thinkingContent = '';
                                    let visibleContent = msg.content;

                                    if (msg.role === 'assistant') {
                                        const thinkMatch = msg.content.match(/<think>([\s\S]*?)(<\/think>|$)/);
                                        if (thinkMatch) {
                                            thinkingContent = thinkMatch[1].trim();
                                            visibleContent = msg.content.replace(/<think>[\s\S]*?(<\/think>|$)/, '').trim();
                                        }
                                    }

                                    if (msg.role === 'user') {
                                        return (
                                            <div key={idx} className="mb-6">
                                                <div className="flex items-start gap-3">
                                                    <div className="w-6 h-6 rounded-md bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                                                        <span className="text-[10px] font-bold text-gray-400">U</span>
                                                    </div>
                                                    {msg.displayContent ? (
                                                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-sm text-gray-300">
                                                            <Cpu className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                                                            <ReactMarkdown
                                                                remarkPlugins={[remarkGfm]}
                                                                components={{ p: ({ children }) => <span>{children}</span> }}
                                                            >
                                                                {msg.displayContent}
                                                            </ReactMarkdown>
                                                        </div>
                                                    ) : (
                                                        <div className="prose prose-invert prose-sm max-w-none text-gray-200 leading-relaxed prose-p:my-2 prose-pre:bg-black/30 prose-pre:border prose-pre:border-white/5 prose-pre:rounded-lg prose-code:text-blue-300 prose-code:font-normal prose-headings:font-semibold prose-headings:text-gray-100 min-w-0">
                                                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                                                                {msg.content}
                                                            </ReactMarkdown>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    }

                                    return (
                                        <div key={idx} className="mb-6 group">
                                            <div className="flex items-start gap-3">
                                                <div className="w-6 h-6 rounded-md bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5">
                                                    <span className="text-[10px] font-bold text-blue-400">AI</span>
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    {/* Reasoning trace */}
                                                    {thinkingContent && (
                                                        <details className="mb-3">
                                                            <summary className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-500 hover:text-gray-400 transition-colors select-none py-0.5">
                                                                <ChevronRight className="w-3 h-3 transition-transform details-open:rotate-90" />
                                                                <span>Reasoning</span>
                                                                <span className="text-gray-600 ml-1">
                                                                    {thinkingContent.split(/\s+/).length} words
                                                                </span>
                                                            </summary>
                                                            <div className="mt-2 pl-4 border-l border-white/5 text-xs text-gray-500 leading-relaxed max-h-64 overflow-y-auto">
                                                                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                                                                    {thinkingContent}
                                                                </ReactMarkdown>
                                                            </div>
                                                        </details>
                                                    )}

                                                    {/* Response */}
                                                    <div className="prose prose-invert prose-sm max-w-none text-gray-200 leading-relaxed prose-p:my-2 prose-pre:bg-transparent prose-pre:p-0 prose-pre:m-0 prose-code:text-blue-300 prose-code:font-normal prose-headings:font-semibold prose-headings:text-gray-100">
                                                        <ReactMarkdown
                                                            remarkPlugins={[remarkGfm, remarkBreaks]}
                                                            components={{
                                                                code({ className, children }) {
                                                                    const match = /language-(\w+)/.exec(className || '');
                                                                    const codeString = String(children).replace(/\n$/, '');
                                                                    // Inline code (no language class, short, no newlines)
                                                                    if (!match && !codeString.includes('\n')) {
                                                                        return <code className="bg-white/5 px-1.5 py-0.5 rounded text-blue-300 text-[13px]">{children}</code>;
                                                                    }
                                                                    // Fenced code block
                                                                    return (
                                                                        <CodeBlock
                                                                            code={codeString}
                                                                            language={match?.[1] || ''}
                                                                            onAction={sendCodeAction}
                                                                        />
                                                                    );
                                                                },
                                                                pre({ children }) {
                                                                    // Let CodeBlock handle its own wrapper
                                                                    return <>{children}</>;
                                                                }
                                                            }}
                                                        >
                                                            {visibleContent}
                                                        </ReactMarkdown>
                                                    </div>

                                                    {/* Footer: actions + stats, single row on hover */}
                                                    {visibleContent && (
                                                        <div className="flex items-center gap-0.5 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            {/* Response actions — icon only */}
                                                            {[
                                                                { key: 'longer', label: 'Longer', icon: <Expand className="w-3 h-3" /> },
                                                                { key: 'shorter', label: 'Shorter', icon: <Shrink className="w-3 h-3" /> },
                                                                { key: 'formal', label: 'Formal', icon: <Briefcase className="w-3 h-3" /> },
                                                                { key: 'casual', label: 'Casual', icon: <MessageCircle className="w-3 h-3" /> },
                                                                { key: 'technical', label: 'Technical', icon: <GraduationCap className="w-3 h-3" /> },
                                                                { key: 'translate', label: 'Translate', icon: <Languages className="w-3 h-3" /> },
                                                            ].map(a => (
                                                                <button
                                                                    key={a.key}
                                                                    onClick={() => sendResponseAction(visibleContent, a.key)}
                                                                    className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors"
                                                                    title={a.label}
                                                                >
                                                                    {a.icon}
                                                                </button>
                                                            ))}
                                                            <div className="w-px h-3 bg-white/10 mx-1" />
                                                            <button
                                                                onClick={() => copyToClipboard(visibleContent, idx)}
                                                                className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors"
                                                                title="Copy response"
                                                            >
                                                                {copiedIndex === idx
                                                                    ? <Check className="w-3 h-3 text-green-500" />
                                                                    : <Copy className="w-3 h-3" />
                                                                }
                                                            </button>
                                                            {/* Stats inline */}
                                                            {msg.stats && msg.stats.totalTokens > 0 && (
                                                                <div className="flex items-center gap-2 ml-auto">
                                                                    <span className="text-[10px] text-gray-600 font-mono tabular-nums">
                                                                        {msg.stats.tokensPerSecond} tok/s
                                                                    </span>
                                                                    <span className="text-[10px] text-gray-600 font-mono tabular-nums">
                                                                        {msg.stats.totalTokens} tok
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                                <div ref={messagesEndRef} />
                            </div>
                        )}
                    </div>

                    {/* Input Area */}
                    <div className="px-4 pb-2 pt-3">
                        <div className="max-w-3xl mx-auto">
                            {/* Input field */}
                            <div className="relative bg-white/[0.03] border border-white/10 rounded-xl focus-within:border-white/20 transition-colors">
                                <textarea
                                    ref={textareaRef}
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder={isGenerating ? "Generating..." : "Send a message..."}
                                    disabled={isGenerating}
                                    className={`w-full bg-transparent px-4 py-3 pr-14 text-sm text-gray-200 placeholder-gray-600 outline-none resize-none min-h-[44px] max-h-[200px] ${isGenerating ? 'opacity-40' : ''}`}
                                    rows={1}
                                />
                                <div className="absolute right-2 bottom-2">
                                    {isGenerating ? (
                                        <button
                                            onClick={handleStop}
                                            className="p-1.5 rounded-lg bg-white/10 text-gray-400 hover:text-white hover:bg-white/15 transition-colors"
                                            title="Stop"
                                        >
                                            <Square className="w-4 h-4" />
                                        </button>
                                    ) : (
                                        <button
                                            onClick={handleSend}
                                            disabled={!input.trim() || !currentModelId}
                                            title="Send message"
                                            className={`p-1.5 rounded-lg transition-colors ${input.trim() && currentModelId ? 'bg-white text-black hover:bg-gray-200' : 'bg-white/5 text-gray-700 cursor-not-allowed'}`}
                                        >
                                            <ArrowUp className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Parameters Sidebar */}
                {showSettings && (
                    <div className="w-72 border-l border-white/5 flex flex-col shrink-0 overflow-y-auto pl-4">
                        <div className="flex items-center gap-2 mb-5 pt-1">
                            <SlidersHorizontal className="w-3.5 h-3.5 text-gray-500" />
                            <h3 className="text-xs font-medium text-gray-400">Parameters</h3>
                        </div>

                        <div className="space-y-5">
                            <ParameterSlider
                                label="Temperature"
                                value={settings.temperature}
                                min={0} max={2} step={0.05}
                                format={(v) => v.toFixed(2)}
                                onChange={(v) => setSettings({ ...settings, temperature: v })}
                            />
                            <ParameterSlider
                                label="Max Tokens"
                                value={settings.maxTokens}
                                min={64} max={activeModel?.context_window || 32768} step={64}
                                format={(v) => v.toString()}
                                onChange={(v) => setSettings({ ...settings, maxTokens: v })}
                            />

                            <div className="border-t border-white/5 pt-5">
                                <ParameterSlider
                                    label="Top-P"
                                    value={settings.topP}
                                    min={0} max={1} step={0.05}
                                    format={(v) => v.toFixed(2)}
                                    onChange={(v) => setSettings({ ...settings, topP: v })}
                                />
                            </div>
                            <ParameterSlider
                                label="Repetition Penalty"
                                value={settings.repetitionPenalty}
                                min={0.5} max={2} step={0.05}
                                format={(v) => v.toFixed(2)}
                                onChange={(v) => setSettings({ ...settings, repetitionPenalty: v })}
                            />

                            <div className="border-t border-white/5 pt-5">
                                <label className="text-xs text-gray-500 block mb-2">Reasoning</label>
                                <div className="flex gap-1">
                                    {(['off', 'auto', 'low', 'high'] as const).map(mode => (
                                        <button
                                            key={mode}
                                            onClick={() => setSettings({ ...settings, reasoningMode: mode })}
                                            className={`flex-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${
                                                settings.reasoningMode === mode
                                                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                                    : 'bg-white/[0.03] text-gray-500 border border-white/5 hover:text-gray-400 hover:bg-white/5'
                                            }`}
                                        >
                                            {mode === 'off' ? 'Off' : mode === 'auto' ? 'Auto' : mode === 'low' ? 'Low' : 'High'}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-[10px] text-gray-600 mt-1.5">
                                    {settings.reasoningMode === 'off' && 'No reasoning instructions added.'}
                                    {settings.reasoningMode === 'auto' && 'Let the model decide. Best for reasoning models.'}
                                    {settings.reasoningMode === 'low' && 'Brief reasoning before answering.'}
                                    {settings.reasoningMode === 'high' && 'Deep step-by-step reasoning.'}
                                </p>
                            </div>

                            <div className="border-t border-white/5 pt-5">
                                <label className="text-xs text-gray-500 block mb-2">System Prompt</label>
                                <textarea
                                    value={settings.systemPrompt}
                                    onChange={(e) => setSettings({ ...settings, systemPrompt: e.target.value })}
                                    className="w-full bg-white/[0.03] border border-white/10 rounded-lg p-3 text-xs text-gray-300 h-28 resize-none outline-none focus:border-white/20 transition-colors leading-relaxed"
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

function CodeBlock({
    code,
    language,
    onAction,
}: {
    code: string;
    language: string;
    onAction: (code: string, action: string) => void;
}) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const actions = [
        { key: 'improve', label: 'Improve', icon: <Wand2 className="w-3 h-3" /> },
        { key: 'secure', label: 'Secure', icon: <Shield className="w-3 h-3" /> },
        { key: 'faster', label: 'Faster', icon: <Zap className="w-3 h-3" /> },
        { key: 'docs', label: 'Docs', icon: <FileText className="w-3 h-3" /> },
        { key: 'tests', label: 'Tests', icon: <TestTube2 className="w-3 h-3" /> },
    ];

    return (
        <div className="rounded-lg border border-white/5 bg-black/30 overflow-hidden my-3 group/code">
            {/* Header bar */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.03] border-b border-white/5">
                <span className="text-[10px] font-mono text-gray-500">{language || 'code'}</span>
                <div className="flex items-center gap-0.5">
                    {actions.map(a => (
                        <button
                            key={a.key}
                            onClick={() => onAction(code, a.key)}
                            title={a.label}
                            className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors opacity-0 group-hover/code:opacity-100"
                        >
                            {a.icon}
                        </button>
                    ))}
                    <div className="w-px h-3 bg-white/10 mx-1 opacity-0 group-hover/code:opacity-100" />
                    <button
                        onClick={handleCopy}
                        title="Copy code"
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors"
                    >
                        {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                        <span>{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                </div>
            </div>
            {/* Code content */}
            <pre className="p-4 overflow-x-auto">
                <code className="text-sm font-mono text-blue-300 leading-relaxed">{code}</code>
            </pre>
        </div>
    );
}

function ParameterSlider({
    label, value, min, max, step, format, onChange
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    format: (v: number) => string;
    onChange: (v: number) => void;
}) {
    return (
        <div>
            <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs text-gray-500">{label}</label>
                <span className="text-xs font-mono text-gray-400 tabular-nums">{format(value)}</span>
            </div>
            <input
                type="range"
                title={label}
                min={min} max={max} step={step}
                value={value}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-white/50"
            />
        </div>
    )
}
