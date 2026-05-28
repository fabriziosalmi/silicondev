import { useTranslation } from 'react-i18next';
import { Loader2, Brain } from 'lucide-react';
import type { ConversationMemory } from '../../api/client';

export function MemoryMapPanel({ memory, building }: { memory: ConversationMemory | null; building: boolean }) {
    const { t } = useTranslation()
    if (building && !memory) {
        return (
            <div className="px-4 py-2">
                <div className="max-w-3xl mx-auto flex items-center gap-2 p-3 rounded-lg bg-hover border border-outline-subtle">
                    <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                    <span className="text-xs text-foreground-muted">{t('memory.building')}</span>
                </div>
            </div>
        );
    }
    if (!memory || memory.topics.length === 0) {
        return (
            <div className="px-4 py-2">
                <div className="max-w-3xl mx-auto p-3 rounded-lg bg-hover border border-outline-subtle">
                    <div className="flex items-center gap-2">
                        <Brain className="w-3.5 h-3.5 text-foreground-muted" />
                        <span className="text-xs text-foreground-muted">No memory context yet. Keep chatting and it will build automatically.</span>
                    </div>
                </div>
            </div>
        );
    }
    return (
        <div className="px-4 py-2">
            <div className="max-w-3xl mx-auto p-3 rounded-lg bg-hover border border-outline-subtle space-y-2">
                <div className="flex items-center gap-2 mb-1">
                    <Brain className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-[10px] font-medium text-foreground-muted">{t('memory.title')}</span>
                    {building && <Loader2 className="w-3 h-3 text-blue-400 animate-spin ml-auto" />}
                </div>
                {memory.topics.length > 0 && (
                    <div>
                        <span className="text-[10px] text-foreground-muted font-medium">{t('memory.topics')}</span>
                        <div className="mt-1 space-y-0.5">
                            {memory.topics.map((t, i) => (
                                <div key={i} className="text-[10px] text-foreground-muted">
                                    <span className="text-foreground-secondary font-medium">{t.name}</span>
                                    <span className="text-foreground-subtle"> — {t.summary}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {memory.decisions.length > 0 && (
                    <div>
                        <span className="text-[10px] text-foreground-muted font-medium">Decisions</span>
                        <div className="mt-1 space-y-0.5">
                            {memory.decisions.map((d, i) => (
                                <div key={i} className="text-[10px] text-foreground-muted">
                                    <span className="text-foreground-secondary">{d.what}</span>
                                    <span className="text-foreground-subtle"> — {d.why}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {memory.codeContext.length > 0 && (
                    <div>
                        <span className="text-[10px] text-foreground-muted font-medium">Code</span>
                        <div className="mt-1 space-y-0.5">
                            {memory.codeContext.map((c, i) => (
                                <div key={i} className="text-[10px] text-foreground-muted">
                                    <span className="text-blue-400 font-mono">{c.language}</span>
                                    <span className="text-foreground-subtle"> — {c.description}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {memory.keyFacts.length > 0 && (
                    <div>
                        <span className="text-[10px] text-foreground-muted font-medium">Key Facts</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                            {memory.keyFacts.map((f, i) => (
                                <span key={i} className="text-[10px] text-foreground-muted bg-hover px-1.5 py-0.5 rounded">
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
