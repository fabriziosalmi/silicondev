import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { Card } from './ui/Card'
import { ToggleSwitch } from './ui/ToggleSwitch'
import { useConfirm } from './ui/ConfirmDialog'
import { apiClient } from '../api/client'
import { Settings2, MessageSquare, Brain, RotateCcw, Info, Trash2, Loader2, Gauge, Globe, HardDrive, FolderSearch, Bug, ScrollText, Shield, Bot, ChevronRight } from 'lucide-react'
import { useGlobalState } from '../context/GlobalState'
import {
    type SettingsNavItem, type ChatDefaults, type RagDefaults, type TopBarDefaults,
    defaultChat, defaultRag, defaultTopBar,
    CHAT_SETTINGS_KEY, RAG_SETTINGS_KEY, TOPBAR_SETTINGS_KEY,
    SectionHeader, SliderField,
} from './settings/SettingsUtils'
import { WebIndexerSection } from './settings/WebIndexerSection'
import { CodebaseIndexSection } from './settings/CodebaseIndexSection'
import { LogViewerSection } from './settings/LogViewerSection'

const NAV_ITEMS: SettingsNavItem[] = [
    { id: 'general', label: 'General', icon: <Info size={14} />, group: 'App' },
    { id: 'status-bar', label: 'Status Bar', icon: <Gauge size={14} />, group: 'App' },
    { id: 'chat', label: 'Chat Defaults', icon: <MessageSquare size={14} />, group: 'App' },
    { id: 'rag', label: 'RAG Defaults', icon: <Brain size={14} />, group: 'App' },
    { id: 'privacy', label: 'Privacy', icon: <Shield size={14} />, group: 'Security' },
    { id: 'agents', label: 'Agents', icon: <Bot size={14} />, group: 'Security' },
    { id: 'codebase', label: 'Codebase Index', icon: <FolderSearch size={14} />, group: 'Integrations' },
    { id: 'web-indexer', label: 'Web Indexer', icon: <Globe size={14} />, group: 'Integrations' },
    { id: 'storage', label: 'Storage', icon: <HardDrive size={14} />, group: 'System' },
    { id: 'logs', label: 'Debug Logs', icon: <ScrollText size={14} />, group: 'System' },
    { id: 'about', label: 'About', icon: <Info size={14} />, group: 'System' },
]

const NAV_GROUPS = ['App', 'Security', 'Integrations', 'System']

export function Settings() {
    const { t } = useTranslation()
    const { systemStats } = useGlobalState()
    const { confirm } = useConfirm()

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

    useEffect(() => {
        localStorage.setItem(RAG_SETTINGS_KEY, JSON.stringify(rag))
    }, [rag])

    useEffect(() => {
        localStorage.setItem(TOPBAR_SETTINGS_KEY, JSON.stringify(topBar))
    }, [topBar])

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

    const handleReset = async () => {
        const ok = await confirm({
            title: t('settings.general.resetTitle', { defaultValue: 'Reset all settings' }),
            message: t('settings.general.resetConfirm', {
                defaultValue:
                    `All settings will be restored to defaults:\n` +
                    `• Temperature: ${defaultChat.temperature}\n` +
                    `• Max Tokens: ${defaultChat.maxTokens.toLocaleString()}\n` +
                    `• System Prompt: restored to default\n` +
                    `This cannot be undone.`
            }),
            confirmLabel: t('settings.general.resetConfirmBtn', { defaultValue: 'Reset' }),
            destructive: true,
        });
        if (!ok) return
        setChat({ ...defaultChat })
        setRag({ ...defaultRag })
        setTopBar({ ...defaultTopBar })
        setPiiRedaction(false)
        localStorage.removeItem(CHAT_SETTINGS_KEY)
        localStorage.removeItem(RAG_SETTINGS_KEY)
        localStorage.removeItem(TOPBAR_SETTINGS_KEY)
    }

    const [logPath, setLogPath] = useState<string | null>(null)
    useEffect(() => {
        window.electronAPI?.getLogPath?.().then(p => setLogPath(p)).catch(err => console.error('Failed to get log path:', err))
    }, [])

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
        const ok = await confirm({
            title: t('settings.storage.cleanupTitle', { defaultValue: 'Clear data' }),
            message: t('settings.storage.cleanupConfirm', { label, defaultValue: `Delete all ${label}? This cannot be undone.` }),
            confirmLabel: t('common.delete', { defaultValue: 'Delete' }),
            destructive: true,
        });
        if (!ok) return
        setStorageCleaning(true)
        try {
            const result = await apiClient.monitor.cleanupStorage(targets)
            if (result.freed_bytes > 0) {
                fetchStorage()
            }
        } catch { /* ignore */ }
        setStorageCleaning(false)
    }

    const scrollContainerRef = useRef<HTMLDivElement>(null)
    const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
    const [activeSection, setActiveSection] = useState('general')
    const isScrollingTo = useRef(false)

    const setSectionRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
        sectionRefs.current[id] = el
    }, [])

    const scrollToSection = useCallback((id: string) => {
        const el = sectionRefs.current[id]
        if (!el || !scrollContainerRef.current) return
        isScrollingTo.current = true
        setActiveSection(id)
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        setTimeout(() => { isScrollingTo.current = false }, 600)
    }, [])

    useEffect(() => {
        const container = scrollContainerRef.current
        if (!container) return
        const observer = new IntersectionObserver(
            (entries) => {
                if (isScrollingTo.current) return
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        setActiveSection(entry.target.id)
                        break
                    }
                }
            },
            { root: container, rootMargin: '-10% 0px -80% 0px', threshold: 0 }
        )
        for (const item of NAV_ITEMS) {
            const el = sectionRefs.current[item.id]
            if (el) observer.observe(el)
        }
        return () => observer.disconnect()
    }, [])

    return (
        <div className="max-w-5xl mx-auto flex gap-6 h-full">
            {/* Sidebar nav */}
            <nav className="w-44 shrink-0 space-y-4 sticky top-0 self-start pt-1">
                <div className="flex items-center gap-2 mb-4">
                    <Settings2 size={18} className="text-blue-400" />
                    <h2 className="text-base font-bold text-white">{t('settings.title')}</h2>
                </div>
                {NAV_GROUPS.map(group => {
                    const items = NAV_ITEMS.filter(i => i.group === group)
                    return (
                        <div key={group}>
                            <div className="text-[10px] font-bold tracking-wide text-gray-500 uppercase mb-1 px-2">{t(`settings.group.${group.toLowerCase()}` as string, group)}</div>
                            <div className="space-y-0.5">
                                {items.map(item => (
                                    <button
                                        key={item.id}
                                        onClick={() => scrollToSection(item.id)}
                                        className={`w-full text-left flex items-center gap-1.5 px-2 py-1.5 rounded text-[13px] transition-colors ${
                                            activeSection === item.id
                                                ? 'bg-blue-500/10 text-blue-400 font-medium'
                                                : 'text-gray-400 hover:text-white hover:bg-white/5'
                                        }`}
                                    >
                                        {activeSection === item.id && <ChevronRight size={12} />}
                                        <span className={activeSection === item.id ? '' : 'ml-[18px]'}>{t(`settings.nav.${item.id}` as string, item.label)}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )
                })}
                <div className="pt-3 px-2">
                    <button
                        type="button"
                        onClick={() => {
                            const platform = systemStats?.platform
                            const sysInfo = platform ? `${platform.system} ${platform.release} (${platform.processor})` : 'Unknown'
                            const params = new URLSearchParams({
                                title: '[Bug] ',
                                body: `## Description\n\nDescribe the bug...\n\n## System Info\n\n- OS: ${sysInfo}\n- App Version: ${__APP_VERSION__}\n\n## Steps to Reproduce\n\n1. \n2. \n3. \n\n## Expected Behavior\n\n\n## Logs\n\nPaste relevant logs from Settings > Debug Logs\n`,
                            })
                            window.open(`https://github.com/fabriziosalmi/silicondev/issues/new?${params.toString()}`, '_blank')
                        }}
                        className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded text-[11px] text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
                    >
                        <Bug size={12} />
                        {t('settings.nav.reportBug', 'Report a Bug')}
                    </button>
                </div>
            </nav>

            {/* Content */}
            <div ref={scrollContainerRef} className="flex-1 min-w-0 space-y-6 overflow-y-auto pb-12">

            {/* General */}
            <div id="general" ref={setSectionRef('general')}>
            <Card className="p-5">
                <SectionHeader icon={<Info size={16} />} title={t('settings.general.title')} />
                <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-500 uppercase">{t('settings.general.language')}</label>
                        <select
                            value={i18n.language}
                            onChange={(e) => i18n.changeLanguage(e.target.value)}
                            className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-blue-500"
                        >
                            <option value="en">English</option>
                            <option value="fr">Français</option>
                            <option value="de">Deutsch</option>
                            <option value="es">Español</option>
                            <option value="pt">Português</option>
                            <option value="it">Italiano</option>
                            <option value="nl">Nederlands</option>
                            <option value="pl">Polski</option>
                            <option value="hi">हिन्दी</option>
                            <option value="zh">中文</option>
                            <option value="ar">العربية</option>
                            <option value="ja">日本語</option>
                            <option value="id">Bahasa Indonesia</option>
                            <option value="yo">Yorùbá</option>
                            <option value="th">ไทย</option>
                            <option value="vi">Tiếng Việt</option>
                            <option value="ru">Русский</option>
                            <option value="ko">한국어</option>
                            <option value="tr">Türkçe</option>
                            <option value="uk">Українська</option>
                            <option value="bn">বাংলা</option>
                            <option value="fa">فارسی</option>
                            <option value="sw">Kiswahili</option>
                        </select>
                        <span className="text-[10px] text-gray-600">{t('settings.general.languageHint')}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-500 uppercase">{t('settings.general.backendUrl')}</label>
                        <div className="flex items-center px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm text-gray-400">
                            {apiClient.API_BASE}
                        </div>
                        <span className="text-[10px] text-gray-600">{t('settings.general.backendUrlHint')}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-500 uppercase">{t('settings.general.reasoningMode')}</label>
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
                            <label className="text-xs font-bold text-gray-500 uppercase">{t('settings.general.logFile', 'Log File')}</label>
                            <div className="flex items-center px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm text-gray-400 truncate">
                                {logPath}
                            </div>
                            <span className="text-[10px] text-gray-600">{t('settings.general.logFileHint', 'Share this file when reporting bugs.')}</span>
                        </div>
                    )}
                </div>
            </Card>
            </div>

            {/* Status Bar Thresholds */}
            <div id="status-bar" ref={setSectionRef('status-bar')}>
            <Card className="p-5">
                <SectionHeader icon={<Gauge size={16} />} title={t('settings.nav.status-bar', 'Status Bar Thresholds')} />
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                    <SliderField label="Warning %" value={topBar.warn} onChange={(v) => setTopBar(prev => ({ ...prev, warn: v }))} min={20} max={95} step={5} hint="Yellow threshold" />
                    <SliderField label="Critical %" value={topBar.critical} onChange={(v) => setTopBar(prev => ({ ...prev, critical: v }))} min={30} max={99} step={5} hint="Red threshold" />
                </div>
            </Card>
            </div>

            {/* Chat Defaults */}
            <div id="chat" ref={setSectionRef('chat')}>
            <Card className="p-5">
                <SectionHeader icon={<MessageSquare size={16} />} title={t('settings.nav.chat', 'Chat Defaults')} />
                <div className="space-y-4">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-500 uppercase">{t('params.systemPrompt')}</label>
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
                        <span className="text-sm text-gray-300">{t('params.webSearch', 'Enable web search by default')}</span>
                        <ToggleSwitch
                            enabled={chat.webSearchEnabled}
                            onChange={(v) => updateChat('webSearchEnabled', v)}
                            size="sm"
                            label="Enable web search by default"
                        />
                    </div>
                </div>
            </Card>
            </div>

            {/* RAG Defaults */}
            <div id="rag" ref={setSectionRef('rag')}>
            <Card className="p-5">
                <SectionHeader icon={<Brain size={16} />} title={t('settings.nav.rag', 'RAG Defaults')} />
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                    <SliderField label="Chunk Size" value={rag.chunkSize} onChange={(v) => setRag(prev => ({ ...prev, chunkSize: v }))} min={128} max={2048} step={64} hint="Characters per chunk" />
                    <SliderField label="Chunk Overlap" value={rag.chunkOverlap} onChange={(v) => setRag(prev => ({ ...prev, chunkOverlap: v }))} min={0} max={512} step={10} hint="Overlap between chunks" />
                </div>
            </Card>
            </div>

            {/* Privacy */}
            <div id="privacy" ref={setSectionRef('privacy')}>
            <Card className="p-5">
                <SectionHeader icon={<Shield size={16} />} title={t('settings.nav.privacy', 'Privacy')} />
                <div className="flex items-center justify-between">
                    <div>
                        <span className="text-sm text-gray-300">{t('params.piiRedaction')}</span>
                        <p className="text-[10px] text-gray-600 mt-0.5">{t('settings.nav.privacyHint', 'Redact emails, phone numbers, IPs, credit cards, SSNs, and API keys from chat messages')}</p>
                    </div>
                    <ToggleSwitch
                        enabled={piiRedaction}
                        onChange={setPiiRedaction}
                        size="sm"
                        label="PII Redaction"
                    />
                </div>
            </Card>
            </div>

            {/* Agent Capabilities & Security */}
            <div id="agents" ref={setSectionRef('agents')}>
            <Card className="p-5">
                <SectionHeader icon={<Bot size={16} />} title={t('settings.agents.title')} />
                <div className="space-y-4">
                    <div className="flex items-start justify-between">
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-300 font-bold">{t('settings.agents.moaSwarm', 'Mixture of Agents (MoA) Swarm')}</span>
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
                                <span className="text-sm text-gray-300 font-bold">{t('settings.agents.airGapped', 'Air-Gapped Mode')}</span>
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
                                <span className="text-sm text-gray-300 font-bold">{t('settings.agents.sandbox')}</span>
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
            </div>

            {/* Codebase Index */}
            <div id="codebase" ref={setSectionRef('codebase')}>
            <CodebaseIndexSection />
            </div>

            {/* Web Indexer */}
            <div id="web-indexer" ref={setSectionRef('web-indexer')}>
            <WebIndexerSection />
            </div>

            {/* Storage Management */}
            <div id="storage" ref={setSectionRef('storage')}>
            <Card className="p-5">
                <SectionHeader icon={<HardDrive size={16} />} title={t('settings.nav.storage', 'Storage')} />
                {storageInfo ? (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 font-mono">{storageInfo.path}</span>
                            <button
                                type="button"
                                onClick={() => window.electronAPI?.openPath?.(storageInfo.path)}
                                className="text-[10px] px-2 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 transition-colors"
                            >
                                {t('settings.nav.openInFinder', 'Open in Finder')}
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
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-400 text-[11px] hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Trash2 size={12} />
                                    {t('settings.general.clearLogs', 'Clear Logs')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleCleanup(['logs', 'conversations', 'notes'])}
                                    disabled={storageCleaning}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] hover:bg-red-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {storageCleaning ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                    {t('settings.general.clearAllData', 'Clear All Data')}
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
                        {t('settings.nav.checkStorage', 'Check Storage Usage')}
                    </button>
                )}
            </Card>
            </div>

            {/* Debug Logs */}
            <div id="logs" ref={setSectionRef('logs')}>
            <LogViewerSection />
            </div>

            {/* About */}
            <div id="about" ref={setSectionRef('about')}>
            <Card className="p-5">
                <SectionHeader icon={<Info size={16} />} title={t('settings.about.title')} />
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-bold text-white">SiliconDev</h3>
                        <p className="text-xs text-gray-500 mt-1">{t('settings.about.version')}: v{__APP_VERSION__}</p>
                        <p className="text-[10px] text-gray-600 mt-1">Made with love by Fabrizio Salmi — MIT License</p>
                    </div>
                    <button
                        type="button"
                        onClick={handleReset}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm hover:bg-red-500/20 transition-colors"
                    >
                        <RotateCcw size={14} />
                        {t('settings.general.resetAll')}
                    </button>
                </div>
            </Card>
            </div>

        </div>
        </div>
    )
}
