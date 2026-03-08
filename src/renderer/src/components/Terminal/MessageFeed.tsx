import { useState, useRef, useEffect, memo, useCallback } from 'react'
import { User, TerminalSquare, AlertCircle, Info, AlertTriangle, Send, Cpu, RefreshCw, XCircle, CheckCircle2, ChevronRight, Brain, FileEdit } from 'lucide-react'
import { StreamingMarkdown } from './StreamingMarkdown'
import { HolographicDiff } from './HolographicDiff'
import { PlanCard } from './PlanCard'
import { apiClient } from '../../api/client'
import type { FeedItem } from './types'

// Strip XML tool/arg tags that may leak through the backend SSE stream.
const TOOL_BLOCK_RE = /<tool\s+name="[^"]*">[\s\S]*?<\/tool>/g
const STRAY_TAG_RE = /<\/?(?:tool|arg)\b[^>]*>/g
// Strip <think>/<talk> reasoning blocks from models like Qwen3, SmolLM2
const THINK_BLOCK_RE = /<(?:think|talk)>[\s\S]*?<\/(?:think|talk)>/g
// Also strip incomplete think/talk blocks (model stopped mid-block)
const INCOMPLETE_THINK_RE = /<(?:think|talk)>[\s\S]*$/g
const STRAY_THINK_RE = /<\/?(?:think|talk)[^>]*>/g

function stripModelTags(text: string): string {
  return text
    .replace(TOOL_BLOCK_RE, '')
    .replace(STRAY_TAG_RE, '')
    .replace(THINK_BLOCK_RE, '')
    .replace(INCOMPLETE_THINK_RE, '')
    .replace(STRAY_THINK_RE, '')
    .trim()
}

interface MessageFeedProps {
  items: FeedItem[]
  sessionId: string
  onDiffDecided: (callId: string, approved: boolean, reason?: string) => void
  onEscalationResponded: (escalationId: string, userMessage: string) => void
  onPlanDecision?: (sessionId: string, approved: boolean) => void
}

/**
 * Inline escalation card — shows when agent is stuck and waiting for user input.
 */
const EscalationCard = memo(function EscalationCard({
  item,
  sessionId,
  onResponded,
}: {
  item: FeedItem
  sessionId: string
  onResponded: (escalationId: string, userMessage: string) => void
}) {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const meta = item.escalationMeta!

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || sending) return
    setSending(true)
    try {
      await apiClient.terminal.respondToEscalation(sessionId, meta.escalationId, input.trim())
      onResponded(meta.escalationId, input.trim())
    } catch {
      // ignore — session may have ended
    } finally {
      setSending(false)
    }
  }, [input, sending, sessionId, meta.escalationId, onResponded])

  if (meta.status === 'responded') {
    return (
      <div className="p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-lg space-y-1">
        <div className="flex items-center gap-2 text-xs text-yellow-500">
          <AlertTriangle size={12} />
          <span>Agent paused: {meta.reason}</span>
        </div>
        <div className="text-xs text-gray-400">
          Your guidance: <span className="text-white">{meta.userMessage}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg space-y-2">
      <div className="flex items-center gap-2 text-sm text-yellow-400">
        <AlertTriangle size={14} />
        <span>Agent is stuck and needs your help</span>
      </div>
      <p className="text-xs text-gray-400">{meta.reason}</p>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="Type guidance for the agent..."
          className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-yellow-500/40"
          disabled={sending}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!input.trim() || sending}
          className="px-2 py-1.5 bg-yellow-600/20 hover:bg-yellow-600/30 border border-yellow-500/30 rounded text-xs text-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
        >
          <Send size={10} />
          Send
        </button>
      </div>
    </div>
  )
})

/**
 * Collapsible tool output block — collapsed by default, shows command preview.
 * Inspired by Companion's ToolBlock pattern.
 */
function CollapsibleToolOutput({ item }: { item: FeedItem }) {
  const command = item.toolMeta?.command || ''
  const lines = item.content.split(/\r?\n/)
  const hasMore = lines.length > 20
  const [showFull, setShowFull] = useState(false)
  const rendered = showFull || !hasMore ? item.content : lines.slice(-20).join('\n')
  const isError = item.toolMeta?.exitCode !== undefined && item.toolMeta.exitCode !== 0
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (isError && command) {
      window.dispatchEvent(new CustomEvent('nanocore-terminal-error', {
        detail: { command, output: item.content, exitCode: item.toolMeta?.exitCode }
      }))
    }
  }, [isError, command, item.content])

  return (
    <div className="rounded-[10px] overflow-hidden border border-white/[0.06] bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-white/[0.04] transition-colors cursor-pointer"
      >
        <ChevronRight
          size={12}
          className={`text-gray-500 transition-transform shrink-0 ${open ? 'rotate-90' : ''}`}
        />
        <TerminalSquare size={12} className={isError ? 'text-red-400 shrink-0' : 'text-blue-400 shrink-0'} />
        <span className="text-[11px] font-medium text-gray-300">Terminal</span>
        {command && (
          <span className="text-[11px] text-gray-500 font-mono truncate flex-1">
            $ {command}
          </span>
        )}
        {isError && (
          <span className="text-[9px] text-red-400 bg-red-500/10 rounded-full px-1.5 py-0.5 shrink-0">
            exit {item.toolMeta?.exitCode}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-white/[0.04]">
          {hasMore && (
            <div className="flex items-center justify-between px-3 py-1 border-b border-white/[0.04]">
              <span className="text-[10px] text-gray-500">
                {showFull ? 'Full output' : `Last 20 of ${lines.length} lines`}
              </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowFull(!showFull) }}
                className="text-[10px] text-blue-400 hover:underline cursor-pointer"
              >
                {showFull ? 'Show tail' : 'Show full'}
              </button>
            </div>
          )}
          <div className="bg-black/60 px-3 py-2 overflow-x-auto max-h-60 overflow-y-auto">
            <pre className={`text-xs font-mono select-text whitespace-pre-wrap break-words leading-relaxed ${isError ? 'text-red-300/90' : 'text-green-300/90'
              }`}>
              {rendered}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Collapsible thinking/reasoning block — collapsed by default.
 */
function ThinkingBlock({ item, autoExpand }: { item: FeedItem; autoExpand?: boolean }) {
  const [open, setOpen] = useState(autoExpand ?? false)
  const preview = item.content.slice(0, 80).replace(/\n/g, ' ')

  return (
    <div className="rounded-[10px] overflow-hidden border border-purple-500/10 bg-purple-500/[0.03]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-purple-500/[0.05] transition-colors cursor-pointer"
      >
        <ChevronRight
          size={12}
          className={`text-purple-400/60 transition-transform shrink-0 ${open ? 'rotate-90' : ''}`}
        />
        <Brain size={12} className="text-purple-400/60 shrink-0" />
        <span className="text-[11px] font-medium text-purple-300/70">Thinking</span>
        {!open && preview && (
          <span className="text-[11px] text-gray-500 truncate flex-1 italic">
            {preview}{item.content.length > 80 ? '…' : ''}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-purple-500/10 px-3 py-2 max-h-48 overflow-y-auto">
          <p className="text-xs text-gray-400 whitespace-pre-wrap select-text leading-relaxed">
            {item.content}
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Collapsible agency trace block (Commandment 7).
 */
function TraceBlock({ item }: { item: FeedItem }) {
  const [open, setOpen] = useState(false)
  const meta = item.agencyTraceMeta
  if (!meta) return null

  const roleColors: Record<string, string> = {
    architect: 'text-blue-400 border-blue-500/20 bg-blue-500/5',
    worker: 'text-amber-400 border-amber-500/20 bg-amber-500/5',
    inspector: 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5',
  }

  return (
    <div className={`rounded-[10px] overflow-hidden border ${roleColors[meta.role]}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-white/[0.02] transition-colors cursor-pointer"
      >
        <ChevronRight
          size={12}
          className={`opacity-50 transition-transform shrink-0 ${open ? 'rotate-90' : ''}`}
        />
        <Brain size={12} className="opacity-60 shrink-0" />
        <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">
          Reasoning: {meta.role}
        </span>
        {!open && (
          <span className="text-[10px] opacity-60 truncate flex-1 italic ml-2">
            Click to explain the reasoning...
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-white/[0.05] px-3 py-2 max-h-60 overflow-y-auto">
          <div className="text-[11px] text-gray-300 whitespace-pre-wrap select-text leading-relaxed font-mono">
            <StreamingMarkdown content={meta.content} />
          </div>
          {meta.target && (
            <div className="mt-2 pt-2 border-t border-white/[0.03] text-[9px] text-gray-500 font-mono">
              Target: {meta.target}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Collapsible RAG search trace block (Commandment 17).
 */
function RAGSearchBlock({ item }: { item: FeedItem }) {
  const [open, setOpen] = useState(false)
  const meta = item.ragSearchMeta
  if (!meta) return null

  // Group results by method for compact summary
  const methodCounts = new Map<string, number>()
  for (const r of meta.results) {
    methodCounts.set(r.method, (methodCounts.get(r.method) || 0) + 1)
  }
  const methodSummary = Array.from(methodCounts.entries()).map(([m, c]) => `${c} ${m}`).join(', ')

  return (
    <div className="rounded-[10px] overflow-hidden border border-white/[0.06] bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-white/[0.04] transition-colors cursor-pointer"
      >
        <ChevronRight
          size={12}
          className={`text-gray-500 transition-transform shrink-0 ${open ? 'rotate-90' : ''}`}
        />
        <Info size={11} className="text-blue-400/60 shrink-0" />
        <span className="text-[10px] text-gray-400 font-mono">
          {meta.results.length} snippets
        </span>
        {methodSummary && (
          <span className="text-[9px] text-gray-600 font-mono truncate">
            ({methodSummary})
          </span>
        )}
        {!open && (
          <span className="text-[10px] text-gray-600 truncate flex-1 italic ml-1">
            "{meta.query}"
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-white/[0.04] px-3 py-2 max-h-40 overflow-y-auto">
          <div className="space-y-1">
            {meta.results.map((r, i) => (
              <div key={i} className="flex items-center justify-between text-[10px] font-mono">
                <span className="text-gray-300 truncate mr-4">{r.file_path}</span>
                <span className="text-gray-600 shrink-0">{(r.score * 100).toFixed(0)}% · {r.method}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Memoized individual feed item — only re-renders when the item itself changes.
 */
const FeedItemView = memo(function FeedItemView({
  item,
  sessionId,
  onDiffDecided,
  onEscalationResponded,
  onPlanDecision,
  isLastThinking,
}: {
  item: FeedItem
  sessionId: string
  onDiffDecided: (callId: string, approved: boolean, reason?: string) => void
  onEscalationResponded: (escalationId: string, userMessage: string) => void
  onPlanDecision?: (sessionId: string, approved: boolean) => void
  isLastThinking?: boolean
}) {
  switch (item.type) {
    case 'user': {
      const hasCodeBlock = item.content.includes('```')
      return (
        <div className="flex justify-end">
          <div className="flex items-start gap-2 max-w-[80%]">
            <div className="bg-blue-600/20 border border-blue-500/20 rounded-lg px-3 py-2 text-[11px] text-white select-text">
              {hasCodeBlock ? (
                <div className="prose prose-invert prose-sm max-w-none text-[11px]">
                  <StreamingMarkdown content={item.content} />
                </div>
              ) : (
                <span className="font-mono">{item.content}</span>
              )}
            </div>
            <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center shrink-0 mt-0.5">
              <User size={14} className="text-gray-400" />
            </div>
          </div>
        </div>
      )
    }

    case 'ai_text': {
      const cleanContent = stripModelTags(item.content)
      if (!cleanContent) return null
      return (
        <div className="min-w-0 prose prose-invert prose-sm max-w-none text-[11px] text-gray-200 select-text break-words overflow-hidden font-mono">
          <StreamingMarkdown content={cleanContent} />
        </div>
      )
    }

    case 'tool_start':
      return (
        <div className="flex items-center gap-1.5 mt-0.5">
          <Cpu size={10} className="text-gray-500 shrink-0" />
          <span className="text-[10px] text-gray-500 font-mono truncate">
            {item.toolMeta?.tool === 'run_bash' ? `$ ${item.toolMeta?.command || ''}` : item.toolMeta?.tool?.replace(/_/g, ' ') || 'tool'}
          </span>
        </div>
      )

    case 'tool_output':
      return (
        <CollapsibleToolOutput item={item} />
      )

    case 'diff_proposal':
      return item.diffMeta ? (
        <HolographicDiff
          meta={item.diffMeta}
          sessionId={sessionId}
          onDecided={onDiffDecided}
        />
      ) : null

    case 'plan_proposal':
      return item.planMeta ? (
        <PlanCard
          meta={item.planMeta}
          onApprove={(sid) => onPlanDecision?.(sid, true)}
          onReject={(sid) => onPlanDecision?.(sid, false)}
        />
      ) : null

    case 'plan_step':
      return (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/5 border border-blue-500/10 rounded-lg">
          <FileEdit size={11} className="text-blue-400 shrink-0" />
          <span className="text-[10px] text-blue-400 font-mono">{item.content}</span>
        </div>
      )

    case 'auto_retry': {
      const meta = item.autoRetryMeta
      if (!meta) return null

      if (meta.status === 'retrying') {
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/5 border border-amber-500/15 rounded-lg">
            <RefreshCw size={12} className="text-amber-400 animate-spin" />
            <span className="text-xs text-amber-400 font-mono">
              Self-heal attempt {meta.attempt}/{meta.maxAttempts}
            </span>
            <span className="text-[10px] text-gray-500 truncate max-w-[300px]">{meta.command}</span>
          </div>
        )
      }

      if (meta.status === 'resolved') {
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/5 border border-emerald-500/15 rounded-lg">
            <CheckCircle2 size={12} className="text-emerald-400" />
            <span className="text-xs text-emerald-400 font-mono">
              Fixed after {meta.attempt} {meta.attempt === 1 ? 'retry' : 'retries'}
            </span>
          </div>
        )
      }

      // exhausted
      return (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/5 border border-red-500/15 rounded-lg">
          <XCircle size={12} className="text-red-400" />
          <span className="text-xs text-red-400 font-mono">
            Self-heal failed after {meta.attempt} attempts
          </span>
          <span className="text-[10px] text-gray-500 truncate max-w-[300px]">{meta.command}</span>
        </div>
      )
    }

    case 'thinking':
      return <ThinkingBlock item={item} autoExpand={isLastThinking} />

    case 'step_label':
      return (
        <div className="flex items-center gap-2 py-0.5">
          <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
          <span className="text-[11px] text-blue-400/70 font-mono">{item.content}</span>
        </div>
      )

    case 'swarm_progress':
      return (
        <div className="flex items-center gap-2 py-0.5">
          <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-pulse" />
          <span className="text-[11px] text-purple-400/70 font-mono">{item.content}</span>
        </div>
      )

    case 'human_escalation':
      return item.escalationMeta ? (
        <EscalationCard
          item={item}
          sessionId={sessionId}
          onResponded={onEscalationResponded}
        />
      ) : null

    case 'error':
      return (
        <div className="flex items-start gap-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertCircle size={12} className="text-red-400 shrink-0 mt-0.5" />
          <span className="text-[11px] text-red-300 font-mono select-text">{item.content}</span>
        </div>
      )

    case 'info': {
      const isDone = item.content.startsWith('Done')
      const isSessionStart = item.content.startsWith('Session started')
      if (isDone) {
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/5 border border-emerald-500/10 rounded-lg">
            <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
            <span className="text-[11px] text-emerald-400/80 font-mono">{item.content}</span>
          </div>
        )
      }
      if (isSessionStart) {
        return (
          <div className="flex items-center gap-2 py-1">
            <div className="w-1 h-1 bg-gray-500 rounded-full" />
            <span className="text-[10px] text-gray-500 font-mono">{item.content}</span>
          </div>
        )
      }
      return (
        <div className="flex items-center gap-2">
          <Info size={12} className="text-gray-500 shrink-0" />
          <span className="text-xs text-gray-500">{item.content}</span>
        </div>
      )
    }

    case 'agency_trace':
      return <TraceBlock item={item} />

    case 'rag_search':
      return <RAGSearchBlock item={item} />

    default:
      return null
  }
})

export function MessageFeed({ items, sessionId, onDiffDecided, onEscalationResponded, onPlanDecision }: MessageFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)

  // Stable callback ref for onDiffDecided
  const onDiffDecidedRef = useRef(onDiffDecided)
  onDiffDecidedRef.current = onDiffDecided
  const stableDiffDecided = useCallback((callId: string, approved: boolean, reason?: string) => {
    onDiffDecidedRef.current(callId, approved, reason)
  }, [])

  // Stable callback ref for onEscalationResponded
  const onEscalationRef = useRef(onEscalationResponded)
  onEscalationRef.current = onEscalationResponded
  const stableEscalationResponded = useCallback((escalationId: string, userMessage: string) => {
    onEscalationRef.current(escalationId, userMessage)
  }, [])

  const onPlanDecisionRef = useRef(onPlanDecision)
  onPlanDecisionRef.current = onPlanDecision
  const stablePlanDecision = useCallback((sid: string, approved: boolean) => {
    onPlanDecisionRef.current?.(sid, approved)
  }, [])

  // Track whether user has scrolled up manually
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handleScroll = () => {
      const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      userScrolledUpRef.current = distFromBottom > 150
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  // Auto-scroll to bottom on content change — unless user scrolled up
  const lastItem = items[items.length - 1]
  const prevItemsLenRef = useRef(items.length)
  useEffect(() => {
    if (userScrolledUpRef.current) return
    const container = containerRef.current
    if (!container) return
    // Use smooth scroll for streaming updates, instant for new items
    const isNewItem = items.length !== prevItemsLenRef.current
    prevItemsLenRef.current = items.length
    if (isNewItem) {
      // New item added — scroll instantly to avoid lag
      container.scrollTop = container.scrollHeight
    } else {
      // Streaming token update — smooth scroll
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
    }
  }, [items.length, lastItem?.content])

  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <img src="/icon.svg" alt="" className="w-10 h-10 rounded-xl mx-auto" />
          <div className="space-y-1">
            <p className="text-xs text-gray-400 font-medium">What would you like to build?</p>
            <p className="text-[10px] text-gray-600">Describe a task or select code and right-click for quick actions.</p>
          </div>
        </div>
      </div>
    )
  }

  // Auto-expand thinking block if no ai_text follows it (model put answer inside think tags)
  const lastThinkingIdx = (() => {
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === 'thinking') return i
      if (items[i].type === 'ai_text') return -1
    }
    return -1
  })()

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-3">
      <div className="min-h-full flex flex-col justify-end space-y-2">
        {items.map((item, idx) => (
          <FeedItemView
            key={item.id}
            item={item}
            sessionId={sessionId}
            onDiffDecided={stableDiffDecided}
            onEscalationResponded={stableEscalationResponded}
            onPlanDecision={stablePlanDecision}
            isLastThinking={item.type === 'thinking' && idx === lastThinkingIdx}
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
