import { useTranslation } from 'react-i18next'
import { ParameterSlider } from './ParameterSlider'
import { ToggleSwitch } from '../ui/ToggleSwitch'

export interface ChatSettings {
    systemPrompt: string
    temperature: number
    maxTokens: number
    topP: number
    repetitionPenalty: number
    reasoningMode: 'off' | 'auto' | 'low' | 'high'
    seed: number | null
    translateLanguage: string
    showPrompt: boolean
    syntaxCheck: boolean
    autoFixSyntax: boolean
    enabledActions: Record<string, boolean>
    memoryMapEnabled: boolean
    memoryInterval: number
    piiRedaction: boolean
    ragEnabled: boolean
    ragCollectionId: string
    webSearchEnabled: boolean
}

interface ParametersPanelProps {
    settings: ChatSettings
    setSettings: (settings: ChatSettings) => void
    maxContextWindow: number
    ragCollections: { id: string; name: string; chunks: number }[]
    fetchRagCollections: () => void
}

export function ParametersPanel({
    settings, setSettings, maxContextWindow, ragCollections, fetchRagCollections
}: ParametersPanelProps) {
    const { t } = useTranslation()
    return (
        <div className="shrink-0 mx-3 mb-2 rounded-xl border border-white/5 bg-black/20 transition-all">
            <div className="max-w-4xl mx-auto px-6 py-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-5">
                    {/* Column 1: Core parameters */}
                    <div className="space-y-4">
                        <div className="text-[10px] font-bold tracking-wide text-gray-500 uppercase mb-3">{t('params.parameters')}</div>
                        <ParameterSlider
                            label={t('params.temperature')}
                            hint={t('params.temperatureHint')}
                            value={settings.temperature}
                            min={0} max={2} step={0.05}
                            format={(v) => v.toFixed(2)}
                            onChange={(v) => setSettings({ ...settings, temperature: v })}
                        />
                        <ParameterSlider
                            label={t('params.maxTokens')}
                            hint={t('params.maxTokensHint')}
                            value={settings.maxTokens}
                            min={64} max={maxContextWindow} step={64}
                            format={(v) => v.toString()}
                            onChange={(v) => setSettings({ ...settings, maxTokens: v })}
                        />
                        <ParameterSlider
                            label={t('params.topP')}
                            hint={t('params.topPHint')}
                            value={settings.topP}
                            min={0} max={1} step={0.05}
                            format={(v) => v.toFixed(2)}
                            onChange={(v) => setSettings({ ...settings, topP: v })}
                        />
                        <ParameterSlider
                            label={t('params.repetitionPenalty')}
                            hint={t('params.repetitionPenaltyHint')}
                            value={settings.repetitionPenalty}
                            min={0.5} max={2} step={0.05}
                            format={(v) => v.toFixed(2)}
                            onChange={(v) => setSettings({ ...settings, repetitionPenalty: v })}
                        />
                        <div>
                            <div className="flex justify-between items-center mb-1.5">
                                <label className="text-xs text-gray-500" title="Fixed seed for reproducible outputs.">{t('params.seed')}</label>
                                <input
                                    type="text"
                                    placeholder={t('params.seedPlaceholder')}
                                    value={settings.seed !== null ? String(settings.seed) : ''}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        setSettings({ ...settings, seed: v ? parseInt(v) || null : null });
                                    }}
                                    className="w-16 text-right text-xs font-mono text-gray-400 tabular-nums bg-transparent outline-none border-b border-transparent focus:border-white/20 transition-colors"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Column 2: Reasoning + Language */}
                    <div className="space-y-4">
                        <div className="text-[10px] font-bold tracking-wide text-gray-500 uppercase mb-3">{t('params.reasoning')}</div>
                        <div className="flex gap-1">
                            {(['off', 'auto', 'low', 'high'] as const).map(mode => (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => setSettings({ ...settings, reasoningMode: mode })}
                                    className={`flex-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${
                                        settings.reasoningMode === mode
                                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                            : 'bg-white/[0.03] text-gray-500 border border-white/5 hover:text-gray-400 hover:bg-white/5'
                                    }`}
                                >
                                    {mode === 'off' ? t('params.reasoningOff') : mode === 'auto' ? t('params.reasoningAuto') : mode === 'low' ? t('params.reasoningLow') : t('params.reasoningHigh')}
                                </button>
                            ))}
                        </div>
                        <p className="text-[10px] text-gray-500">
                            {settings.reasoningMode === 'off' && t('params.reasoningDescOff')}
                            {settings.reasoningMode === 'auto' && t('params.reasoningDescAuto')}
                            {settings.reasoningMode === 'low' && t('params.reasoningDescLow')}
                            {settings.reasoningMode === 'high' && t('params.reasoningDescHigh')}
                        </p>

                        <div className="pt-2">
                            <div className="text-[10px] font-bold tracking-wide text-gray-500 uppercase mb-3">{t('params.language')}</div>
                            <select
                                title="Translate Language"
                                value={settings.translateLanguage}
                                onChange={(e) => setSettings({ ...settings, translateLanguage: e.target.value })}
                                className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-300 outline-none focus:border-white/20 transition-colors appearance-none cursor-pointer"
                            >
                                <option value="">{t('params.languageAuto')}</option>
                                {['English', 'Italian', 'French', 'German', 'Spanish', 'Portuguese', 'Japanese', 'Chinese', 'Korean', 'Arabic', 'Hindi', 'Russian', 'Dutch', 'Swedish', 'Polish', 'Turkish'].map(lang => (
                                    <option key={lang} value={lang}>{lang}</option>
                                ))}
                            </select>
                            <p className="text-[10px] text-gray-500 mt-1.5">{t('params.languageHint')}</p>
                        </div>

                        <div className="pt-2">
                            <div className="text-[10px] font-bold tracking-wide text-gray-500 uppercase mb-3">{t('params.systemPrompt')}</div>
                            <textarea
                                value={settings.systemPrompt}
                                onChange={(e) => setSettings({ ...settings, systemPrompt: e.target.value })}
                                className="w-full bg-white/[0.03] border border-white/10 rounded-lg p-2.5 text-xs text-gray-300 h-20 resize-none outline-none focus:border-white/20 transition-colors leading-relaxed"
                                placeholder={t('params.systemPromptPlaceholder')}
                            />
                        </div>
                    </div>

                    {/* Column 3: Toggles */}
                    <div className="space-y-4">
                        <div className="text-[10px] font-bold tracking-wide text-gray-500 uppercase mb-3">{t('params.toggles')}</div>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-xs text-gray-400">{t('params.showPrompt')}</label>
                                <ToggleSwitch enabled={settings.showPrompt} onChange={(v) => setSettings({ ...settings, showPrompt: v })} size="sm" />
                            </div>
                            <div className="flex items-center justify-between">
                                <label className="text-xs text-gray-400">{t('params.syntaxCheck')}</label>
                                <ToggleSwitch enabled={settings.syntaxCheck} onChange={(v) => setSettings({ ...settings, syntaxCheck: v })} size="sm" />
                            </div>
                            {settings.syntaxCheck && (
                                <div className="flex items-center justify-between pl-3">
                                    <label className="text-xs text-gray-500">{t('params.autoFix')}</label>
                                    <ToggleSwitch enabled={settings.autoFixSyntax} onChange={(v) => setSettings({ ...settings, autoFixSyntax: v })} size="sm" />
                                </div>
                            )}
                            <div className="flex items-center justify-between">
                                <label className="text-xs text-gray-400">{t('params.memoryMap')}</label>
                                <ToggleSwitch enabled={settings.memoryMapEnabled} onChange={(v) => setSettings({ ...settings, memoryMapEnabled: v })} size="sm" />
                            </div>
                            {settings.memoryMapEnabled && (
                                <div className="pl-3">
                                    <ParameterSlider
                                        label={t('params.memoryInterval')}
                                        value={settings.memoryInterval}
                                        min={3} max={20} step={1}
                                        format={(v) => v.toString()}
                                        onChange={(v) => setSettings({ ...settings, memoryInterval: v })}
                                    />
                                </div>
                            )}
                            <div className="flex items-center justify-between">
                                <label className="text-xs text-gray-400">{t('params.piiRedaction')}</label>
                                <ToggleSwitch enabled={settings.piiRedaction} onChange={(v) => setSettings({ ...settings, piiRedaction: v })} size="sm" />
                            </div>
                        </div>

                        <div className="pt-2">
                            <div className="text-[10px] font-bold tracking-wide text-gray-500 uppercase mb-3">{t('params.context')}</div>
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs text-gray-400">{t('params.ragKnowledge')}</label>
                                    <ToggleSwitch enabled={settings.ragEnabled} onChange={(v) => {
                                        setSettings({ ...settings, ragEnabled: v });
                                        if (v && ragCollections.length === 0) fetchRagCollections();
                                    }} size="sm" />
                                </div>
                                {settings.ragEnabled && (
                                    <select
                                        title="RAG collection"
                                        value={settings.ragCollectionId}
                                        onChange={(e) => setSettings({ ...settings, ragCollectionId: e.target.value })}
                                        className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-blue-500/50"
                                    >
                                        <option value="">{t('params.ragSelectCollection')}</option>
                                        {ragCollections.map(c => (
                                            <option key={c.id} value={c.id}>{c.name} ({c.chunks} chunks)</option>
                                        ))}
                                    </select>
                                )}
                                <div className="flex items-center justify-between">
                                    <label className="text-xs text-gray-400">{t('params.webSearch')}</label>
                                    <ToggleSwitch enabled={settings.webSearchEnabled} onChange={(v) => setSettings({ ...settings, webSearchEnabled: v })} size="sm" />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Column 4: Actions */}
                    <div className="space-y-4">
                        <div className="text-[10px] font-bold tracking-wide text-gray-500 uppercase mb-3">{t('params.actions')}</div>
                        <div className="flex flex-wrap gap-1.5">
                            {[
                                { key: 'longer', label: t('params.actionLonger') },
                                { key: 'shorter', label: t('params.actionShorter') },
                                { key: 'formal', label: t('params.actionFormal') },
                                { key: 'casual', label: t('params.actionCasual') },
                                { key: 'technical', label: t('params.actionTechnical') },
                                { key: 'translate', label: t('params.actionTranslate') },
                                { key: 'devil', label: t('params.actionDevil') },
                                { key: 'perspective_ceo', label: t('params.actionCEO') },
                                { key: 'perspective_child', label: t('params.actionELI8') },
                                { key: 'perspective_scientist', label: t('params.actionScientist') },
                                { key: 'perspective_poet', label: t('params.actionPoet') },
                                { key: 'improve', label: t('params.actionImprove') },
                                { key: 'secure', label: t('params.actionSecure') },
                                { key: 'faster', label: t('params.actionFaster') },
                                { key: 'docs', label: t('params.actionDocs') },
                                { key: 'tests', label: t('params.actionTests') },
                                { key: 'selfAssess', label: t('params.actionEthical') },
                                { key: 'selfCritique', label: t('params.actionSelfCritique') },
                            ].map(a => {
                                const enabled = settings.enabledActions?.[a.key] !== false;
                                return (
                                    <button
                                        type="button"
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
                    </div>
                </div>
            </div>
        </div>
    )
}
