import { useState, useEffect } from 'react'
import { Play, StepForward, ArrowDown, Square, ChevronRight, ChevronDown, Bug } from 'lucide-react'
import { apiClient } from '../../api/client'

interface DebugState {
    line?: number
    status?: string
    locals?: Record<string, string>
    stack?: Array<{ function: string; line: number }>
}

interface DebuggerPanelProps {
    sessionId: string | null
    onStop: () => void
    onUpdateState: (state: DebugState) => void
}

export function DebuggerPanel({ sessionId, onStop, onUpdateState }: DebuggerPanelProps) {
    const [debugState, setDebugState] = useState<DebugState | null>(null)
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
        locals: true,
        globals: false,
        stack: true
    })

    useEffect(() => {
        if (!sessionId) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset state when session is cleared; this is intentional cleanup, not a cascading render
            setDebugState(null)
            return
        }

        const controller = new AbortController()
        ;(async () => {
            try {
                const res = await apiClient.sandbox.fetchDebugStream(sessionId)
                const reader = res.body?.getReader()
                if (!reader) return
                const decoder = new TextDecoder()
                let buf = ''
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break
                    buf += decoder.decode(value, { stream: true })
                    const lines = buf.split('\n')
                    buf = lines.pop() || ''
                    for (const line of lines) {
                        if (!line.startsWith('data: ')) continue
                        const state = JSON.parse(line.slice(6))
                        setDebugState(state)
                        onUpdateState(state)
                        if (state.status === 'finished') {
                            reader.cancel()
                            return
                        }
                    }
                }
            } catch {
                // stream closed or aborted
            }
        })()

        return () => controller.abort()
    }, [sessionId, onUpdateState])

    const sendCommand = async (cmd: string) => {
        if (sessionId) {
            await apiClient.sandbox.sendCommand(sessionId, cmd)
        }
    }

    const toggleGroup = (group: string) => {
        setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }))
    }

    if (!sessionId) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 p-8 text-center">
                <Bug className="w-12 h-12 mb-4 opacity-20" />
                <h3 className="text-sm font-bold text-gray-400 mb-1">Debugger Inactive</h3>
                <p className="text-xs max-w-[200px]">Start a debug session from the Terminal or Agent panel to inspect code execution.</p>
            </div>
        )
    }

    return (
        <div className="h-full flex flex-col bg-elevated text-xs">
            {/* Header / Controls */}
            <div className="flex items-center justify-between p-2 border-b border-white/5 bg-white/5">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => sendCommand('continue')}
                        className="p-1 hover:bg-white/10 rounded-md text-green-500 transition-colors"
                        title="Continue (F5)"
                    >
                        <Play size={16} fill="currentColor" />
                    </button>
                    <button
                        onClick={() => sendCommand('next')}
                        className="p-1 hover:bg-white/10 rounded-md text-blue-400 transition-colors"
                        title="Step Over (F10)"
                    >
                        <StepForward size={16} />
                    </button>
                    <button
                        onClick={() => sendCommand('step')}
                        className="p-1 hover:bg-white/10 rounded-md text-blue-300 transition-colors"
                        title="Step Into (F11)"
                    >
                        <ArrowDown size={16} />
                    </button>
                    <div className="w-px h-4 bg-white/10 mx-1" />
                    <button
                        onClick={() => {
                            sendCommand('stop')
                            onStop()
                        }}
                        className="p-1 hover:bg-white/10 rounded-md text-red-500 transition-colors"
                        title="Stop"
                    >
                        <Square size={14} fill="currentColor" />
                    </button>
                </div>
                <div className="text-[10px] text-gray-500 font-mono">
                    PID: {sessionId.split('-')[0]}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-4">
                {/* Variables Section */}
                <div>
                    <button
                        onClick={() => toggleGroup('locals')}
                        className="flex items-center gap-1 font-bold text-gray-400 uppercase tracking-widest text-[9px] mb-1 w-full text-left"
                    >
                        {expandedGroups.locals ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        Variables (Locals)
                    </button>
                    {expandedGroups.locals && (
                        <div className="space-y-1 pl-3">
                            {debugState?.locals && Object.entries(debugState.locals).length > 0 ? (
                                Object.entries(debugState.locals).map(([name, value]) => (
                                    <div key={name} className="flex gap-2 font-mono">
                                        <span className="text-blue-400 shrink-0">{name}:</span>
                                        <span className="text-amber-200 truncate">{value as string}</span>
                                    </div>
                                ))
                            ) : (
                                <div className="text-gray-600 italic">No local variables</div>
                            )}
                        </div>
                    )}
                </div>

                {/* Call Stack Section */}
                <div>
                    <button
                        onClick={() => toggleGroup('stack')}
                        className="flex items-center gap-1 font-bold text-gray-400 uppercase tracking-widest text-[9px] mb-1 w-full text-left"
                    >
                        {expandedGroups.stack ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        Call Stack
                    </button>
                    {expandedGroups.stack && (
                        <div className="space-y-1 pl-3">
                            {debugState?.stack?.map((frame, i) => (
                                <div key={i} className={`flex items-center gap-2 p-1 rounded ${i === 0 ? 'bg-blue-500/10 text-blue-300' : 'text-gray-500'}`}>
                                    <span className="truncate">{frame.function}</span>
                                    <span className="text-[10px] opacity-50">:{frame.line}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
