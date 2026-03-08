import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { apiClient, cleanModelName } from '../api/client'
import type { SelfAssessment, ConversationMemory, ContentPart, ModelEntry } from '../api/client'
import { PageHeader } from './ui/PageHeader'
import { Settings2, Cpu, ChevronRight, Square, ArrowUp, Wand2, Shield, Zap, FileText, TestTube2, Expand, Shrink, Languages, Briefcase, MessageCircle, GraduationCap, Scale, User, Baby, FlaskConical, Feather, Plus, Download, Loader2, Brain, Database, Search, X, ChevronUp, ChevronDown, ImagePlus, RefreshCcw, Trash2, Pencil, Hash, GitBranch, Eye, Globe, BookOpen } from 'lucide-react'
import { InputOverlay, detectTrigger, SLASH_COMMANDS, type FileEntry } from './Chat/InputOverlay'
import { usePromptHistory } from '../hooks/usePromptHistory'
import { useTokenEstimate } from '../hooks/useTokenEstimate'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeSanitize from 'rehype-sanitize';
import { useTranslation } from 'react-i18next'
import { useGlobalState } from '../context/GlobalState'
import { useConversations } from '../context/ConversationContext'
import { ParametersPanel, type ChatSettings } from './Chat/ParametersPanel'
import { CodeBlock, redactPII } from './Chat/CodeBlock'
import { MemoryMapPanel } from './Chat/MemoryMapPanel'
import { ResponseActions } from './Chat/ResponseActions'

interface SourceRef {
    index: number
    title: string
    url?: string
    method: string
}

interface Message {
    id?: string
    role: 'system' | 'user' | 'assistant'
    content: string
    displayContent?: string
    actionType?: string
    sources?: SourceRef[]
    images?: string[]               // preview URLs for display
    fullContent?: string | ContentPart[]  // actual content sent to API (multipart)
    stats?: {
        tokensPerSecond: number;
        timeToFirstToken: number;
        totalTokens: number;
    }
}

const CHAT_STORAGE_KEY = 'silicon-studio-chat-history';
const SETTINGS_STORAGE_KEY = 'silicon-studio-chat-settings';
const MODEL_SETTINGS_PREFIX = 'silicon-studio-model-settings-';
const CONVERSATIONS_MIGRATED_KEY = 'silicon-studio-conversations-migrated';

function getDefaultSettings(): ChatSettings {
    const allActions = [
        'longer', 'shorter', 'formal', 'casual', 'technical', 'translate',
        'devil', 'perspective_ceo', 'perspective_child', 'perspective_scientist', 'perspective_poet',
        'improve', 'secure', 'faster', 'docs', 'tests', 'selfAssess', 'selfCritique',
    ];
    const defaultEnabledActions: Record<string, boolean> = {};
    allActions.forEach(a => { defaultEnabledActions[a] = true; });
    return {
        systemPrompt: "You are a helpful AI assistant running locally on Apple Silicon.",
        temperature: 0.7,
        maxTokens: 2048,
        topP: 0.9,
        repetitionPenalty: 1.1,
        reasoningMode: 'auto',
        seed: null,
        translateLanguage: '',
        showPrompt: false,
        syntaxCheck: true,
        autoFixSyntax: false,
        enabledActions: defaultEnabledActions,
        memoryMapEnabled: false,
        memoryInterval: 5,
        piiRedaction: false,
        ragEnabled: false,
        ragCollectionId: '',
        webSearchEnabled: false,
    };
}

function loadSettings(storageKey: string): ChatSettings {
    const defaults = getDefaultSettings();
    try {
        const saved = localStorage.getItem(storageKey);
        return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
    } catch {
        return defaults;
    }
}

export function ChatInterface() {
    const { activeModel, setActiveModel, backendReady, pendingChatInput, setPendingChatInput } = useGlobalState()
    const { t } = useTranslation()

    const [messages, setMessages] = useState<Message[]>(() => {
        try {
            const saved = localStorage.getItem(CHAT_STORAGE_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    })
    const [input, setInput] = useState('')
    const [pendingImages, setPendingImages] = useState<{ file: File; preview: string }[]>([])
    const fileInputRef = useRef<HTMLInputElement>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const messagesContainerRef = useRef<HTMLDivElement>(null)
    const userScrolledUpRef = useRef(false)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const abortRef = useRef<AbortController | null>(null)
    const sendingRef = useRef(false)

    // ── Input enhancement state ──
    const promptHistory = usePromptHistory()
    const tokenEstimate = useTokenEstimate(input)
    const [showTokenCounter, setShowTokenCounter] = useState(() => localStorage.getItem('silicon-studio-show-tokens') === 'true')
    const [overlayVisible, setOverlayVisible] = useState(false)
    const [cursorPosition, setCursorPosition] = useState(0)
    const [pastedMultiline, setPastedMultiline] = useState(false)
    const [workspaceFiles, setWorkspaceFiles] = useState<FileEntry[]>([])
    const [gitBranch, setGitBranch] = useState<{ branch: string; clean: boolean } | null>(null)
    const inputWrapperRef = useRef<HTMLDivElement>(null)

    // Abort any in-flight streaming fetch on unmount
    useEffect(() => {
        return () => { abortRef.current?.abort(); };
    }, []);

    const [paramsExpanded, setParamsExpanded] = useState(() => localStorage.getItem('paramsExpanded') === 'true')
    const toggleParams = () => {
        setParamsExpanded(prev => {
            const next = !prev;
            localStorage.setItem('paramsExpanded', String(next));
            return next;
        });
    }
    const [settings, setSettings] = useState<ChatSettings>(() => loadSettings(SETTINGS_STORAGE_KEY))
    const prevModelIdRef = useRef<string | null>(activeModel?.id ?? null)

    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
    const { isGenerating, setIsGenerating } = useGlobalState()

    // Conversation context (list + active ID managed in sidebar)
    const { activeConversationId, setActiveConversationId, fetchConversations, conversationList, handleRenameConversation } = useConversations()
    const activeConversationIdRef = useRef<string | null>(null)
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const skipLoadRef = useRef(false)
    const creatingConvRef = useRef(false)

    // Self-assessment scores per message index
    const [assessments, setAssessments] = useState<Record<number, SelfAssessment | 'loading'>>({})
    // Self-critique loading state per message index
    const [selfCritiqueLoading, setSelfCritiqueLoading] = useState<Record<number, boolean>>({})

    const showError = useCallback((msg: string) => {
        setFlashError(msg);
        setTimeout(() => setFlashError(null), 4000);
    }, []);

    // RAG collections cache
    const [ragCollections, setRagCollections] = useState<{ id: string; name: string; chunks: number }[]>([])
    const fetchRagCollections = useCallback(async () => {
        try {
            const cols = await apiClient.rag.getCollections();
            setRagCollections(cols.map(c => ({ id: c.id, name: c.name, chunks: c.chunks })));
        } catch { /* ignore */ }
    }, []);

    // Semantic memory map
    const [memoryMap, setMemoryMap] = useState<ConversationMemory | null>(null)
    const [showMemoryMap, setShowMemoryMap] = useState(false)
    const [memoryBuilding, setMemoryBuilding] = useState(false)
    const memoryBuildingRef = useRef(false)

    // One-click model walkthrough
    const [walkthroughStep, setWalkthroughStep] = useState<'idle' | 'downloading' | 'loading' | 'done' | 'error'>('idle')
    const [walkthroughModel, setWalkthroughModel] = useState<string | null>(null)
    const [walkthroughError, setWalkthroughError] = useState<string | null>(null)
    const walkthroughPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const [hasDownloadedModels, setHasDownloadedModels] = useState(false)
    const [renamingTitle, setRenamingTitle] = useState<string | null>(null)
    const [flashError, setFlashError] = useState<string | null>(null)
    const [suggestedModel, setSuggestedModel] = useState<ModelEntry | null>(null)
    const [loadingSuggested, setLoadingSuggested] = useState(false)

    const startWalkthrough = async (modelId: string) => {
        setWalkthroughModel(modelId)
        setWalkthroughStep('downloading')
        setWalkthroughError(null)
        try {
            await apiClient.engine.downloadModel(modelId)
            // Poll models list until downloaded (timeout after 5 min)
            const pollStart = Date.now();
            walkthroughPollRef.current = setInterval(async () => {
                if (Date.now() - pollStart > 5 * 60 * 1000) {
                    if (walkthroughPollRef.current) clearInterval(walkthroughPollRef.current);
                    walkthroughPollRef.current = null;
                    setWalkthroughStep('error');
                    setWalkthroughError('Download timed out. Check the Models tab for progress.');
                    return;
                }
                try {
                    const models = await apiClient.engine.getModels()
                    const target = models.find(m => m.id === modelId)
                    if (target?.downloaded) {
                        if (walkthroughPollRef.current) clearInterval(walkthroughPollRef.current)
                        walkthroughPollRef.current = null
                        setWalkthroughStep('loading')
                        try {
                            const loadResult = await apiClient.engine.loadModel(modelId)
                            setActiveModel({
                                id: modelId,
                                name: target.name,
                                size: target.size,
                                path: target.local_path || '',
                                architecture: loadResult.architecture,
                                context_window: loadResult.context_window,
                                is_vision: loadResult.is_vision,
                            })
                            setWalkthroughStep('done')
                        } catch {
                            setWalkthroughStep('error')
                            setWalkthroughError('Download succeeded but failed to load model. Try loading it from the Models tab.')
                        }
                    }
                } catch { /* poll failed, keep trying */ }
            }, 3000)
        } catch {
            setWalkthroughStep('error')
            setWalkthroughError('Failed to start download. Check that the backend is running.')
        }
    }

    // Cleanup walkthrough poll on unmount
    useEffect(() => {
        return () => {
            if (walkthroughPollRef.current) clearInterval(walkthroughPollRef.current)
        }
    }, [])

    // Check once if any models are already downloaded (hide walkthrough if so)
    // Also pick a suggested model: prefer middle-sized downloaded model
    useEffect(() => {
        if (!backendReady) return
        apiClient.engine.getModels()
            .then(models => {
                const downloaded = models.filter(m => m.downloaded)
                if (downloaded.length > 0) {
                    setHasDownloadedModels(true)
                    // Sort by size string (e.g. "1.2 GB") and pick the middle one
                    const sorted = [...downloaded].sort((a, b) => {
                        const parseSize = (s: string) => {
                            const m = s.match(/([\d.]+)\s*(GB|MB)/i)
                            if (!m) return 0
                            return parseFloat(m[1]) * (m[2].toUpperCase() === 'GB' ? 1024 : 1)
                        }
                        return parseSize(a.size) - parseSize(b.size)
                    })
                    const midIdx = Math.floor(sorted.length / 2)
                    setSuggestedModel(sorted[midIdx])
                }
            })
            .catch(err => console.error('Failed to check downloaded models:', err))
    }, [backendReady])

    const handleLoadSuggested = useCallback(async () => {
        if (!suggestedModel || loadingSuggested) return
        setLoadingSuggested(true)
        try {
            const result = await apiClient.engine.loadModel(suggestedModel.id)
            setActiveModel({
                id: suggestedModel.id,
                name: cleanModelName(suggestedModel.name),
                size: suggestedModel.size,
                path: suggestedModel.local_path || suggestedModel.id,
                architecture: suggestedModel.architecture,
                context_window: result.context_window,
                is_vision: result.is_vision,
            })
        } catch (err) {
            console.error('Failed to load suggested model:', err)
        } finally {
            setLoadingSuggested(false)
        }
    }, [suggestedModel, loadingSuggested, setActiveModel])

    // DOM windowing: only render last N messages to avoid DOM bloat on long conversations
    const RENDER_WINDOW = 100;
    const RENDER_PAGE = 50;
    const [renderStart, setRenderStart] = useState(0);
    useEffect(() => {
        // Reset render window when messages change, showing latest messages
        setRenderStart(Math.max(0, messages.length - RENDER_WINDOW));
    }, [messages.length]);

    // In-chat search
    const [showSearch, setShowSearch] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [searchMatchIndex, setSearchMatchIndex] = useState(0)
    const searchInputRef = useRef<HTMLInputElement>(null)

    // Compute search matches: [messageIndex, ...] of messages containing query
    const searchMatches = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return [];
        return messages.reduce<number[]>((acc, msg, i) => {
            if (msg.content.toLowerCase().includes(q)) acc.push(i);
            return acc;
        }, []);
    }, [searchQuery, messages])

    const toggleSearch = () => {
        setShowSearch(prev => {
            if (!prev) setTimeout(() => searchInputRef.current?.focus(), 50)
            else { setSearchQuery(''); setSearchMatchIndex(0) }
            return !prev
        })
    }

    // Ctrl+F to open search
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
                if (messages.length === 0) return; // nothing to search
                e.preventDefault()
                if (!showSearch) toggleSearch()
                else searchInputRef.current?.focus()
            }
        }
        document.addEventListener('keydown', handler)
        return () => document.removeEventListener('keydown', handler)
    }, [showSearch, messages.length])

    // Auto-scroll to first match when search query changes
    useEffect(() => {
        if (searchMatches.length > 0) {
            setSearchMatchIndex(0)
            document.getElementById(`msg-${searchMatches[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
    }, [searchQuery]) // eslint-disable-line react-hooks/exhaustive-deps

    // Keep ref in sync for use in async callbacks; close search on conversation change
    useEffect(() => {
        activeConversationIdRef.current = activeConversationId;
        setShowSearch(false);
        setSearchQuery('');
        setSearchMatchIndex(0);
    }, [activeConversationId])

    // Dynamic defaults: adjust maxTokens when a model with known context_window is loaded
    useEffect(() => {
        const cw = activeModel?.context_window;
        if (!cw) return;
        // Set maxTokens to half the context window, clamped between 2048 and 16384
        const recommended = Math.min(Math.max(Math.floor(cw / 2), 2048), 16384);
        setSettings((prev) => {
            // Only auto-adjust if user hasn't manually changed from a previous default
            // (i.e., the current value is one of the known static defaults)
            const isDefault = prev.maxTokens === 1024 || prev.maxTokens === 512 || prev.maxTokens === 2048;
            if (isDefault || (prev.maxTokens as number) > cw) {
                return { ...prev, maxTokens: recommended };
            }
            return prev;
        });
    }, [activeModel?.context_window]);

    // Consume pending chat input from Notes → Chat bridge
    useEffect(() => {
        if (pendingChatInput) {
            setInput(pendingChatInput);
            setPendingChatInput(null);
            textareaRef.current?.focus();
        }
    }, [pendingChatInput, setPendingChatInput]);

    const currentModelId = activeModel?.id ?? '';
    const currentModelName = activeModel ? cleanModelName(activeModel.name) : '';

    // --- Conversation helpers ---
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
                        skipLoadRef.current = true;
                        setActiveConversationId(conv.id);
                    }
                }
            } catch {
                // migration failed silently
            }
            localStorage.setItem(CONVERSATIONS_MIGRATED_KEY, 'true');
            fetchConversations();
        };
        migrate();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Load conversation when activeConversationId changes from sidebar
    useEffect(() => {
        if (skipLoadRef.current) { skipLoadRef.current = false; return; }
        if (activeConversationId) {
            (async () => {
                try {
                    const conv = await apiClient.conversations.get(activeConversationId);
                    setMessages(conv.messages || []);
                    setAssessments({});
                    setMemoryMap(null);
                    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(conv.messages || []));
                } catch {
                    // load failed silently
                }
            })();
        } else {
            // New conversation
            setMessages([]);
            setAssessments({});
            setMemoryMap(null);
            localStorage.removeItem(CHAT_STORAGE_KEY);
        }
    }, [activeConversationId]); // eslint-disable-line react-hooks/exhaustive-deps

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
                } else if (!creatingConvRef.current) {
                    creatingConvRef.current = true;
                    try {
                        const conv = await apiClient.conversations.create(
                            autoTitle(messages), messages, currentModelId || undefined
                        );
                        skipLoadRef.current = true;
                        setActiveConversationId(conv.id);
                    } finally {
                        creatingConvRef.current = false;
                    }
                }
                fetchConversations();
            } catch {
                // save failed silently
            }
        }, 800);
        return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
    }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
        // Also persist under model-specific key if a model is active
        if (activeModel?.id) {
            localStorage.setItem(MODEL_SETTINGS_PREFIX + activeModel.id, JSON.stringify(settings));
        }
    }, [settings, activeModel?.id]);

    // Load per-model settings when the active model changes
    useEffect(() => {
        const prevId = prevModelIdRef.current;
        const newId = activeModel?.id ?? null;
        if (prevId === newId) return;
        prevModelIdRef.current = newId;
        if (newId) {
            const modelKey = MODEL_SETTINGS_PREFIX + newId;
            setSettings(loadSettings(modelKey));
        }
    }, [activeModel?.id]);

    // Track whether user has scrolled up from the bottom
    const [showScrollDown, setShowScrollDown] = useState(false);
    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) return;
        const handleScroll = () => {
            const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            userScrolledUpRef.current = distanceFromBottom > 150;
            setShowScrollDown(distanceFromBottom > 300);
        };
        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => container.removeEventListener('scroll', handleScroll);
    }, []);

    // Auto-scroll: instant for new messages, smooth for streaming tokens
    const prevMsgLenRef = useRef(messages.length);
    useEffect(() => {
        if (userScrolledUpRef.current) return;
        const container = messagesContainerRef.current;
        if (!container) return;
        const isNewMessage = messages.length !== prevMsgLenRef.current;
        prevMsgLenRef.current = messages.length;
        if (isNewMessage) {
            container.scrollTop = container.scrollHeight;
        } else {
            container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        }
    }, [messages])

    const scrollToBottom = () => {
        const container = messagesContainerRef.current;
        if (container) {
            container.scrollTop = container.scrollHeight;
            userScrolledUpRef.current = false;
            setShowScrollDown(false);
        }
    };

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
        setActiveConversationId(null);
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

    // PII redaction state
    const [redactedCount, setRedactedCount] = useState<number | null>(null);

    const handleRedactConversation = (scope: 'all' | 'outgoing') => {
        let totalCount = 0;
        const updated = messages.map(msg => {
            if (scope === 'outgoing' && msg.role !== 'user') return msg;
            const { text, count } = redactPII(msg.content);
            if (count > 0) {
                totalCount += count;
                return { ...msg, content: text };
            }
            return msg;
        });
        if (totalCount > 0) {
            setMessages(updated);
            localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(updated));
            setRedactedCount(totalCount);
            setTimeout(() => setRedactedCount(null), 3000);
        }
    };

    const handleBranch = async (messageIndex: number) => {
        if (!activeConversationId) return;
        try {
            const branch = await apiClient.conversations.branch(activeConversationId, messageIndex);
            await fetchConversations();
            // Switch to the new branch — skip re-loading since we have the messages
            skipLoadRef.current = true;
            setActiveConversationId(branch.id);
            setMessages(branch.messages);
            localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(branch.messages));
        } catch {
            showError('Failed to branch conversation');
        }
    };

    const handleStop = async () => {
        abortRef.current?.abort();
        try {
            await apiClient.engine.stopChat();
        } catch {
            // stop failed silently
        }
        setIsGenerating(false);
        sendingRef.current = false;
    }

    // ── Vision image helpers ──
    const addImages = useCallback((files: FileList | File[]) => {
        const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
        const maxSize = 20 * 1024 * 1024 // 20 MB
        const newImages = Array.from(files)
            .filter(f => validTypes.includes(f.type) && f.size <= maxSize)
            .map(f => ({ file: f, preview: URL.createObjectURL(f) }))
        setPendingImages(prev => [...prev, ...newImages].slice(0, 4))
    }, [])

    const removeImage = useCallback((index: number) => {
        setPendingImages(prev => {
            URL.revokeObjectURL(prev[index].preview)
            return prev.filter((_, i) => i !== index)
        })
    }, [])

    const fileToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(file)
        })
    }

    const handleImagePaste = useCallback((e: React.ClipboardEvent) => {
        if (!activeModel?.is_vision) return
        const imageFiles: File[] = []
        for (let i = 0; i < e.clipboardData.items.length; i++) {
            const item = e.clipboardData.items[i]
            if (item.type.startsWith('image/')) {
                const file = item.getAsFile()
                if (file) imageFiles.push(file)
            }
        }
        if (imageFiles.length > 0) addImages(imageFiles)
    }, [activeModel?.is_vision, addImages])

    const handleImageDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        if (!activeModel?.is_vision) return
        if (e.dataTransfer.files) addImages(e.dataTransfer.files)
    }, [activeModel?.is_vision, addImages])

    // Clear pending images when switching away from a vision model
    useEffect(() => {
        if (!activeModel?.is_vision && pendingImages.length > 0) {
            pendingImages.forEach(img => URL.revokeObjectURL(img.preview))
            setPendingImages([])
        }
    }, [activeModel?.is_vision])

    // ── Workspace file loading for @mentions ──
    useEffect(() => {
        let cancelled = false
        const loadFiles = async () => {
            try {
                const tree = await apiClient.workspace.tree('.', 3)
                const flat: FileEntry[] = []
                const walk = (node: any) => {
                    if (node.type === 'file') flat.push({ name: node.name, path: node.path, type: 'file' })
                    if (node.children) node.children.forEach(walk)
                }
                if (tree.children) tree.children.forEach(walk)
                else walk(tree)
                if (!cancelled) setWorkspaceFiles(flat)
            } catch { /* workspace not available */ }
        }
        loadFiles()
        return () => { cancelled = true }
    }, [])

    // ── Git branch info ──
    useEffect(() => {
        let cancelled = false
        const fetchGit = async () => {
            try {
                const info = await apiClient.workspace.gitInfo('.')
                if (!cancelled && info.git && info.branch) {
                    setGitBranch({ branch: info.branch, clean: info.clean ?? true })
                }
            } catch { /* no git */ }
        }
        fetchGit()
        // Refresh every 30s
        const timer = setInterval(fetchGit, 30_000)
        return () => { cancelled = true; clearInterval(timer) }
    }, [])

    // ── Detect overlay triggers on input change ──
    useEffect(() => {
        const trigger = detectTrigger(input, cursorPosition)
        setOverlayVisible(trigger !== null)
    }, [input, cursorPosition])

    // ── Slash command handler ──
    const handleSlashCommand = useCallback((action: string) => {
        switch (action) {
            case 'help': {
                const helpText = SLASH_COMMANDS.map(c => `**${c.name}** — ${c.description}`).join('\n')
                setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: `${t('chatInput.availableCommands')}:\n\n${helpText}\n\n${t('chatInput.atMentionHint')}`
                }])
                break
            }
            case 'clear':
                setMessages([])
                setAssessments({})
                setMemoryMap(null)
                localStorage.removeItem(CHAT_STORAGE_KEY)
                break
            case 'new':
                handleNewConversation()
                break
            case 'system':
                setParamsExpanded(true)
                break
            case 'model':
                // Focus model picker in topbar — dispatch custom event
                window.dispatchEvent(new CustomEvent('silicon-studio:open-model-picker'))
                break
            case 'library':
                // Toggle prompt library panel via custom event
                window.dispatchEvent(new CustomEvent('silicon-studio:open-prompt-library'))
                break
            case 'export':
                handleExport('md')
                break
            case 'tokens':
                setShowTokenCounter(prev => {
                    const next = !prev
                    localStorage.setItem('silicon-studio-show-tokens', String(next))
                    return next
                })
                break
        }
        setInput('')
        setOverlayVisible(false)
    }, [t, handleNewConversation, handleExport, setMessages, setAssessments, setMemoryMap, setParamsExpanded])

    // ── Overlay selection handler ──
    const handleOverlaySelect = useCallback((value: string, type: 'command' | 'file') => {
        if (type === 'command') {
            handleSlashCommand(value)
            return
        }

        // File mention: replace the @query with @filepath
        const trigger = detectTrigger(input, cursorPosition)
        if (trigger && trigger.type === 'file') {
            const before = input.slice(0, trigger.startIndex)
            const after = input.slice(cursorPosition)
            const newInput = `${before}@${value} ${after}`
            setInput(newInput)
            // Move cursor after inserted text
            const newPos = trigger.startIndex + value.length + 2 // @ + value + space
            setCursorPosition(newPos)
            setTimeout(() => {
                if (textareaRef.current) {
                    textareaRef.current.selectionStart = newPos
                    textareaRef.current.selectionEnd = newPos
                    textareaRef.current.focus()
                }
            }, 0)
        }
        setOverlayVisible(false)
    }, [input, cursorPosition, handleSlashCommand])

    // ── Paste detection for multi-line text ──
    const handleTextPaste = useCallback((e: React.ClipboardEvent) => {
        // Let image paste handler run first for vision models
        if (activeModel?.is_vision) {
            const hasImages = Array.from(e.clipboardData.items).some(item => item.type.startsWith('image/'))
            if (hasImages) return // handled by handleImagePaste
        }

        const text = e.clipboardData.getData('text/plain')
        if (text && text.includes('\n')) {
            // Mark as pasted multi-line to prevent accidental send
            setPastedMultiline(true)
            // Auto-clear flag after user makes next edit
            setTimeout(() => setPastedMultiline(false), 3000)
        }
    }, [activeModel?.is_vision])

    const handleSend = async (directPrompt?: string, displayContent?: string, actionType?: string) => {
        const text = directPrompt ?? input;
        if ((!text.trim() && pendingImages.length === 0) || !currentModelId || isGenerating || sendingRef.current) return
        sendingRef.current = true

        let assistantMsgId = ''
        try {
            // Build multipart content if images are attached to a vision model
            let fullContent: string | ContentPart[] = text
            const imagePreviewUrls: string[] = []
            if (pendingImages.length > 0 && activeModel?.is_vision) {
                const parts: ContentPart[] = []
                if (text.trim()) {
                    parts.push({ type: 'text', text: text.trim() })
                }
                for (const img of pendingImages) {
                    const dataUrl = await fileToBase64(img.file)
                    parts.push({ type: 'image_url', image_url: { url: dataUrl } })
                    imagePreviewUrls.push(img.preview)
                }
                fullContent = parts
                setPendingImages([])  // clear without revoking — previews still needed for display
            }

            const userMsg: Message = {
                role: 'user',
                content: text || '(image)',
                ...(displayContent && { displayContent }),
                ...(actionType && { actionType }),
                ...(imagePreviewUrls.length > 0 && { images: imagePreviewUrls }),
                ...(Array.isArray(fullContent) && { fullContent }),
            }

            // Show user message and clear input IMMEDIATELY (before async RAG/web search)
            setMessages(prev => [...prev, userMsg])
            if (!directPrompt) setInput('')
            setIsGenerating(true)

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

            // Inject RAG/web search only for direct user messages (skip for action prompts)
            const isDirectMessage = !actionType;
            let sourceIndex = 1;
            const collectedSources: SourceRef[] = [];

            if (isDirectMessage && settings.ragEnabled && settings.ragCollectionId) {
                try {
                    const ragResults = await apiClient.rag.query(settings.ragCollectionId, text, 5);
                    if (ragResults.results.length > 0) {
                        systemContent += '\n\n[KNOWLEDGE BASE]\n' + ragResults.results.map(r => {
                            const idx = sourceIndex++;
                            collectedSources.push({ index: idx, title: r.text.slice(0, 80) + (r.text.length > 80 ? '...' : ''), method: r.method || 'rag' });
                            return `[${idx}] ${r.text}`;
                        }).join('\n---\n');
                        // Record usage for adaptive boosting
                        apiClient.rag.recordUsage(
                            settings.ragCollectionId,
                            ragResults.results.map(r => r.index)
                        ).catch(() => {});
                    }
                } catch {
                    showError('RAG query failed');
                }
            }

            if (isDirectMessage && settings.webSearchEnabled) {
                try {
                    const searchResults = await apiClient.search.web(text, 3, true);
                    if (searchResults.length > 0) {
                        systemContent += '\n\n[WEB SEARCH]\n' + searchResults.map(r => {
                            const idx = sourceIndex++;
                            collectedSources.push({ index: idx, title: r.title, url: r.url, method: 'web' });
                            const body = r.content || r.snippet;
                            return `[${idx}] ${r.title}\n${body}\nSource: ${r.url}`;
                        }).join('\n---\n');
                    }
                } catch {
                    systemContent += '\n\n[Web search unavailable — responding without web results]';
                }
            }

            // Add grounding instructions when context sources are present
            if (collectedSources.length > 0) {
                systemContent += '\n\nIMPORTANT: Base your answer on the provided sources above. Add inline citations like [1], [2] etc. referring to the numbered sources. If the sources don\'t contain enough information, say so.';
            }

            const systemMsg: Message | null = systemContent
                ? { role: 'system', content: systemContent }
                : null
            const conversation = [
                ...(systemMsg ? [systemMsg] : []),
                ...messages,
                userMsg
            ]

            assistantMsgId = crypto.randomUUID()
            const initialAssistantMsg: Message = {
                role: 'assistant',
                content: '',
                id: assistantMsgId,
                sources: collectedSources.length > 0 ? collectedSources : undefined,
                stats: { tokensPerSecond: 0, timeToFirstToken: 0, totalTokens: 0 }
            }
            setMessages(prev => [...prev, initialAssistantMsg])

            const startTime = Date.now()
            let firstTokenTime = 0
            let tokenCount = 0

            abortRef.current?.abort();
            abortRef.current = new AbortController();
            const response = await apiClient.apiFetch(`${apiClient.API_BASE}/api/engine/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: abortRef.current.signal,
                body: JSON.stringify({
                    model_id: currentModelId,
                    messages: conversation.map(m => ({ role: m.role, content: m.fullContent || m.content })),
                    temperature: settings.temperature,
                    max_tokens: settings.maxTokens,
                    top_p: settings.topP,
                    repetition_penalty: settings.repetitionPenalty,
                    ...(settings.seed !== null ? { seed: settings.seed } : {})
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

                            let data: { text?: string; done?: boolean; error?: string }
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
        } catch (err: unknown) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            if (assistantMsgId) {
                setMessages(prev => prev.map(m =>
                    m.id === assistantMsgId ? { ...m, content: `Error: ${err instanceof Error ? err.message : String(err)}` } : m
                ))
            }
        } finally {
            setIsGenerating(false)
            sendingRef.current = false
        }
    }

    const handleDeleteMessage = (msgIndex: number) => {
        if (isGenerating) return;
        // Delete message and its paired response (if user msg) or paired question (if assistant msg)
        setMessages(prev => {
            const msg = prev[msgIndex];
            if (msg.role === 'user' && prev[msgIndex + 1]?.role === 'assistant') {
                return prev.filter((_, i) => i !== msgIndex && i !== msgIndex + 1);
            }
            if (msg.role === 'assistant' && msgIndex > 0 && prev[msgIndex - 1]?.role === 'user') {
                return prev.filter((_, i) => i !== msgIndex && i !== msgIndex - 1);
            }
            return prev.filter((_, i) => i !== msgIndex);
        });
    };

    const handleRetry = (errorMsgIndex: number) => {
        // Find the user message before this error
        const userMsg = messages.slice(0, errorMsgIndex).reverse().find(m => m.role === 'user');
        if (!userMsg) return;
        // Remove the error message
        setMessages(prev => prev.filter((_, i) => i !== errorMsgIndex));
        // Resend
        handleSend(userMsg.content);
    };

    const handleRegenerate = (assistantMsgIndex: number) => {
        // Find the user message before this assistant message
        const userMsg = messages.slice(0, assistantMsgIndex).reverse().find(m => m.role === 'user');
        if (!userMsg) return;
        // Remove the assistant message (keep user message)
        setMessages(prev => prev.filter((_, i) => i !== assistantMsgIndex));
        // Resend the same user prompt
        handleSend(userMsg.content);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Track cursor position for overlay
        const ta = e.currentTarget
        setCursorPosition(ta.selectionStart)

        // If overlay is visible, let it handle arrow keys, Tab, Enter, Escape
        if (overlayVisible) {
            if (['ArrowUp', 'ArrowDown', 'Tab', 'Escape'].includes(e.key)) return // handled by InputOverlay
            if (e.key === 'Enter') return // handled by InputOverlay (selects item)
        }

        // Prompt history navigation (only when cursor at start of input and no overlay)
        if (e.key === 'ArrowUp' && ta.selectionStart === 0 && !e.shiftKey) {
            const prev = promptHistory.navigateUp(input)
            if (prev !== null) {
                e.preventDefault()
                setInput(prev)
            }
            return
        }
        if (e.key === 'ArrowDown' && ta.selectionEnd === input.length && !e.shiftKey) {
            const next = promptHistory.navigateDown()
            if (next !== null) {
                e.preventDefault()
                setInput(next)
            }
            return
        }

        // Send on Enter (not Shift+Enter)
        if (e.key === 'Enter' && !e.shiftKey) {
            // If just pasted multi-line text, first Enter clears the flag instead of sending
            if (pastedMultiline) {
                setPastedMultiline(false)
                return // don't send, don't prevent default (allows newline)
            }
            e.preventDefault()
            // Check for slash command
            const trigger = detectTrigger(input, ta.selectionStart)
            if (trigger?.type === 'command' && input.trim().startsWith('/')) {
                const cmd = SLASH_COMMANDS.find(c => c.name === input.trim() || c.name === '/' + trigger.query)
                if (cmd) {
                    handleSlashCommand(cmd.action)
                    return
                }
            }
            // Save to history and send
            promptHistory.push(input)
            handleSend()
        }

        // Reset history navigation on any typing
        if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
            promptHistory.reset()
            if (pastedMultiline && (e.key === 'Backspace' || e.key === 'Delete')) {
                setPastedMultiline(false)
            }
        }
    }

    const copyToClipboard = (text: string, index: number) => {
        navigator.clipboard.writeText(text);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
    }

    const codeActionPrompts: Record<string, (code: string, ctx?: string) => string> = {
        improve: (c) => `Improve the following code. Make it cleaner, more readable, and more idiomatic. Return ONLY the improved code inside a single code block, no explanation.\n\n\`\`\`\n${c}\n\`\`\``,
        secure: (c) => `Review the following code for security vulnerabilities. Fix any issues you find. Return ONLY the secured code inside a single code block, no explanation.\n\n\`\`\`\n${c}\n\`\`\``,
        faster: (c) => `Optimize the following code for performance. Return ONLY the optimized code inside a single code block, no explanation.\n\n\`\`\`\n${c}\n\`\`\``,
        docs: (c) => `Add documentation to the following code. Add docstrings, type hints, and inline comments where helpful. Do NOT change any logic. Return ONLY the documented code inside a single code block, no explanation.\n\n\`\`\`\n${c}\n\`\`\``,
        fix: (c, errors) => `Fix the syntax errors in the following code. The syntax checker reported:\n\n${errors}\n\nCode:\n\`\`\`\n${c}\n\`\`\`\n\nReturn ONLY the fixed code inside a single code block, no explanation.`,
    };

    // Inline rewrite: streams tokens via callback, returns final code
    const rewriteSnippet = useCallback(async (code: string, action: string, context?: string, onToken?: (partial: string) => void): Promise<string> => {
        const buildPrompt = codeActionPrompts[action];
        if (!buildPrompt || !currentModelId) throw new Error('Cannot rewrite');
        const prompt = buildPrompt(code, context);
        const response = await apiClient.apiFetch(`${apiClient.API_BASE}/api/engine/chat`, {
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
                            if (data.text) {
                                accumulated += data.text;
                                // Stream partial extraction to callback
                                if (onToken) {
                                    const partial = accumulated
                                        .replace(/<(?:think|talk)>[\s\S]*?<\/(?:think|talk)>/g, '')
                                        .replace(/<(?:think|talk)>[\s\S]*/g, '')
                                        .trim();
                                    const fence = partial.match(/```[\w]*\n([\s\S]*)/);
                                    const display = fence ? fence[1].replace(/```\s*$/, '').trimEnd() : partial;
                                    if (display) onToken(display);
                                }
                            }
                            if (data.done) break;
                        } catch { continue; }
                    }
                }
            }
        }
        // Strip <think>/<talk> blocks (some models emit them even for code tasks)
        const cleaned = accumulated
            .replace(/<(?:think|talk)>[\s\S]*?<\/(?:think|talk)>/g, '')
            .replace(/<\/?(?:think|talk)[^>]*>/g, '')
            .trim();
        // Extract code from markdown fence
        const fenceMatch = cleaned.match(/```[\w]*\n([\s\S]*?)```/);
        return fenceMatch ? fenceMatch[1].trimEnd() : cleaned.trim();
    }, [currentModelId, settings.temperature, settings.maxTokens]); // eslint-disable-line react-hooks/exhaustive-deps

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
            const res = await apiClient.apiFetch(`${apiClient.API_BASE}/api/engine/chat`, {
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
        } catch {
            setAssessments(prev => {
                const next = { ...prev };
                delete next[msgIndex];
                return next;
            });
            showError('Assessment failed');
        }
    };

    // Self-Critique: iterative critique→improve loop
    const handleSelfCritique = async (originalResponse: string, msgIndex: number) => {
        if (!currentModelId || selfCritiqueLoading[msgIndex]) return;
        setSelfCritiqueLoading(prev => ({ ...prev, [msgIndex]: true }));

        // Find the user question that preceded this response
        const userQuestion = messages.slice(0, msgIndex).reverse().find(m => m.role === 'user')?.content || '';
        // Determine iterations based on context window size (smaller models get fewer)
        const contextWindow = activeModel?.context_window || 4096;
        const iterations = contextWindow >= 8192 ? 2 : 1;

        try {
            let currentResponse = originalResponse;
            for (let i = 0; i < iterations; i++) {
                // Step 1: Critique
                const critiquePrompt = `You are a strict reviewer. Analyze this AI response to the user's question and generate 3-5 pointed, specific critiques. Focus on accuracy, completeness, clarity, and missed aspects. Be direct and honest.

User question: ${userQuestion}

AI response: ${currentResponse}

Return ONLY the numbered critiques, nothing else.`;

                const critiqueResponse = await apiClient.apiFetch(`${apiClient.API_BASE}/api/engine/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model_id: currentModelId,
                        messages: [{ role: 'user', content: critiquePrompt }],
                        temperature: 0.4,
                        max_tokens: Math.min(settings.maxTokens, 1024),
                    })
                });
                if (!critiqueResponse.ok) throw new Error('Critique step failed');
                let critique = '';
                const reader1 = critiqueResponse.body?.getReader();
                const decoder1 = new TextDecoder();
                let buf1 = '';
                if (reader1) {
                    while (true) {
                        const { done, value } = await reader1.read();
                        if (done) break;
                        buf1 += decoder1.decode(value, { stream: true });
                        const lines = buf1.split('\n');
                        buf1 = lines.pop() ?? '';
                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                try { const d = JSON.parse(line.slice(6)); if (d.text) critique += d.text; } catch { /* skip */ }
                            }
                        }
                    }
                }

                // Step 2: Improve
                const improvePrompt = `Rewrite and improve the following AI response, addressing ALL of these critiques. Return ONLY the improved response, nothing else.

Original question: ${userQuestion}

Original response: ${currentResponse}

Critiques to address:
${critique}

Improved response:`;

                const improveResponse = await apiClient.apiFetch(`${apiClient.API_BASE}/api/engine/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model_id: currentModelId,
                        messages: [{ role: 'user', content: improvePrompt }],
                        temperature: 0.5,
                        max_tokens: settings.maxTokens,
                    })
                });
                if (!improveResponse.ok) throw new Error('Improve step failed');
                let improved = '';
                const reader2 = improveResponse.body?.getReader();
                const decoder2 = new TextDecoder();
                let buf2 = '';
                if (reader2) {
                    while (true) {
                        const { done, value } = await reader2.read();
                        if (done) break;
                        buf2 += decoder2.decode(value, { stream: true });
                        const lines = buf2.split('\n');
                        buf2 = lines.pop() ?? '';
                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                try { const d = JSON.parse(line.slice(6)); if (d.text) improved += d.text; } catch { /* skip */ }
                            }
                        }
                    }
                }
                currentResponse = improved.trim() || currentResponse;
            }

            // Append the improved response as a new assistant message
            const label = `*Self-Critique — ${iterations} iteration${iterations > 1 ? 's' : ''}*\n\n`;
            const improvedMsg: Message = {
                role: 'assistant',
                content: label + currentResponse,
                id: Date.now().toString(),
            };
            setMessages(prev => [...prev, improvedMsg]);
        } catch {
            showError('Self-critique failed');
        } finally {
            setSelfCritiqueLoading(prev => ({ ...prev, [msgIndex]: false }));
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
            const res = await apiClient.apiFetch(`${apiClient.API_BASE}/api/engine/chat`, {
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
        } catch {
            showError('Memory map build failed');
        } finally {
            setMemoryBuilding(false);
            memoryBuildingRef.current = false;
        }
        return null;
    }, [currentModelId]);

    const sendCodeAction = useCallback((code: string, _action: string) => {
        if (isGenerating || !currentModelId) return;
        // Tests go through chat (produces a separate file, not a rewrite)
        const prompt = `Write tests for the following code. Do NOT modify the original code. Generate a complete test file with good coverage of edge cases, typical usage, and error conditions. Use the most appropriate testing framework for the language.\n\n\`\`\`\n${code}\n\`\`\``;
        const lineCount = code.split('\n').length;
        const display = `**Tests** — ${lineCount} lines`;
        handleSend(prompt, display, 'tests');
    }, [isGenerating, currentModelId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Memoize ReactMarkdown components so CodeBlock instances are not remounted on unrelated re-renders
    const markdownComponents = useMemo(() => ({
        hr: () => <hr className="border-white/[0.03] my-3" />,
        code({ className, children }: { className?: string; children?: React.ReactNode }) {
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
                    piiRedaction={settings.piiRedaction}
                />
            );
        },
        pre({ children }: { children?: React.ReactNode }) {
            // Let CodeBlock handle its own wrapper
            return <>{children}</>;
        },
        table({ children }: { children?: React.ReactNode }) {
            return <div className="overflow-x-auto my-3"><table className="min-w-full">{children}</table></div>;
        }
    }), [sendCodeAction, rewriteSnippet, settings.enabledActions, settings.syntaxCheck, settings.autoFixSyntax, settings.piiRedaction]);

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
        <div className="h-full flex flex-col text-white overflow-hidden px-4 pt-2">
            <PageHeader>
                <div className="flex items-center gap-2">
                    {activeConversationId && (() => {
                        const conv = conversationList.find(c => c.id === activeConversationId);
                        const title = conv?.title || 'Untitled';
                        if (renamingTitle !== null) {
                            return (
                                <input
                                    type="text"
                                    value={renamingTitle}
                                    onChange={(e) => setRenamingTitle(e.target.value)}
                                    onBlur={() => {
                                        if (renamingTitle.trim() && renamingTitle !== title) {
                                            handleRenameConversation(activeConversationId, renamingTitle.trim());
                                        }
                                        setRenamingTitle(null);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                        if (e.key === 'Escape') setRenamingTitle(null);
                                    }}
                                    autoFocus
                                    className="text-xs text-gray-300 bg-white/5 border border-white/10 rounded px-2 py-1 outline-none focus:border-white/20 max-w-[200px]"
                                    placeholder={t('chat.titlePlaceholder')}
                                />
                            );
                        }
                        return (
                            <button
                                type="button"
                                onClick={() => setRenamingTitle(title)}
                                className="group/rename flex items-center gap-1.5 px-2 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors max-w-[200px] truncate"
                                title={t('chat.rename')}
                            >
                                <Pencil className="w-3 h-3 shrink-0 opacity-0 group-hover/rename:opacity-100 transition-opacity" />
                                <span className="truncate">{title}</span>
                            </button>
                        );
                    })()}
                    {activeConversationId && <div className="w-px h-4 bg-white/10" />}
                    {messages.length > 0 && (
                        <button
                            type="button"
                            onClick={handleNewConversation}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            {t('chat.new')}
                        </button>
                    )}
                    {messages.length > 0 && (
                        <div className="relative group/export">
                            <button
                                type="button"
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                            >
                                <Download className="w-3.5 h-3.5" />
                                {t('chat.export')}
                            </button>
                            <div className="hidden group-hover/export:block absolute top-full left-0 pt-1 z-50">
                                <div className="bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl py-1 min-w-[110px]">
                                    <button
                                        type="button"
                                        onClick={() => handleExport('md')}
                                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                                    >
                                        {t('chat.exportMarkdown')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleExport('json')}
                                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                                    >
                                        {t('chat.exportJson')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    {settings.piiRedaction && messages.length > 0 && (
                        <div className="relative group/redact">
                            <button
                                type="button"
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                            >
                                <Shield className="w-3.5 h-3.5" />
                                {t('chat.redact')}
                                {redactedCount !== null && (
                                    <span className="text-[10px] font-mono text-emerald-400 ml-1">{redactedCount}</span>
                                )}
                            </button>
                            <div className="hidden group-hover/redact:block absolute top-full left-0 pt-1 z-50">
                                <div className="bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl py-1 min-w-[140px]">
                                    <button
                                        type="button"
                                        onClick={() => handleRedactConversation('all')}
                                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                                    >
                                        {t('chat.redactAll')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleRedactConversation('outgoing')}
                                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                                    >
                                        {t('chat.redactMyOnly')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    {messages.length > 0 && (
                        <button
                            type="button"
                            onClick={toggleSearch}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${showSearch ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                            title={t('chat.searchTitle')}
                        >
                            <Search className="w-3.5 h-3.5" />
                            {t('chat.search')}
                        </button>
                    )}
                    {settings.memoryMapEnabled && messages.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setShowMemoryMap(!showMemoryMap)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${showMemoryMap ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                        >
                            <Brain className="w-3.5 h-3.5" />
                            {memoryBuilding ? t('chat.memoryBuilding') : t('chat.memory')}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={toggleParams}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${paramsExpanded ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                    >
                        <Settings2 className="w-3.5 h-3.5" />
                        {t('chat.parameters')}
                    </button>
                </div>
            </PageHeader>

            {/* Parameters Panel — full width, collapsible */}
            {paramsExpanded && (
                <ParametersPanel
                    settings={settings}
                    setSettings={setSettings}
                    maxContextWindow={activeModel?.context_window || 32768}
                    ragCollections={ragCollections}
                    fetchRagCollections={fetchRagCollections}
                />
            )}

            {/* Flash error banner */}
            {flashError && (
                <div className="shrink-0 px-4 py-2 bg-red-500/10 border-b border-red-500/20 flex items-center justify-between">
                    <span className="text-xs text-red-400">{flashError}</span>
                    <button type="button" onClick={() => setFlashError(null)} className="text-red-400/60 hover:text-red-400" aria-label="Dismiss error">
                        <X size={14} />
                    </button>
                </div>
            )}

            <div className="flex-1 flex flex-col overflow-hidden min-h-0 relative">

                    {/* Search Bar */}
                    {showSearch && (
                        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-black/30 shrink-0">
                            <Search size={14} className="text-gray-500 shrink-0" />
                            <input
                                ref={searchInputRef}
                                value={searchQuery}
                                onChange={(e) => { setSearchQuery(e.target.value); setSearchMatchIndex(0); }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && searchMatches.length > 0) {
                                        const next = e.shiftKey
                                            ? (searchMatchIndex - 1 + searchMatches.length) % searchMatches.length
                                            : (searchMatchIndex + 1) % searchMatches.length;
                                        setSearchMatchIndex(next);
                                        document.getElementById(`msg-${searchMatches[next]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    }
                                    if (e.key === 'Escape') toggleSearch();
                                }}
                                placeholder={t('chat.searchPlaceholder')}
                                className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
                            />
                            {searchQuery && (
                                <div className="flex items-center gap-1 shrink-0">
                                    <span className="text-[10px] text-gray-500 tabular-nums">
                                        {searchMatches.length > 0
                                            ? `${searchMatchIndex + 1}/${searchMatches.length}`
                                            : t('chat.searchNoResults')}
                                    </span>
                                    {searchMatches.length > 1 && (
                                        <>
                                            <button
                                                onClick={() => {
                                                    const prev = (searchMatchIndex - 1 + searchMatches.length) % searchMatches.length;
                                                    setSearchMatchIndex(prev);
                                                    document.getElementById(`msg-${searchMatches[prev]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                }}
                                                className="p-0.5 rounded text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
                                                title={t('chat.searchPrev')}
                                            >
                                                <ChevronUp size={14} />
                                            </button>
                                            <button
                                                onClick={() => {
                                                    const next = (searchMatchIndex + 1) % searchMatches.length;
                                                    setSearchMatchIndex(next);
                                                    document.getElementById(`msg-${searchMatches[next]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                }}
                                                className="p-0.5 rounded text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
                                                title={t('chat.searchNext')}
                                            >
                                                <ChevronDown size={14} />
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}
                            <button onClick={toggleSearch} className="text-gray-500 hover:text-white transition-colors shrink-0" title={t('chat.searchClose')}>
                                <X size={14} />
                            </button>
                        </div>
                    )}

                    {/* Messages */}
                    <div ref={messagesContainerRef} className="flex-1 overflow-y-auto">
                        {messages.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center">
                                <div className="text-center max-w-md">
                                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-4">
                                        <Cpu className="w-5 h-5 text-gray-500" />
                                    </div>
                                    {currentModelName ? (
                                        <p className="text-sm text-gray-400 mb-1">
                                            {t('chat.readyWith', { model: currentModelName })}
                                        </p>
                                    ) : (
                                        <div className="flex items-center justify-center gap-2 mb-1">
                                            <span className="text-sm text-gray-400">{t('chat.noModel')}</span>
                                            {suggestedModel && (
                                                <>
                                                    <span className="text-sm text-gray-600">—</span>
                                                    <button
                                                        type="button"
                                                        onClick={handleLoadSuggested}
                                                        disabled={loadingSuggested}
                                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/20 text-blue-400 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                                                    >
                                                        {loadingSuggested ? (
                                                            <Loader2 className="w-3 h-3 animate-spin" />
                                                        ) : (
                                                            <Zap className="w-3 h-3" />
                                                        )}
                                                        {loadingSuggested ? 'Loading...' : `Load ${cleanModelName(suggestedModel.name)}`}
                                                        {suggestedModel.size && !loadingSuggested && (
                                                            <span className="text-blue-400/50 font-mono text-[10px]">{suggestedModel.size}</span>
                                                        )}
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    )}
                                    <p className="text-xs text-gray-500">
                                        {currentModelId
                                            ? t('chat.typeMessage')
                                            : !suggestedModel ? t('chat.loadModelPrompt') : ''
                                        }
                                    </p>

                                    {/* One-click model download walkthrough */}
                                    {!currentModelId && backendReady && !hasDownloadedModels && walkthroughStep !== 'done' && (
                                        <div className="mt-6 p-4 bg-white/[0.02] border border-white/5 rounded-xl max-w-sm mx-auto">
                                            {walkthroughStep === 'idle' && (
                                                <>
                                                    <p className="text-xs text-gray-400 mb-3">{t('chat.walkthrough.noModels')}</p>
                                                    <button
                                                        onClick={() => startWalkthrough('mlx-community/Qwen3-0.6B-4bit')}
                                                        className="w-full flex items-center gap-3 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold transition-colors mb-2"
                                                    >
                                                        <Download className="w-4 h-4" />
                                                        {t('chat.walkthrough.downloadQwen')}
                                                    </button>
                                                    <button
                                                        onClick={() => startWalkthrough('mlx-community/Llama-3.2-1B-Instruct-4bit')}
                                                        className="w-full flex items-center gap-3 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg text-xs transition-colors"
                                                    >
                                                        <Download className="w-3.5 h-3.5" />
                                                        {t('chat.walkthrough.downloadLlama')}
                                                    </button>
                                                </>
                                            )}
                                            {walkthroughStep === 'downloading' && (
                                                <div className="flex items-center gap-3 text-sm text-gray-300">
                                                    <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin shrink-0" />
                                                    <div className="text-left">
                                                        <p className="font-medium">{t('chat.walkthrough.downloading', { model: walkthroughModel?.split('/').pop() })}</p>
                                                        <p className="text-xs text-gray-500 mt-0.5">{t('chat.walkthrough.downloadWait')}</p>
                                                    </div>
                                                </div>
                                            )}
                                            {walkthroughStep === 'loading' && (
                                                <div className="flex items-center gap-3 text-sm text-gray-300">
                                                    <div className="w-5 h-5 border-2 border-green-500/30 border-t-green-500 rounded-full animate-spin shrink-0" />
                                                    <div className="text-left">
                                                        <p className="font-medium">{t('chat.walkthrough.loadingModel')}</p>
                                                        <p className="text-xs text-gray-500 mt-0.5">{t('chat.walkthrough.almostReady')}</p>
                                                    </div>
                                                </div>
                                            )}
                                            {walkthroughStep === 'error' && (
                                                <div className="text-left">
                                                    <p className="text-sm text-red-400 mb-2">{walkthroughError}</p>
                                                    <button
                                                        onClick={() => { setWalkthroughStep('idle'); setWalkthroughError(null) }}
                                                        className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                                                    >
                                                        {t('chat.walkthrough.tryAgain')}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="max-w-3xl mx-auto py-6 px-4">
                                {renderStart > 0 && (
                                    <button
                                        onClick={() => setRenderStart(Math.max(0, renderStart - RENDER_PAGE))}
                                        className="w-full py-2 mb-4 text-xs text-gray-500 hover:text-gray-300 bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 rounded-lg transition-colors"
                                    >
                                        {t('chat.showEarlier', { count: Math.min(renderStart, RENDER_PAGE), hidden: renderStart })}
                                    </button>
                                )}
                                {messages.slice(renderStart).map((msg, relIdx) => {
                                    const idx = renderStart + relIdx;
                                    let thinkingContent = '';
                                    let visibleContent = msg.content;

                                    if (msg.role === 'assistant') {
                                        const closedMatch = msg.content.match(/<(?:think|talk)>([\s\S]*?)<\/(?:think|talk)>/);
                                        if (closedMatch) {
                                            thinkingContent = closedMatch[1].trim();
                                            visibleContent = msg.content.replace(/<(?:think|talk)>[\s\S]*?<\/(?:think|talk)>/, '').trim();
                                        } else if (msg.content.match(/^<(?:think|talk)>/)) {
                                            thinkingContent = msg.content.replace(/^<(?:think|talk)>/, '').trim();
                                            visibleContent = '';
                                        }
                                    }

                                    if (msg.role === 'user') {
                                        const isLastMsg = idx === messages.length - 1 || (idx === messages.length - 2 && messages[messages.length - 1]?.role === 'assistant');
                                        const showSpinner = isLastMsg && isGenerating;

                                        const isSearchHit = searchQuery && searchMatches.includes(idx);
                                        const isActiveHit = isSearchHit && searchMatches[searchMatchIndex] === idx;

                                        return (
                                            <div key={idx} id={`msg-${idx}`} className={`mb-6 group rounded-lg transition-colors ${isActiveHit ? 'bg-yellow-500/10 ring-1 ring-yellow-500/30' : isSearchHit ? 'bg-white/[0.02]' : ''}`}>
                                                <div className="flex items-start gap-3">
                                                    <div className="w-6 h-6 rounded-md bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                                                        <User size={14} className="text-gray-400" />
                                                    </div>
                                                    {msg.displayContent ? (
                                                        <details className="min-w-0 group/action">
                                                            <summary className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-sm text-gray-300 cursor-pointer select-none list-none hover:bg-white/[0.06] transition-colors">
                                                                <span className="text-blue-400 shrink-0">
                                                                    {(msg.actionType && ACTION_ICONS[msg.actionType]) || <Settings2 className="w-3.5 h-3.5" />}
                                                                </span>
                                                                <ReactMarkdown
                                                                    remarkPlugins={[remarkGfm]}
                                                                    rehypePlugins={[rehypeSanitize]}
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
                                                        <div className="prose prose-invert prose-sm max-w-none text-gray-200 leading-relaxed prose-p:my-2 prose-pre:bg-black/30 prose-pre:border prose-pre:border-white/5 prose-pre:rounded-lg prose-code:text-blue-300 prose-code:font-normal prose-headings:font-semibold prose-headings:text-gray-100 prose-hr:border-transparent min-w-0">
                                                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}
                                                                rehypePlugins={[rehypeSanitize]}
                                                                components={{ hr: () => <hr className="border-white/[0.03] my-3" /> }}
                                                            >
                                                                {msg.content}
                                                            </ReactMarkdown>
                                                        </div>
                                                    )}
                                                </div>
                                                {msg.images && msg.images.length > 0 && (
                                                    <div className="flex gap-2 mt-2 ml-9">
                                                        {msg.images.map((src, i) => (
                                                            <img key={i} src={src} className="max-w-[200px] max-h-[200px] rounded-lg border border-white/10 object-cover" alt="Attached" />
                                                        ))}
                                                    </div>
                                                )}
                                                {!isGenerating && (
                                                    <div className="ml-9 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteMessage(idx)}
                                                            className="p-1 rounded text-gray-700 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                                            aria-label="Delete message"
                                                            title={t('chat.deleteMessage')}
                                                        >
                                                            <Trash2 className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    }

                                    const isSearchHitAst = searchQuery && searchMatches.includes(idx);
                                    const isActiveHitAst = isSearchHitAst && searchMatches[searchMatchIndex] === idx;

                                    return (
                                        <div key={idx} id={`msg-${idx}`} className={`mb-6 group rounded-lg transition-colors ${isActiveHitAst ? 'bg-yellow-500/10 ring-1 ring-yellow-500/30' : isSearchHitAst ? 'bg-white/[0.02]' : ''}`}>
                                            <div className="flex items-start gap-3">
                                                <img src="/icon.svg" alt="" className="w-6 h-6 rounded-md shrink-0 mt-1" />
                                                <div className="min-w-0 flex-1">
                                                    {/* Reasoning trace */}
                                                    {thinkingContent && (
                                                        <details className="mb-3">
                                                            <summary className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-500 hover:text-gray-400 transition-colors select-none py-0.5">
                                                                <ChevronRight className="w-3 h-3 transition-transform details-open:rotate-90" />
                                                                <span>{t('chat.reasoning')}</span>
                                                                <span className="text-gray-600 ml-1">
                                                                    {t('chat.reasoningWords', { count: thinkingContent.split(/\s+/).length })}
                                                                </span>
                                                            </summary>
                                                            <div className="mt-2 pl-4 border-l border-white/5 text-xs text-gray-500 leading-relaxed max-h-64 overflow-y-auto">
                                                                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeSanitize]} components={{ hr: () => <hr className="border-white/[0.03] my-2" /> }}>
                                                                    {thinkingContent}
                                                                </ReactMarkdown>
                                                            </div>
                                                        </details>
                                                    )}

                                                    {/* Response */}
                                                    {!visibleContent && !thinkingContent && isGenerating && idx === messages.length - 1 ? (
                                                        <div className="flex items-center gap-1.5 py-2">
                                                            <div className="flex gap-1">
                                                                <div className="w-1.5 h-1.5 bg-blue-400/60 rounded-full animate-bounce [animation-delay:0ms]" />
                                                                <div className="w-1.5 h-1.5 bg-blue-400/60 rounded-full animate-bounce [animation-delay:150ms]" />
                                                                <div className="w-1.5 h-1.5 bg-blue-400/60 rounded-full animate-bounce [animation-delay:300ms]" />
                                                            </div>
                                                            <span className="text-xs text-gray-500 ml-1">{t('chat.thinking')}</span>
                                                        </div>
                                                    ) : (
                                                        <div className="prose prose-invert prose-sm max-w-none text-gray-200 leading-relaxed prose-p:my-2 prose-pre:bg-transparent prose-pre:p-0 prose-pre:m-0 prose-code:text-blue-300 prose-code:font-normal prose-headings:font-semibold prose-headings:text-gray-100 prose-hr:border-transparent">
                                                            <ReactMarkdown
                                                                remarkPlugins={[remarkGfm, remarkBreaks]}
                                                                rehypePlugins={[rehypeSanitize]}
                                                                components={markdownComponents}
                                                            >
                                                                {visibleContent}
                                                            </ReactMarkdown>
                                                        </div>
                                                    )}

                                                    {/* Sources citations */}
                                                    {msg.sources && msg.sources.length > 0 && visibleContent && (
                                                        <details className="group mt-2 border border-white/5 rounded-lg overflow-hidden">
                                                            <summary className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-gray-500 hover:text-gray-400 cursor-pointer select-none bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                                                                <Database size={12} className="shrink-0" />
                                                                <span>{t('chat.sources', { count: msg.sources.length })}</span>
                                                                <ChevronDown size={12} className="ml-auto group-open:rotate-180 transition-transform" />
                                                            </summary>
                                                            <div className="px-3 py-2 space-y-1.5 bg-white/[0.01]">
                                                                {msg.sources.map(src => (
                                                                    <div key={src.index} className="flex items-start gap-2 text-[11px]">
                                                                        <span className="shrink-0 w-5 h-5 flex items-center justify-center rounded bg-white/5 text-gray-500 font-mono text-[10px]">{src.index}</span>
                                                                        <div className="min-w-0 flex-1">
                                                                            {src.url ? (
                                                                                <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-blue-400/80 hover:text-blue-300 truncate block" title={src.url}>{src.title}</a>
                                                                            ) : (
                                                                                <span className="text-gray-400 truncate block">{src.title}</span>
                                                                            )}
                                                                        </div>
                                                                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium ${src.method === 'web' ? 'bg-green-500/10 text-green-500/70' : 'bg-blue-500/10 text-blue-500/70'}`}>
                                                                            {src.method === 'web' ? 'web' : 'rag'}
                                                                        </span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </details>
                                                    )}

                                                    {/* Error retry */}
                                                    {visibleContent.startsWith('Error:') && !isGenerating && (
                                                        <button
                                                            onClick={() => handleRetry(idx)}
                                                            className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
                                                            aria-label="Retry message"
                                                        >
                                                            <RefreshCcw size={12} />
                                                            {t('chat.retry')}
                                                        </button>
                                                    )}

                                                    {/* Footer: actions + stats, single row on hover */}
                                                    {visibleContent && !visibleContent.startsWith('Error:') && (
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
                                                            onSelfCritique={settings.enabledActions?.selfCritique !== false ? () => handleSelfCritique(visibleContent, idx) : undefined}
                                                            selfCritiqueLoading={!!selfCritiqueLoading[idx]}
                                                            disabled={isGenerating}
                                                            onRegenerate={() => handleRegenerate(idx)}
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

                    {/* Scroll to bottom button */}
                    {showScrollDown && (
                        <button
                            type="button"
                            onClick={scrollToBottom}
                            className="absolute bottom-20 right-6 z-20 p-2 rounded-full bg-white/10 border border-white/10 text-gray-400 hover:text-white hover:bg-white/15 transition-colors shadow-lg backdrop-blur-sm"
                            title={t('chat.scrollToBottom')}
                        >
                            <ChevronDown className="w-4 h-4" />
                        </button>
                    )}

                    {/* Memory Map Panel */}
                    {showMemoryMap && settings.memoryMapEnabled && (
                        <MemoryMapPanel memory={memoryMap} building={memoryBuilding} />
                    )}

                    {/* Input Area */}
                    <div className="px-4 pb-4 pt-3 shrink-0"
                        onDragOver={(e) => { if (activeModel?.is_vision) e.preventDefault() }}
                        onDrop={handleImageDrop}
                    >
                        <div className="max-w-3xl mx-auto">
                            {/* Image previews */}
                            {pendingImages.length > 0 && (
                                <div className="flex gap-2 px-2 pb-2">
                                    {pendingImages.map((img, i) => (
                                        <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-white/10 group">
                                            <img src={img.preview} className="w-full h-full object-cover" alt="" />
                                            <button
                                                type="button"
                                                title="Remove image"
                                                onClick={() => removeImage(i)}
                                                className="absolute top-0 right-0 p-0.5 bg-black/70 rounded-bl text-gray-300 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {/* Hidden file input for image attachment */}
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/png,image/jpeg,image/gif,image/webp"
                                multiple
                                title="Select images to attach"
                                className="hidden"
                                onChange={(e) => { if (e.target.files) addImages(e.target.files); e.target.value = '' }}
                            />
                            {/* Input field */}
                            <div ref={inputWrapperRef} className="relative bg-white/[0.03] border border-white/10 rounded-xl focus-within:border-white/20 transition-colors">
                                {/* Autocomplete overlay */}
                                <InputOverlay
                                    input={input}
                                    cursorPosition={cursorPosition}
                                    visible={overlayVisible}
                                    onSelect={handleOverlaySelect}
                                    onClose={() => setOverlayVisible(false)}
                                    files={workspaceFiles}
                                    anchorRef={inputWrapperRef}
                                />
                                <textarea
                                    ref={textareaRef}
                                    value={input}
                                    onChange={(e) => {
                                        setInput(e.target.value)
                                        setCursorPosition(e.target.selectionStart)
                                    }}
                                    onKeyDown={handleKeyDown}
                                    onPaste={(e) => { handleTextPaste(e); handleImagePaste(e) }}
                                    onClick={(e) => setCursorPosition((e.target as HTMLTextAreaElement).selectionStart)}
                                    placeholder={activeModel?.is_vision ? t('chat.sendPlaceholderVision') : t('chat.sendPlaceholder')}
                                    className={`w-full bg-transparent px-4 py-3 ${activeModel?.is_vision ? 'pr-24' : 'pr-14'} text-sm text-gray-200 placeholder-gray-500 outline-none resize-none min-h-[44px] max-h-[200px]`}
                                    rows={1}
                                />
                                <div className="absolute right-2 bottom-2 flex items-center gap-1">
                                    {activeModel?.is_vision && !isGenerating && (
                                        <button
                                            type="button"
                                            onClick={() => fileInputRef.current?.click()}
                                            className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
                                            aria-label={t('chat.attachImage')}
                                            title={t('chat.attachImage')}
                                        >
                                            <ImagePlus className="w-4 h-4" />
                                        </button>
                                    )}
                                    {isGenerating ? (
                                        <button
                                            type="button"
                                            onClick={handleStop}
                                            className="p-1.5 rounded-lg bg-white/10 text-gray-400 hover:text-white hover:bg-white/15 transition-colors"
                                            aria-label="Stop generating"
                                            title={t('chat.stop')}
                                        >
                                            <Square className="w-4 h-4" />
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => handleSend()}
                                            disabled={(!input.trim() && pendingImages.length === 0) || !currentModelId}
                                            aria-label="Send message"
                                            title={!currentModelId ? t('chat.sendDisabledNoModel') : (!input.trim() && pendingImages.length === 0) ? t('chat.sendDisabledEmpty') : t('chat.send')}
                                            className={`p-1.5 rounded-lg transition-colors ${(input.trim() || pendingImages.length > 0) && currentModelId ? 'bg-white text-black hover:bg-gray-200' : 'bg-white/5 text-gray-700 cursor-not-allowed'}`}
                                        >
                                            <ArrowUp className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            </div>
                            {/* Context transparency strip */}
                            {(settings.ragEnabled || settings.webSearchEnabled || settings.memoryMapEnabled || gitBranch) && (
                                <div className="flex items-center gap-2 px-1 py-1 text-[10px] text-gray-600">
                                    {gitBranch && (
                                        <span className="flex items-center gap-1" title={t('chatInput.gitBranch')}>
                                            <GitBranch className="w-3 h-3" />
                                            <span className={gitBranch.clean ? 'text-gray-500' : 'text-amber-500/70'}>{gitBranch.branch}</span>
                                        </span>
                                    )}
                                    {settings.ragEnabled && settings.ragCollectionId && (
                                        <span className="flex items-center gap-1 text-blue-500/60" title={t('chatInput.ragActive')}>
                                            <Database className="w-3 h-3" />
                                            RAG
                                        </span>
                                    )}
                                    {settings.webSearchEnabled && (
                                        <span className="flex items-center gap-1 text-green-500/60" title={t('chatInput.webSearchActive')}>
                                            <Globe className="w-3 h-3" />
                                            Web
                                        </span>
                                    )}
                                    {settings.memoryMapEnabled && (
                                        <span className="flex items-center gap-1 text-purple-500/60" title={t('chatInput.memoryActive')}>
                                            <Brain className="w-3 h-3" />
                                            Memory
                                        </span>
                                    )}
                                    {settings.systemPrompt && settings.systemPrompt !== getDefaultSettings().systemPrompt && (
                                        <span className="flex items-center gap-1 text-gray-500" title={settings.systemPrompt.slice(0, 100)}>
                                            <Eye className="w-3 h-3" />
                                            {t('chatInput.customSystem')}
                                        </span>
                                    )}
                                </div>
                            )}
                            <div className="flex items-center justify-between mt-0.5 mx-1">
                                <div className="flex items-center gap-3 text-[10px] text-gray-600">
                                    {!currentModelId && !isGenerating && messages.length > 0 ? (
                                        <p>{t('chat.noModelSuggestion')}</p>
                                    ) : null}
                                    {/* Token counter */}
                                    {showTokenCounter && tokenEstimate > 0 && (
                                        <span className="flex items-center gap-1 text-gray-500" title={t('chatInput.tokenEstimateHint')}>
                                            <Hash className="w-3 h-3" />
                                            ~{tokenEstimate} tok
                                        </span>
                                    )}
                                    {/* Paste indicator */}
                                    {pastedMultiline && (
                                        <span className="text-amber-500/70 animate-pulse">
                                            {t('chatInput.pastedMultiline')}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-3 text-[10px] text-gray-600 ml-auto">
                                    <span><kbd className="text-gray-500">/</kbd> {t('chatInput.commandsHint')}</span>
                                    <span><kbd className="text-gray-500">@</kbd> {t('chatInput.filesHint')}</span>
                                    <span><kbd className="text-gray-500">↑</kbd> {t('chatInput.historyHint')}</span>
                                    <span><kbd className="text-gray-500">Enter</kbd> {t('chat.enterSend')}</span>
                                    <span><kbd className="text-gray-500">Shift+Enter</kbd> {t('chat.shiftEnterNewline')}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
    )
}

// Action type → icon mapping (static, outside component to avoid re-creation)
const ACTION_ICONS: Record<string, React.ReactNode> = {
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
}
