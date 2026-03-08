import { Loader2, Brain } from 'lucide-react';
import type { ConversationMemory } from '../../api/client';

export function MemoryMapPanel({ memory, building }: { memory: ConversationMemory | null; building: boolean }) {
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
                        <Brain className="w-3.5 h-3.5 text-gray-500" />
                        <span className="text-xs text-gray-500">No memory context yet. Keep chatting and it will build automatically.</span>
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
