import { useState, useEffect, useRef, useCallback } from 'react'
import { apiClient, cleanModelName } from '../api/client'
import type { ConversationSummary, SandboxResult, SyntaxCheckResult, SelfAssessment, ConversationMemory } from '../api/client'
import { PageHeader } from './ui/PageHeader'
import { Settings2, SlidersHorizontal, Cpu, Copy, Check, ChevronRight, ChevronLeft, Square, ArrowUp, Wand2, Shield, Zap, FileText, TestTube2, Expand, Shrink, Languages, Briefcase, MessageCircle, GraduationCap, Scale, Eye, EyeOff, User, Baby, FlaskConical, Feather, History, Plus, Download, GitFork, Play, Loader2, CircleCheck, CircleX, ShieldCheck, Brain } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { useGlobalState } from '../context/GlobalState'
import { ConversationListPanel } from './ConversationListPanel'

interface Message {
    id?: string
    role: 'system' | 'user' | 'assistant'
    content: string
    displayContent?: string
    actionType?: string
    stats?: {
        tokensPerSecond: number;
        timeToFirstToken: number;
        totalTokens: number;
    }
}

const CHAT_STORAGE_KEY = 'silicon-studio-chat-history';
const SETTINGS_STORAGE_KEY = 'silicon-studio-chat-settings';
const CONVERSATIONS_MIGRATED_KEY = 'silicon-studio-conversations-migrated';

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
        const allActions = [
            'longer', 'shorter', 'formal', 'casual', 'technical', 'translate',
            'devil', 'perspective_ceo', 'perspective_child', 'perspective_scientist', 'perspective_poet',
            'improve', 'secure', 'faster', 'docs', 'tests', 'selfAssess',
        ];
        const defaultEnabledActions: Record<string, boolean> = {};
        allActions.forEach(a => { defaultEnabledActions[a] = true; });
        const defaults = {
            systemPrompt: "You are a helpful AI assistant running locally on Apple Silicon.",
            temperature: 0.7,
            maxTokens: 2048,
            maxContext: 4096,
            topP: 0.9,
            repetitionPenalty: 1.1,
            reasoningMode: 'auto' as 'off' | 'auto' | 'low' | 'high',
            translateLanguage: '',
            showPrompt: false,
            syntaxCheck: true,
            autoFixSyntax: false,
            enabledActions: defaultEnabledActions,
            memoryMapEnabled: false,
            memoryInterval: 5,
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

    // Conversation management state
    const [showHistory, setShowHistory] = useState(false)
    const [conversationList, setConversationList] = useState<ConversationSummary[]>([])
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
    const activeConversationIdRef = useRef<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [renamingId, setRenamingId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')
    const [listLoading, setListLoading] = useState(false)
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Self-assessment scores per message index
    const [assessments, setAssessments] = useState<Record<number, SelfAssessment | 'loading'>>({})

    // Semantic memory map
    const [memoryMap, setMemoryMap] = useState<ConversationMemory | null>(null)
    const [showMemoryMap, setShowMemoryMap] = useState(false)
    const [memoryBuilding, setMemoryBuilding] = useState(false)
    const memoryBuildingRef = useRef(false)

    // Keep ref in sync for use in async callbacks
    useEffect(() => { activeConversationIdRef.current = activeConversationId }, [activeConversationId])

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

    const currentModelId = activeModel?.id ?? '';
    const currentModelName = activeModel ? cleanModelName(activeModel.name) : '';

    // --- Conversation helpers ---
    const fetchConversations = useCallback(async () => {
        try {
            setListLoading(true);
            const list = await apiClient.conversations.list();
            setConversationList(list);
        } catch (e) {
            console.error('Failed to fetch conversations', e);
        } finally {
            setListLoading(false);
        }
    }, []);

    const autoTitle = (msgs: Message[]) => {
        const first = msgs.find(m => m.role === 'user');
        if (!first) return 'New conversation';
        const raw = first.content.slice(0, 60);
        return raw.length < first.content.length ? raw.replace(/\s+\S*$/, '') + '...' : raw;
    };

    // Migration: move old localStorage chat to backend on first load
    useEffect(() => {
        const migrate = async () => {
            const migrated = localStorage.getItem(CONVERSATIONS_MIGRATED_KEY);
            if (migrated) { fetchConversations(); return; }
            try {
                const oldMessages = localStorage.getItem(CHAT_STORAGE_KEY);
                if (oldMessages) {
                    const parsed = JSON.parse(oldMessages);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        const conv = await apiClient.conversations.create(
                            autoTitle(parsed), parsed, currentModelId || undefined
                        );
                        setActiveConversationId(conv.id);
                    }
                }
            } catch (e) {
                console.error('Migration failed', e);
            }
            localStorage.setItem(CONVERSATIONS_MIGRATED_KEY, 'true');
            fetchConversations();
        };
        migrate();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Write-through: localStorage (immediate) + backend (debounced 800ms)
    useEffect(() => {
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        if (messages.length === 0) return;
        saveTimeoutRef.current = setTimeout(async () => {
            try {
                const convId = activeConversationIdRef.current;
                if (convId) {
                    await apiClient.conversations.update(convId, {
                        messages, model_id: currentModelId || undefined,
                    });
                } else {
                    const conv = await apiClient.conversations.create(
                        autoTitle(messages), messages, currentModelId || undefined
                    );
                    setActiveConversationId(conv.id);
                }
                fetchConversations();
            } catch (e) {
                console.error('Failed to save conversation', e);
            }
        }, 800);
        return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
    }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    }, [settings]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    // Auto-build memory map every N messages
    useEffect(() => {
        if (!settings.memoryMapEnabled || isGenerating) return;
        const interval = settings.memoryInterval || 5;
        const lastProcessed = memoryMap?.lastProcessedIndex ?? -1;
        const unprocessed = messages.length - 1 - lastProcessed;
        if (unprocessed >= interval) {
            buildMemoryMap(messages, memoryMap);
        }
    }, [messages.length, isGenerating]); // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = '0';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
        }
    }, [input])

    const handleNewConversation = () => {
        setMessages([]);
        setActiveConversationId(null);
        setAssessments({});
        setMemoryMap(null);
        localStorage.removeItem(CHAT_STORAGE_KEY);
    };

    const handleSelectConversation = async (id: string) => {
        try {
            const conv = await apiClient.conversations.get(id);
            setMessages(conv.messages || []);
            setActiveConversationId(id);
            setAssessments({});
            setMemoryMap(null);
            localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(conv.messages || []));
        } catch (e) {
            console.error('Failed to load conversation', e);
        }
    };

    const handleDeleteConversation = async (id: string) => {
        if (!window.confirm('Delete this conversation?')) return;
        try {
            await apiClient.conversations.delete(id);
            if (activeConversationId === id) handleNewConversation();
            fetchConversations();
        } catch (e) {
            console.error('Failed to delete conversation', e);
        }
    };

    const handleRenameConversation = async (id: string, newTitle: string) => {
        try {
            await apiClient.conversations.update(id, { title: newTitle });
            setRenamingId(null);
            fetchConversations();
        } catch (e) {
            console.error('Failed to rename conversation', e);
        }
    };

    const handleTogglePin = async (id: string, currentPinned: boolean) => {
        try {
            await apiClient.conversations.update(id, { pinned: !currentPinned });
            fetchConversations();
        } catch (e) {
            console.error('Failed to toggle pin', e);
        }
    };

    const handleSearch = async (query: string) => {
        setSearchQuery(query);
        if (!query.trim()) { fetchConversations(); return; }
        try {
            const results = await apiClient.conversations.search(query);
            setConversationList(results);
        } catch (e) {
            console.error('Search failed', e);
        }
    };

    const handleExport = (format: 'md' | 'json') => {
        const title = conversationList.find(c => c.id === activeConversationId)?.title || 'conversation';
        const safeName = title.replace(/[^a-zA-Z0-9 _-]/g, '_').slice(0, 50);
        let blob: Blob;
        if (format === 'md') {
            const md = messages.map(msg => {
                const header = msg.role === 'user' ? '## User' : msg.role === 'assistant' ? '## Assistant' : '## System';
                return `${header}\n\n${msg.content}`;
            }).join('\n\n---\n\n');
            blob = new Blob([md], { type: 'text/markdown' });
        } else {
            blob = new Blob([JSON.stringify({ title, messages, exported_at: new Date().toISOString() }, null, 2)], { type: 'application/json' });
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeName}.${format === 'md' ? 'md' : 'json'}`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleBranch = async (messageIndex: number) => {
        if (!activeConversationId) return;
        try {
            const branch = await apiClient.conversations.branch(activeConversationId, messageIndex);
            await fetchConversations();
            // Switch to the new branch
            setActiveConversationId(branch.id);
            setMessages(branch.messages);
            localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(branch.messages));
        } catch (e) {
            console.error('Failed to branch conversation', e);
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

    const handleSend = async (directPrompt?: string, displayContent?: string, actionType?: string) => {
        const text = directPrompt ?? input;
        if (!text.trim() || !currentModelId || isGenerating) return

        const userMsg: Message = { role: 'user', content: text, ...(displayContent && { displayContent }), ...(actionType && { actionType }) }

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

        // Inject semantic memory context if available
        if (settings.memoryMapEnabled && memoryMap && memoryMap.topics.length > 0) {
            const memParts: string[] = [];
            if (memoryMap.topics.length > 0) {
                memParts.push('Topics: ' + memoryMap.topics.map(t => `${t.name} (${t.summary})`).join('; '));
            }
            if (memoryMap.decisions.length > 0) {
                memParts.push('Decisions: ' + memoryMap.decisions.map(d => `${d.what} — ${d.why}`).join('; '));
            }
            if (memoryMap.keyFacts.length > 0) {
                memParts.push('Key facts: ' + memoryMap.keyFacts.join('; '));
            }
            if (memoryMap.codeContext.length > 0) {
                memParts.push('Code context: ' + memoryMap.codeContext.map(c => `${c.language}: ${c.description}`).join('; '));
            }
            systemContent += '\n\n[CONVERSATION CONTEXT]\n' + memParts.join('\n');
        }

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

    const codeActionPrompts: Record<string, (code: string) => string> = {
        improve: (c) => `Improve the following code. Make it cleaner, more readable, and more idiomatic. Return ONLY the improved code inside a single code block, no explanation.\n\n\`\`\`\n${c}\n\`\`\``,
        secure: (c) => `Review the following code for security vulnerabilities. Fix any issues you find. Return ONLY the secured code inside a single code block, no explanation.\n\n\`\`\`\n${c}\n\`\`\``,
        faster: (c) => `Optimize the following code for performance. Return ONLY the optimized code inside a single code block, no explanation.\n\n\`\`\`\n${c}\n\`\`\``,
        docs: (c) => `Add documentation to the following code. Add docstrings, type hints, and inline comments where helpful. Do NOT change any logic. Return ONLY the documented code inside a single code block, no explanation.\n\n\`\`\`\n${c}\n\`\`\``,
    };

    // Inline rewrite: calls the model API directly, returns the rewritten code
    const rewriteSnippet = async (code: string, action: string): Promise<string> => {
        const buildPrompt = codeActionPrompts[action];
        if (!buildPrompt || !currentModelId) throw new Error('Cannot rewrite');
        const prompt = buildPrompt(code);
        const response = await fetch(`${apiClient.API_BASE}/api/engine/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model_id: currentModelId,
                messages: [{ role: 'user', content: prompt }],
                temperature: settings.temperature,
                max_tokens: settings.maxTokens,
            })
        });
        if (!response.ok) throw new Error('Rewrite request failed');
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';
        let lineBuffer = '';
        if (reader) {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                lineBuffer += decoder.decode(value, { stream: true });
                const lines = lineBuffer.split('\n');
                lineBuffer = lines.pop() ?? '';
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6).trim());
                            if (data.text) accumulated += data.text;
                            if (data.done) break;
                        } catch { continue; }
                    }
                }
            }
        }
        // Extract code from markdown fence
        const fenceMatch = accumulated.match(/```[\w]*\n([\s\S]*?)```/);
        return fenceMatch ? fenceMatch[1].trimEnd() : accumulated.trim();
    };

    // Ethical self-assessment: ask the model to rate its own response
    const assessResponse = async (response: string, msgIndex: number) => {
        if (!currentModelId || assessments[msgIndex]) return;
        setAssessments(prev => ({ ...prev, [msgIndex]: 'loading' }));
        const prompt = `Rate the following AI response on a 0-100 scale for each category. Return ONLY valid JSON, nothing else.

Categories:
- privacy: Respects user data and privacy
- fairness: Free from bias and discrimination
- safety: No harmful, dangerous, or misleading content
- transparency: Clear about limitations and uncertainty
- ethics: Aligned with moral values and responsible AI
- reliability: Factually accurate and internally consistent

Response to assess:
---
${response.slice(0, 2000)}
---

Return exactly: {"privacy":N,"fairness":N,"safety":N,"transparency":N,"ethics":N,"reliability":N}`;

        try {
            const res = await fetch(`${apiClient.API_BASE}/api/engine/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model_id: currentModelId,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.1,
                    max_tokens: 200,
                })
            });
            if (!res.ok) throw new Error('Assessment request failed');
            const reader = res.body?.getReader();
            const decoder = new TextDecoder();
            let accumulated = '';
            let lineBuffer = '';
            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    lineBuffer += decoder.decode(value, { stream: true });
                    const lines = lineBuffer.split('\n');
                    lineBuffer = lines.pop() ?? '';
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6).trim());
                                if (data.text) accumulated += data.text;
                                if (data.done) break;
                            } catch { continue; }
                        }
                    }
                }
            }
            // Extract JSON from response (may be wrapped in markdown or text)
            const jsonMatch = accumulated.match(/\{[^}]*"privacy"\s*:\s*\d+[^}]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                const clamp = (v: unknown) => Math.max(0, Math.min(100, Number(v) || 0));
                const assessment: SelfAssessment = {
                    privacy: clamp(parsed.privacy),
                    fairness: clamp(parsed.fairness),
                    safety: clamp(parsed.safety),
                    transparency: clamp(parsed.transparency),
                    ethics: clamp(parsed.ethics),
                    reliability: clamp(parsed.reliability),
                };
                setAssessments(prev => ({ ...prev, [msgIndex]: assessment }));
            } else {
                throw new Error('No valid JSON in response');
            }
        } catch (e: any) {
            console.error('Assessment failed:', e.message);
            setAssessments(prev => {
                const next = { ...prev };
                delete next[msgIndex];
                return next;
            });
        }
    };

    // Semantic memory map: summarize recent messages into structured context
    const buildMemoryMap = useCallback(async (msgs: Message[], existingMemory: ConversationMemory | null) => {
        if (!currentModelId || memoryBuildingRef.current) return null;
        memoryBuildingRef.current = true;
        setMemoryBuilding(true);

        const lastIdx = existingMemory?.lastProcessedIndex ?? -1;
        const newMessages = msgs.slice(lastIdx + 1);
        if (newMessages.length < 2) { setMemoryBuilding(false); memoryBuildingRef.current = false; return null; }

        // Build a compact transcript of recent messages
        const transcript = newMessages.map((m, i) =>
            `[${lastIdx + 1 + i}] ${m.role}: ${m.content.slice(0, 300)}`
        ).join('\n');

        const existingContext = existingMemory
            ? `\nExisting context to merge with:\n${JSON.stringify(existingMemory, null, 0)}\n`
            : '';

        const prompt = `Analyze this conversation and return ONLY valid JSON summarizing it. Merge with any existing context provided.${existingContext}

Conversation:
---
${transcript.slice(0, 3000)}
---

Return exactly this JSON structure (no other text):
{"topics":[{"name":"short name","summary":"1 sentence","messageRange":[start,end]}],"codeContext":[{"language":"lang","description":"what it does","lastVersion":"brief"}],"decisions":[{"what":"what was decided","why":"why"}],"keyFacts":["fact1","fact2"]}`;

        try {
            const res = await fetch(`${apiClient.API_BASE}/api/engine/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model_id: currentModelId,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.1,
                    max_tokens: 500,
                })
            });
            if (!res.ok) throw new Error('Memory map request failed');
            const reader = res.body?.getReader();
            const decoder = new TextDecoder();
            let accumulated = '';
            let lineBuffer = '';
            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    lineBuffer += decoder.decode(value, { stream: true });
                    const lines = lineBuffer.split('\n');
                    lineBuffer = lines.pop() ?? '';
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6).trim());
                                if (data.text) accumulated += data.text;
                                if (data.done) break;
                            } catch { continue; }
                        }
                    }
                }
            }
            // Extract JSON
            const jsonMatch = accumulated.match(/\{[\s\S]*"topics"[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                const memory: ConversationMemory = {
                    topics: Array.isArray(parsed.topics) ? parsed.topics : [],
                    codeContext: Array.isArray(parsed.codeContext) ? parsed.codeContext : [],
                    decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
                    keyFacts: Array.isArray(parsed.keyFacts) ? parsed.keyFacts : [],
                    lastProcessedIndex: msgs.length - 1,
                };
                setMemoryMap(memory);
                return memory;
            }
        } catch (e: any) {
            console.error('Memory map build failed:', e.message);
        } finally {
            setMemoryBuilding(false);
            memoryBuildingRef.current = false;
        }
        return null;
    }, [currentModelId]);

    const sendCodeAction = (code: string, _action: string) => {
        if (isGenerating || !currentModelId) return;
        // Tests go through chat (produces a separate file, not a rewrite)
        const prompt = `Write tests for the following code. Do NOT modify the original code. Generate a complete test file with good coverage of edge cases, typical usage, and error conditions. Use the most appropriate testing framework for the language.\n\n\`\`\`\n${code}\n\`\`\``;
        const lineCount = code.split('\n').length;
        const display = `**Tests** — ${lineCount} lines`;
        handleSend(prompt, display, 'tests');
    }

    const getTranslateLanguage = () => {
        if (settings.translateLanguage) return settings.translateLanguage;
        const browserLang = navigator.language.split('-')[0];
        const langName: Record<string, string> = { en: 'English', it: 'Italian', fr: 'French', de: 'German', es: 'Spanish', pt: 'Portuguese', ja: 'Japanese', zh: 'Chinese', ko: 'Korean', ar: 'Arabic', hi: 'Hindi', ru: 'Russian', nl: 'Dutch', sv: 'Swedish', pl: 'Polish', tr: 'Turkish' };
        return langName[browserLang] || browserLang;
    };

    const sendResponseAction = (response: string, action: string) => {
        if (isGenerating || !currentModelId) return;
        const targetLang = getTranslateLanguage();

        const prompts: Record<string, string> = {
            longer: `Expand and elaborate on the following response. Add more detail, examples, and depth while keeping the same structure and meaning.\n\n---\n${response}\n---`,
            shorter: `Condense the following response to be much shorter and more concise. Keep only the essential points.\n\n---\n${response}\n---`,
            formal: `Rewrite the following response in a formal, professional tone. Keep the same content and meaning.\n\n---\n${response}\n---`,
            casual: `Rewrite the following response in a casual, friendly tone. Keep the same content and meaning.\n\n---\n${response}\n---`,
            technical: `Rewrite the following response in a precise, technical tone with proper terminology. Keep the same meaning.\n\n---\n${response}\n---`,
            translate: `Translate the following response to ${targetLang}. Preserve formatting, code blocks, and technical terms.\n\n---\n${response}\n---`,
            devil: `Act as a devil's advocate. Challenge, critique, and find flaws in the following response. Point out weak arguments, logical fallacies, missing perspectives, and potential risks. Be thorough but constructive.\n\n---\n${response}\n---`,
            perspective_ceo: `Rewrite the following response from the perspective of a pragmatic CEO focused on ROI, market impact, and business value. Keep the same core information but shift the framing.\n\n---\n${response}\n---`,
            perspective_child: `Explain the following response as if you were talking to an 8-year-old. Use simple words, analogies, and short sentences. Make it fun and easy to understand.\n\n---\n${response}\n---`,
            perspective_scientist: `Rewrite the following response from the perspective of a skeptical scientist. Demand evidence, question assumptions, note what's unproven, and suggest how claims could be tested.\n\n---\n${response}\n---`,
            perspective_poet: `Rewrite the following response in a poetic, literary style. Use metaphors, vivid imagery, and elegant prose while preserving the core meaning.\n\n---\n${response}\n---`,
        };
        const labels: Record<string, string> = {
            longer: 'Longer',
            shorter: 'Shorter',
            formal: 'Formal',
            casual: 'Casual',
            technical: 'Technical',
            translate: `Translate → ${targetLang}`,
            devil: "Devil's Advocate",
            perspective_ceo: 'CEO Perspective',
            perspective_child: 'ELI8',
            perspective_scientist: 'Scientist Perspective',
            perspective_poet: 'Poet Perspective',
        };
        const prompt = prompts[action];
        const wordCount = response.split(/\s+/).length;
        const display = `**${labels[action]}** — ${wordCount} words`;
        if (prompt) handleSend(prompt, display, action);
    }

    return (
        <div className="h-full flex flex-col text-white overflow-hidden pb-4">
            <PageHeader>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => { setShowHistory(!showHistory); if (!showHistory) fetchConversations(); }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${showHistory ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                    >
                        <History className="w-3.5 h-3.5" />
                        History
                    </button>
                    {messages.length > 0 && (
                        <button
                            onClick={handleNewConversation}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            New
                        </button>
                    )}
                    {messages.length > 0 && (
                        <div className="relative group/export">
                            <button
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                            >
                                <Download className="w-3.5 h-3.5" />
                                Export
                            </button>
                            <div className="hidden group-hover/export:block absolute top-full left-0 mt-1 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl py-1 z-50 min-w-[110px]">
                                <button
                                    onClick={() => handleExport('md')}
                                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                                >
                                    Markdown
                                </button>
                                <button
                                    onClick={() => handleExport('json')}
                                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                                >
                                    JSON
                                </button>
                            </div>
                        </div>
                    )}
                    {settings.memoryMapEnabled && (
                        <button
                            type="button"
                            onClick={() => setShowMemoryMap(!showMemoryMap)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${showMemoryMap ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                        >
                            <Brain className="w-3.5 h-3.5" />
                            {memoryBuilding ? 'Building...' : 'Memory'}
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
                {/* Conversation History Panel */}
                {showHistory && (
                    <ConversationListPanel
                        conversations={conversationList}
                        activeId={activeConversationId}
                        searchQuery={searchQuery}
                        onSearch={handleSearch}
                        onSelect={handleSelectConversation}
                        onDelete={handleDeleteConversation}
                        onRename={handleRenameConversation}
                        onTogglePin={handleTogglePin}
                        renamingId={renamingId}
                        renameValue={renameValue}
                        onStartRename={(id: string, title: string) => { setRenamingId(id); setRenameValue(title); }}
                        onCancelRename={() => setRenamingId(null)}
                        onRenameValueChange={setRenameValue}
                        loading={listLoading}
                    />
                )}

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
                                        // Icon map for action types
                                        const actionIcons: Record<string, React.ReactNode> = {
                                            improve: <Wand2 className="w-3.5 h-3.5" />,
                                            secure: <Shield className="w-3.5 h-3.5" />,
                                            faster: <Zap className="w-3.5 h-3.5" />,
                                            docs: <FileText className="w-3.5 h-3.5" />,
                                            tests: <TestTube2 className="w-3.5 h-3.5" />,
                                            longer: <Expand className="w-3.5 h-3.5" />,
                                            shorter: <Shrink className="w-3.5 h-3.5" />,
                                            formal: <Briefcase className="w-3.5 h-3.5" />,
                                            casual: <MessageCircle className="w-3.5 h-3.5" />,
                                            technical: <GraduationCap className="w-3.5 h-3.5" />,
                                            translate: <Languages className="w-3.5 h-3.5" />,
                                            devil: <Scale className="w-3.5 h-3.5" />,
                                            perspective_ceo: <User className="w-3.5 h-3.5" />,
                                            perspective_child: <Baby className="w-3.5 h-3.5" />,
                                            perspective_scientist: <FlaskConical className="w-3.5 h-3.5" />,
                                            perspective_poet: <Feather className="w-3.5 h-3.5" />,
                                        };
                                        const isLastMsg = idx === messages.length - 1 || (idx === messages.length - 2 && messages[messages.length - 1]?.role === 'assistant');
                                        const showSpinner = isLastMsg && isGenerating;

                                        return (
                                            <div key={idx} className="mb-6">
                                                <div className="flex items-start gap-3">
                                                    <div className="w-6 h-6 rounded-md bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                                                        <span className="text-[10px] font-bold text-gray-400">U</span>
                                                    </div>
                                                    {msg.displayContent ? (
                                                        <details className="min-w-0 group/action">
                                                            <summary className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-sm text-gray-300 cursor-pointer select-none list-none hover:bg-white/[0.06] transition-colors">
                                                                <span className="text-blue-400 shrink-0">
                                                                    {(msg.actionType && actionIcons[msg.actionType]) || <Settings2 className="w-3.5 h-3.5" />}
                                                                </span>
                                                                <ReactMarkdown
                                                                    remarkPlugins={[remarkGfm]}
                                                                    components={{ p: ({ children }) => <span>{children}</span> }}
                                                                >
                                                                    {msg.displayContent}
                                                                </ReactMarkdown>
                                                                {showSpinner && (
                                                                    <div className="w-3 h-3 border border-blue-400/40 border-t-blue-400 rounded-full animate-spin shrink-0 ml-1" />
                                                                )}
                                                                <ChevronRight className="w-3 h-3 text-gray-600 shrink-0 ml-auto transition-transform chevron-rotate" />
                                                            </summary>
                                                            <div className="mt-2 ml-1 pl-3 border-l border-white/5 text-xs text-gray-500 max-h-48 overflow-y-auto">
                                                                <pre className="whitespace-pre-wrap font-mono leading-relaxed">{msg.content}</pre>
                                                            </div>
                                                        </details>
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
                                                                            onTestAction={sendCodeAction}
                                                                            onRewrite={rewriteSnippet}
                                                                            enabledActions={settings.enabledActions}
                                                                            syntaxCheck={settings.syntaxCheck}
                                                                            autoFixSyntax={settings.autoFixSyntax}
                                                                            onFixSyntax={(c, lang, errors) => {
                                                                                if (isGenerating || !currentModelId) return;
                                                                                handleSend(
                                                                                    `Fix the syntax errors in the following ${lang} code. The syntax checker reported:\n\n${errors}\n\nCode:\n\`\`\`${lang}\n${c}\n\`\`\`\n\nReturn only the fixed code.`,
                                                                                    `**Fix syntax** — ${lang}`,
                                                                                    'improve'
                                                                                );
                                                                            }}
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
                                                        <ResponseActions
                                                            content={visibleContent}
                                                            idx={idx}
                                                            copiedIndex={copiedIndex}
                                                            stats={msg.stats}
                                                            onAction={sendResponseAction}
                                                            onCopy={copyToClipboard}
                                                            showPrompt={settings.showPrompt}
                                                            fullPrompt={msg.content}
                                                            enabledActions={settings.enabledActions}
                                                            onBranch={activeConversationId ? () => handleBranch(idx) : undefined}
                                                            assessment={assessments[idx]}
                                                            onAssess={settings.enabledActions?.selfAssess !== false ? () => assessResponse(visibleContent, idx) : undefined}
                                                        />
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

                    {/* Memory Map Panel */}
                    {showMemoryMap && settings.memoryMapEnabled && (
                        <MemoryMapPanel memory={memoryMap} building={memoryBuilding} />
                    )}

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
                                            onClick={() => handleSend()}
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
                                <label className="text-xs text-gray-500 block mb-2">Translate Language</label>
                                <select
                                    title="Translate Language"
                                    value={settings.translateLanguage}
                                    onChange={(e) => setSettings({ ...settings, translateLanguage: e.target.value })}
                                    className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-300 outline-none focus:border-white/20 transition-colors appearance-none cursor-pointer"
                                >
                                    <option value="">Auto-detect (browser)</option>
                                    {['English', 'Italian', 'French', 'German', 'Spanish', 'Portuguese', 'Japanese', 'Chinese', 'Korean', 'Arabic', 'Hindi', 'Russian', 'Dutch', 'Swedish', 'Polish', 'Turkish'].map(lang => (
                                        <option key={lang} value={lang}>{lang}</option>
                                    ))}
                                </select>
                                <p className="text-[10px] text-gray-600 mt-1.5">
                                    Target language for the Translate action.
                                </p>
                            </div>

                            <div className="border-t border-white/5 pt-5">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs text-gray-500">Show Prompt</label>
                                    <button
                                        onClick={() => setSettings({ ...settings, showPrompt: !settings.showPrompt })}
                                        className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                                            settings.showPrompt
                                                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                                : 'bg-white/[0.03] text-gray-500 border border-white/5 hover:text-gray-400 hover:bg-white/5'
                                        }`}
                                    >
                                        {settings.showPrompt ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                                        {settings.showPrompt ? 'On' : 'Off'}
                                    </button>
                                </div>
                                <p className="text-[10px] text-gray-600 mt-1.5">
                                    Show raw content behind AI responses.
                                </p>
                            </div>

                            <div className="border-t border-white/5 pt-5">
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-xs text-gray-500">Syntax Check</label>
                                    <button
                                        onClick={() => setSettings({ ...settings, syntaxCheck: !settings.syntaxCheck })}
                                        className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                                            settings.syntaxCheck
                                                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                                : 'bg-white/[0.03] text-gray-500 border border-white/5 hover:text-gray-400 hover:bg-white/5'
                                        }`}
                                    >
                                        {settings.syntaxCheck ? <CircleCheck className="w-3 h-3" /> : <CircleX className="w-3 h-3" />}
                                        {settings.syntaxCheck ? 'On' : 'Off'}
                                    </button>
                                </div>
                                <p className="text-[10px] text-gray-600 mb-3">
                                    Auto-validate code snippets after each response.
                                </p>
                                {settings.syntaxCheck && (
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs text-gray-500">Auto-fix Syntax</label>
                                        <button
                                            onClick={() => setSettings({ ...settings, autoFixSyntax: !settings.autoFixSyntax })}
                                            className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                                                settings.autoFixSyntax
                                                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                                    : 'bg-white/[0.03] text-gray-500 border border-white/5 hover:text-gray-400 hover:bg-white/5'
                                            }`}
                                        >
                                            {settings.autoFixSyntax ? 'On' : 'Off'}
                                        </button>
                                    </div>
                                )}
                                {settings.syntaxCheck && settings.autoFixSyntax && (
                                    <p className="text-[10px] text-gray-600 mt-1.5">
                                        Show "Fix syntax" button on invalid snippets.
                                    </p>
                                )}
                            </div>

                            <div className="border-t border-white/5 pt-5">
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-xs text-gray-500">Memory Map</label>
                                    <button
                                        type="button"
                                        onClick={() => setSettings({ ...settings, memoryMapEnabled: !settings.memoryMapEnabled })}
                                        className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                                            settings.memoryMapEnabled
                                                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                                : 'bg-white/[0.03] text-gray-500 border border-white/5 hover:text-gray-400 hover:bg-white/5'
                                        }`}
                                    >
                                        <Brain className="w-3 h-3" />
                                        {settings.memoryMapEnabled ? 'On' : 'Off'}
                                    </button>
                                </div>
                                <p className="text-[10px] text-gray-600 mb-3">
                                    Auto-summarize conversation context every N messages.
                                </p>
                                {settings.memoryMapEnabled && (
                                    <ParameterSlider
                                        label="Build every N messages"
                                        value={settings.memoryInterval}
                                        min={3} max={20} step={1}
                                        format={(v) => v.toString()}
                                        onChange={(v) => setSettings({ ...settings, memoryInterval: v })}
                                    />
                                )}
                            </div>

                            <div className="border-t border-white/5 pt-5">
                                <label className="text-xs text-gray-500 block mb-2">Visible Actions</label>
                                <div className="flex flex-wrap gap-1.5">
                                    {[
                                        { key: 'longer', label: 'Longer' },
                                        { key: 'shorter', label: 'Shorter' },
                                        { key: 'formal', label: 'Formal' },
                                        { key: 'casual', label: 'Casual' },
                                        { key: 'technical', label: 'Technical' },
                                        { key: 'translate', label: 'Translate' },
                                        { key: 'devil', label: "Devil's Advocate" },
                                        { key: 'perspective_ceo', label: 'CEO' },
                                        { key: 'perspective_child', label: 'ELI8' },
                                        { key: 'perspective_scientist', label: 'Scientist' },
                                        { key: 'perspective_poet', label: 'Poet' },
                                        { key: 'improve', label: 'Improve' },
                                        { key: 'secure', label: 'Secure' },
                                        { key: 'faster', label: 'Faster' },
                                        { key: 'docs', label: 'Docs' },
                                        { key: 'tests', label: 'Tests' },
                                        { key: 'selfAssess', label: 'Ethical' },
                                    ].map(a => {
                                        const enabled = settings.enabledActions?.[a.key] !== false;
                                        return (
                                            <button
                                                key={a.key}
                                                onClick={() => setSettings({
                                                    ...settings,
                                                    enabledActions: { ...settings.enabledActions, [a.key]: !enabled },
                                                })}
                                                className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                                                    enabled
                                                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                                        : 'bg-white/[0.03] text-gray-600 border border-white/5 hover:text-gray-400'
                                                }`}
                                            >
                                                {a.label}
                                            </button>
                                        );
                                    })}
                                </div>
                                <p className="text-[10px] text-gray-600 mt-1.5">
                                    Toggle which actions appear on responses and code blocks.
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

function ResponseActions({
    content,
    idx,
    copiedIndex,
    stats,
    onAction,
    onCopy,
    showPrompt,
    fullPrompt,
    enabledActions,
    onBranch,
    assessment,
    onAssess,
}: {
    content: string;
    idx: number;
    copiedIndex: number | null;
    stats?: { tokensPerSecond: number; timeToFirstToken: number; totalTokens: number };
    onAction: (response: string, action: string) => void;
    onCopy: (text: string, index: number) => void;
    showPrompt: boolean;
    fullPrompt: string;
    enabledActions?: Record<string, boolean>;
    onBranch?: () => void;
    assessment?: SelfAssessment | 'loading';
    onAssess?: () => void;
}) {
    const isOn = (key: string) => enabledActions?.[key] !== false;
    const [showPerspectives, setShowPerspectives] = useState(false);
    const [showAssessment, setShowAssessment] = useState(false);
    const perspRef = useRef<HTMLDivElement>(null);

    // Close perspectives dropdown on outside click
    useEffect(() => {
        if (!showPerspectives) return;
        const handler = (e: MouseEvent) => {
            if (perspRef.current && !perspRef.current.contains(e.target as Node)) {
                setShowPerspectives(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showPerspectives]);

    const perspectives = [
        { key: 'perspective_ceo', label: 'CEO', icon: <User className="w-3 h-3" /> },
        { key: 'perspective_child', label: 'ELI8', icon: <Baby className="w-3 h-3" /> },
        { key: 'perspective_scientist', label: 'Scientist', icon: <FlaskConical className="w-3 h-3" /> },
        { key: 'perspective_poet', label: 'Poet', icon: <Feather className="w-3 h-3" /> },
    ];
    const enabledPerspectives = perspectives.filter(p => isOn(p.key));

    return (
        <div className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="flex items-center gap-0.5">
                {/* Tone & length actions */}
                {[
                    { key: 'longer', label: 'Longer', icon: <Expand className="w-3 h-3" /> },
                    { key: 'shorter', label: 'Shorter', icon: <Shrink className="w-3 h-3" /> },
                    { key: 'formal', label: 'Formal', icon: <Briefcase className="w-3 h-3" /> },
                    { key: 'casual', label: 'Casual', icon: <MessageCircle className="w-3 h-3" /> },
                    { key: 'technical', label: 'Technical', icon: <GraduationCap className="w-3 h-3" /> },
                    { key: 'translate', label: 'Translate', icon: <Languages className="w-3 h-3" /> },
                ].filter(a => isOn(a.key)).map(a => (
                    <button
                        key={a.key}
                        onClick={() => onAction(content, a.key)}
                        className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors"
                        title={a.label}
                    >
                        {a.icon}
                    </button>
                ))}
                {(isOn('devil') || enabledPerspectives.length > 0) && <div className="w-px h-3 bg-white/10 mx-1" />}
                {/* Devil's Advocate */}
                {isOn('devil') && (
                    <button
                        onClick={() => onAction(content, 'devil')}
                        className="p-1 rounded text-gray-600 hover:text-orange-400 hover:bg-orange-500/5 transition-colors"
                        title="Devil's Advocate"
                    >
                        <Scale className="w-3 h-3" />
                    </button>
                )}
                {/* Perspective Shift dropdown */}
                {enabledPerspectives.length > 0 && (
                    <div className="relative" ref={perspRef}>
                        <button
                            onClick={() => setShowPerspectives(!showPerspectives)}
                            className={`p-1 rounded transition-colors ${showPerspectives ? 'text-purple-400 bg-purple-500/10' : 'text-gray-600 hover:text-purple-400 hover:bg-purple-500/5'}`}
                            title="Change Perspective"
                        >
                            <Eye className="w-3 h-3" />
                        </button>
                        {showPerspectives && (
                            <div className="absolute bottom-full left-0 mb-1 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl py-1 z-50 min-w-[120px]">
                                {enabledPerspectives.map(p => (
                                    <button
                                        key={p.key}
                                        onClick={() => { onAction(content, p.key); setShowPerspectives(false); }}
                                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                                    >
                                        {p.icon}
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                <div className="w-px h-3 bg-white/10 mx-1" />
                <button
                    onClick={() => onCopy(content, idx)}
                    className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors"
                    title="Copy response"
                >
                    {copiedIndex === idx
                        ? <Check className="w-3 h-3 text-green-500" />
                        : <Copy className="w-3 h-3" />
                    }
                </button>
                {onBranch && (
                    <button
                        onClick={onBranch}
                        className="p-1 rounded text-gray-600 hover:text-purple-400 hover:bg-purple-500/5 transition-colors"
                        title="Branch from here"
                    >
                        <GitFork className="w-3 h-3" />
                    </button>
                )}
                {/* Ethical self-assessment */}
                {onAssess && (
                    <button
                        onClick={() => {
                            if (!assessment) onAssess();
                            setShowAssessment(!showAssessment);
                        }}
                        className={`p-1 rounded transition-colors ${
                            assessment && assessment !== 'loading'
                                ? 'text-emerald-400 hover:bg-emerald-500/10'
                                : assessment === 'loading'
                                    ? 'text-gray-500 cursor-wait'
                                    : 'text-gray-600 hover:text-emerald-400 hover:bg-emerald-500/5'
                        }`}
                        title={assessment === 'loading' ? 'Assessing...' : assessment ? 'Toggle assessment' : 'Ethical assessment'}
                        disabled={assessment === 'loading'}
                    >
                        {assessment === 'loading'
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <ShieldCheck className="w-3 h-3" />
                        }
                    </button>
                )}
                {/* Stats inline */}
                {stats && stats.totalTokens > 0 && (
                    <div className="flex items-center gap-2 ml-auto">
                        <span className="text-[10px] text-gray-600 font-mono tabular-nums">
                            {stats.tokensPerSecond} tok/s
                        </span>
                        <span className="text-[10px] text-gray-600 font-mono tabular-nums">
                            {stats.totalTokens} tok
                        </span>
                    </div>
                )}
            </div>
            {/* Ethical assessment scores */}
            {showAssessment && assessment && assessment !== 'loading' && (
                <AssessmentPanel scores={assessment} />
            )}
            {/* Show Prompt — what was actually sent */}
            {showPrompt && (
                <details className="mt-1.5">
                    <summary className="flex items-center gap-1 cursor-pointer text-[10px] text-gray-600 hover:text-gray-400 transition-colors select-none list-none">
                        <ChevronRight className="w-2.5 h-2.5 chevron-rotate transition-transform" />
                        <span>View raw response</span>
                    </summary>
                    <div className="mt-1 pl-3 border-l border-white/5 text-[10px] text-gray-600 max-h-32 overflow-y-auto">
                        <pre className="whitespace-pre-wrap font-mono leading-relaxed">{fullPrompt}</pre>
                    </div>
                </details>
            )}
        </div>
    );
}

function AssessmentPanel({ scores }: { scores: SelfAssessment }) {
    const dimensions: { key: keyof SelfAssessment; label: string }[] = [
        { key: 'privacy', label: 'Privacy' },
        { key: 'fairness', label: 'Fairness' },
        { key: 'safety', label: 'Safety' },
        { key: 'transparency', label: 'Transparency' },
        { key: 'ethics', label: 'Ethics' },
        { key: 'reliability', label: 'Reliability' },
    ];
    const avg = Math.round(dimensions.reduce((s, d) => s + scores[d.key], 0) / dimensions.length);
    const barColor = (v: number) =>
        v >= 80 ? 'bg-emerald-500' : v >= 60 ? 'bg-yellow-500' : v >= 40 ? 'bg-orange-500' : 'bg-red-500';

    return (
        <div className="mt-2 p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
            <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                <span className="text-[10px] font-medium text-gray-400">Self-Assessment</span>
                <span className={`text-[10px] font-mono font-medium ml-auto ${avg >= 80 ? 'text-emerald-400' : avg >= 60 ? 'text-yellow-400' : 'text-orange-400'}`}>
                    {avg}/100
                </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {dimensions.map(d => (
                    <div key={d.key} className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500 w-20 shrink-0">{d.label}</span>
                        <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full ${barColor(scores[d.key])}`}
                                style={{ width: `${scores[d.key]}%` }}
                            />
                        </div>
                        <span className="text-[10px] font-mono text-gray-500 w-6 text-right">{scores[d.key]}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function MemoryMapPanel({ memory, building }: { memory: ConversationMemory | null; building: boolean }) {
    if (building && !memory) {
        return (
            <div className="px-4 py-2">
                <div className="max-w-3xl mx-auto flex items-center gap-2 p-3 rounded-lg bg-white/[0.02] border border-white/5">
                    <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                    <span className="text-xs text-gray-500">Building memory map...</span>
                </div>
            </div>
        );
    }
    if (!memory || memory.topics.length === 0) {
        return (
            <div className="px-4 py-2">
                <div className="max-w-3xl mx-auto p-3 rounded-lg bg-white/[0.02] border border-white/5">
                    <div className="flex items-center gap-2">
                        <Brain className="w-3.5 h-3.5 text-gray-600" />
                        <span className="text-xs text-gray-600">No memory context yet. Keep chatting and it will build automatically.</span>
                    </div>
                </div>
            </div>
        );
    }
    return (
        <div className="px-4 py-2">
            <div className="max-w-3xl mx-auto p-3 rounded-lg bg-white/[0.02] border border-white/5 space-y-2">
                <div className="flex items-center gap-2 mb-1">
                    <Brain className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-[10px] font-medium text-gray-400">Conversation Memory</span>
                    {building && <Loader2 className="w-3 h-3 text-blue-400 animate-spin ml-auto" />}
                </div>
                {memory.topics.length > 0 && (
                    <div>
                        <span className="text-[10px] text-gray-500 font-medium">Topics</span>
                        <div className="mt-1 space-y-0.5">
                            {memory.topics.map((t, i) => (
                                <div key={i} className="text-[10px] text-gray-400">
                                    <span className="text-gray-300 font-medium">{t.name}</span>
                                    <span className="text-gray-600"> — {t.summary}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {memory.decisions.length > 0 && (
                    <div>
                        <span className="text-[10px] text-gray-500 font-medium">Decisions</span>
                        <div className="mt-1 space-y-0.5">
                            {memory.decisions.map((d, i) => (
                                <div key={i} className="text-[10px] text-gray-400">
                                    <span className="text-gray-300">{d.what}</span>
                                    <span className="text-gray-600"> — {d.why}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {memory.codeContext.length > 0 && (
                    <div>
                        <span className="text-[10px] text-gray-500 font-medium">Code</span>
                        <div className="mt-1 space-y-0.5">
                            {memory.codeContext.map((c, i) => (
                                <div key={i} className="text-[10px] text-gray-400">
                                    <span className="text-blue-400 font-mono">{c.language}</span>
                                    <span className="text-gray-600"> — {c.description}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {memory.keyFacts.length > 0 && (
                    <div>
                        <span className="text-[10px] text-gray-500 font-medium">Key Facts</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                            {memory.keyFacts.map((f, i) => (
                                <span key={i} className="text-[10px] text-gray-400 bg-white/[0.03] px-1.5 py-0.5 rounded">
                                    {f}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

interface SnippetVersion {
    code: string;
    action: string;
    timestamp: number;
}

function CodeBlock({
    code,
    language,
    onTestAction,
    onRewrite,
    enabledActions,
    syntaxCheck,
    autoFixSyntax,
    onFixSyntax,
}: {
    code: string;
    language: string;
    onTestAction: (code: string, action: string) => void;
    onRewrite: (code: string, action: string) => Promise<string>;
    enabledActions?: Record<string, boolean>;
    syntaxCheck?: boolean;
    autoFixSyntax?: boolean;
    onFixSyntax?: (code: string, language: string, errors: string) => void;
}) {
    const [copied, setCopied] = useState(false);
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<SandboxResult | null>(null);
    const [showOutput, setShowOutput] = useState(false);
    const runIdRef = useRef<string | null>(null);
    const [checkResult, setCheckResult] = useState<SyntaxCheckResult | null>(null);
    const [checking, setChecking] = useState(false);
    const checkRanRef = useRef(false);

    // Versioning state
    const [versions, setVersions] = useState<SnippetVersion[]>([]);
    const [versionIndex, setVersionIndex] = useState(-1);
    const [rewriting, setRewriting] = useState(false);

    // The code to display: active version or original
    const displayCode = versionIndex >= 0 && versions[versionIndex] ? versions[versionIndex].code : code;
    const totalVersions = versions.length;
    const displayVersionNum = versionIndex >= 0 ? versionIndex + 1 : (totalVersions > 0 ? 0 : -1);

    // Auto-run syntax check on mount (only for blocks > 2 lines)
    useEffect(() => {
        if (!syntaxCheck || checkRanRef.current || code.split('\n').length <= 2) return;
        checkRanRef.current = true;
        setChecking(true);
        apiClient.sandbox.check(code, language)
            .then(setCheckResult)
            .catch(() => {})
            .finally(() => setChecking(false));
    }, [syntaxCheck, code, language]);

    // Re-check syntax when version changes
    useEffect(() => {
        if (!syntaxCheck || versionIndex < 0 || displayCode.split('\n').length <= 2) return;
        setChecking(true);
        setCheckResult(null);
        apiClient.sandbox.check(displayCode, language)
            .then(setCheckResult)
            .catch(() => {})
            .finally(() => setChecking(false));
    }, [versionIndex]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleCopy = () => {
        navigator.clipboard.writeText(displayCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleRun = async () => {
        setRunning(true);
        setShowOutput(true);
        setResult(null);
        try {
            const res = await apiClient.sandbox.run(displayCode, language);
            runIdRef.current = res.run_id;
            setResult(res);
        } catch (e: any) {
            setResult({
                stdout: '',
                stderr: e.message || 'Execution failed',
                exit_code: 1,
                execution_time: 0,
                language: language || 'unknown',
                timed_out: false,
                run_id: '',
            });
        } finally {
            setRunning(false);
        }
    };

    const handleKill = async () => {
        if (runIdRef.current) {
            try { await apiClient.sandbox.kill(runIdRef.current); } catch { /* ignore */ }
        }
    };

    const handleInlineRewrite = async (action: string) => {
        if (rewriting) return;
        setRewriting(true);
        try {
            const sourceCode = displayCode;
            const result = await onRewrite(sourceCode, action);
            // Initialize with original if first rewrite
            const current = versions.length === 0
                ? [{ code, action: 'original', timestamp: Date.now() }]
                : [...versions];
            // Truncate any "future" versions if user navigated back then rewrote
            const base = versionIndex >= 0 ? current.slice(0, versionIndex + 1) : current;
            const updated = [...base, { code: result, action, timestamp: Date.now() }];
            setVersions(updated);
            setVersionIndex(updated.length - 1);
        } catch (e: any) {
            console.error('Rewrite failed:', e.message);
        } finally {
            setRewriting(false);
        }
    };

    const rewriteActions = [
        { key: 'improve', label: 'Improve', icon: <Wand2 className="w-3 h-3" /> },
        { key: 'secure', label: 'Secure', icon: <Shield className="w-3 h-3" /> },
        { key: 'faster', label: 'Faster', icon: <Zap className="w-3 h-3" /> },
        { key: 'docs', label: 'Docs', icon: <FileText className="w-3 h-3" /> },
    ].filter(a => enabledActions?.[a.key] !== false);

    const showTests = enabledActions?.['tests'] !== false;
    const hasOutput = result && (result.stdout || result.stderr);

    return (
        <div className="rounded-lg border border-white/5 bg-black/30 overflow-hidden my-3 group/code">
            {/* Header bar */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.03] border-b border-white/5">
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-gray-500">{language || 'code'}</span>
                    {checking && <Loader2 className="w-3 h-3 animate-spin text-gray-500" />}
                    {!checking && checkResult && !checkResult.skipped && (
                        checkResult.valid
                            ? <span title="Syntax valid"><CircleCheck className="w-3 h-3 text-green-500" /></span>
                            : <span title={checkResult.errors || 'Syntax error'}><CircleX className="w-3 h-3 text-red-400" /></span>
                    )}
                    {rewriting && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
                    {/* Version navigation */}
                    {totalVersions > 0 && (
                        <div className="flex items-center gap-0.5 ml-1">
                            <button
                                onClick={() => setVersionIndex(Math.max(versionIndex - 1, -1))}
                                disabled={versionIndex <= -1}
                                className={`p-0.5 rounded transition-colors ${versionIndex > -1 ? 'text-gray-400 hover:text-white hover:bg-white/5' : 'text-gray-700 cursor-default'}`}
                                title="Previous version"
                            >
                                <ChevronLeft className="w-3 h-3" />
                            </button>
                            <span className="text-[10px] font-mono text-gray-500 min-w-[32px] text-center">
                                {versionIndex < 0 ? 'orig' : `v${displayVersionNum}`}/{totalVersions}
                            </span>
                            <button
                                onClick={() => setVersionIndex(Math.min(versionIndex + 1, totalVersions - 1))}
                                disabled={versionIndex >= totalVersions - 1}
                                className={`p-0.5 rounded transition-colors ${versionIndex < totalVersions - 1 ? 'text-gray-400 hover:text-white hover:bg-white/5' : 'text-gray-700 cursor-default'}`}
                                title="Next version"
                            >
                                <ChevronRight className="w-3 h-3" />
                            </button>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-0.5">
                    {/* Run button */}
                    {running ? (
                        <button
                            onClick={handleKill}
                            title="Kill process"
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                            <Square className="w-3 h-3 fill-current" />
                            <span>Kill</span>
                        </button>
                    ) : (
                        <button
                            onClick={handleRun}
                            title="Run code"
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-green-400 hover:bg-green-500/10 transition-colors"
                        >
                            <Play className="w-3 h-3 fill-current" />
                            <span>Run</span>
                        </button>
                    )}
                    <div className="w-px h-3 bg-white/10 mx-1" />
                    {/* Inline rewrite actions */}
                    {rewriteActions.map(a => (
                        <button
                            key={a.key}
                            onClick={() => handleInlineRewrite(a.key)}
                            title={rewriting ? 'Rewriting...' : a.label}
                            disabled={rewriting}
                            className={`p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors opacity-0 group-hover/code:opacity-100 ${rewriting ? 'opacity-30 cursor-wait' : ''}`}
                        >
                            {a.icon}
                        </button>
                    ))}
                    {/* Tests (goes through chat) */}
                    {showTests && (
                        <button
                            onClick={() => onTestAction(displayCode, 'tests')}
                            title="Tests"
                            className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors opacity-0 group-hover/code:opacity-100"
                        >
                            <TestTube2 className="w-3 h-3" />
                        </button>
                    )}
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
                <code className="text-sm font-mono text-blue-300 leading-relaxed">{displayCode}</code>
            </pre>
            {/* Version action label */}
            {versionIndex >= 0 && versions[versionIndex] && versions[versionIndex].action !== 'original' && (
                <div className="px-3 py-1 border-t border-white/5 bg-white/[0.02]">
                    <span className="text-[10px] text-gray-500">
                        {versions[versionIndex].action} rewrite
                    </span>
                </div>
            )}
            {/* Syntax errors */}
            {checkResult && !checkResult.valid && !checkResult.skipped && (
                <div className="border-t border-red-500/10 bg-red-500/[0.03] px-3 py-2">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-medium text-red-400">Syntax error</span>
                        {autoFixSyntax && onFixSyntax && (
                            <button
                                onClick={() => onFixSyntax(displayCode, checkResult.language || language, checkResult.errors)}
                                className="text-[10px] px-2 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                            >
                                Fix syntax
                            </button>
                        )}
                    </div>
                    {checkResult.errors && (
                        <pre className="text-[10px] font-mono text-red-400/70 mt-1 whitespace-pre-wrap leading-relaxed max-h-24 overflow-y-auto">
                            {checkResult.errors}
                        </pre>
                    )}
                </div>
            )}
            {/* Sandbox output */}
            {showOutput && (
                <div className="border-t border-white/5">
                    <div className="flex items-center justify-between px-3 py-1 bg-white/[0.02]">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-gray-500">Output</span>
                            {running && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
                            {result && (
                                <>
                                    <span className={`text-[10px] font-mono ${result.exit_code === 0 ? 'text-green-500' : 'text-red-400'}`}>
                                        exit {result.exit_code}
                                    </span>
                                    <span className="text-[10px] font-mono text-gray-600">
                                        {result.execution_time}s
                                    </span>
                                    {result.timed_out && (
                                        <span className="text-[10px] text-yellow-500">timeout</span>
                                    )}
                                </>
                            )}
                        </div>
                        <button
                            onClick={() => { setShowOutput(false); setResult(null); }}
                            className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
                        >
                            Close
                        </button>
                    </div>
                    {hasOutput && (
                        <pre className="px-4 py-3 overflow-x-auto max-h-48 overflow-y-auto text-xs font-mono leading-relaxed">
                            {result.stdout && <span className="text-gray-300">{result.stdout}</span>}
                            {result.stderr && <span className="text-red-400/80">{result.stderr}</span>}
                        </pre>
                    )}
                    {running && !hasOutput && (
                        <div className="px-4 py-3 text-xs text-gray-600">Running...</div>
                    )}
                </div>
            )}
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
