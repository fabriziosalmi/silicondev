import { useState, useRef, useEffect, memo, useCallback } from 'react'
import { User, Bot, TerminalSquare, AlertCircle, Info, AlertTriangle, Send, Cpu, RefreshCw, XCircle, CheckCircle2, ChevronRight } from 'lucide-react'
import { StreamingMarkdown } from './StreamingMarkdown'
import { HolographicDiff } from './HolographicDiff'
import { apiClient } from '../../api/client'
import type { FeedItem } from './types'

// Strip XML tool/arg tags that may leak through the backend SSE stream.
// Matches both complete blocks (<tool ...>...</tool>) and orphaned tags.
const TOOL_BLOCK_RE = /<tool\s+name="[^"]*">[\s\S]*?<\/tool>/g
const STRAY_TAG_RE = /<\/?(?:tool|arg)\b[^>]*>/g

function stripToolXml(text: string): string {
  return text.replace(TOOL_BLOCK_RE, '').replace(STRAY_TAG_RE, '').trim()
}

interface MessageFeedProps {
  items: FeedItem[]
  sessionId: string
  onDiffDecided: (callId: string, approved: boolean, reason?: string) => void
  onEscalationResponded: (escalationId: string, userMessage: string) => void
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
          className="px-2 py-1.5 bg-yellow-600/20 hover:bg-yellow-600/30 border border-yellow-500/30 rounded text-xs text-yellow-400 disabled:opacity-40 transition-colors flex items-center gap-1"
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
  const [open, setOpen] = useState(false)
  const command = item.toolMeta?.command || ''
  const lines = item.content.split(/\r?\n/)
  const hasMore = lines.length > 20
  const [showFull, setShowFull] = useState(false)
  const rendered = showFull || !hasMore ? item.content : lines.slice(-20).join('\n')
  const isError = item.toolMeta?.exitCode !== undefined && item.toolMeta.exitCode !== 0

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
            <pre className={`text-xs font-mono select-text whitespace-pre-wrap break-words leading-relaxed ${
              isError ? 'text-red-300/90' : 'text-green-300/90'
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
 * Memoized individual feed item — only re-renders when the item itself changes.
 */
const FeedItemView = memo(function FeedItemView({
  item,
  sessionId,
  onDiffDecided,
  onEscalationResponded,
}: {
  item: FeedItem
  sessionId: string
  onDiffDecided: (callId: string, approved: boolean, reason?: string) => void
  onEscalationResponded: (escalationId: string, userMessage: string) => void
}) {
  switch (item.type) {
    case 'user':
      return (
        <div className="flex justify-end">
          <div className="flex items-start gap-2 max-w-[80%]">
            <div className="bg-blue-600/20 border border-blue-500/20 rounded-lg px-3 py-2 text-sm text-white select-text font-mono">
              {item.content}
            </div>
            <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center shrink-0 mt-0.5">
              <User size={14} className="text-gray-400" />
            </div>
          </div>
        </div>
      )

    case 'ai_text': {
      const cleanContent = stripToolXml(item.content)
      if (!cleanContent) return null
      return (
        <div className="flex items-start gap-2">
          <div className="w-6 h-6 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5">
            <Bot size={14} className="text-blue-400" />
          </div>
          <div className="min-w-0 flex-1 prose prose-invert prose-sm max-w-none text-sm text-gray-200 select-text break-words overflow-hidden">
            <StreamingMarkdown content={cleanContent} />
          </div>
        </div>
      )
    }

    case 'tool_start':
      return (
        <div className="flex items-center gap-2 mt-1">
          <Cpu size={11} className="text-yellow-500/70 shrink-0" />
          <span className="text-[10px] text-yellow-500/60 font-mono">
            {item.toolMeta?.tool === 'run_bash' ? `$ ${item.toolMeta?.command || ''}` : item.toolMeta?.tool || 'NanoCore Executed'}
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
          <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
          <span className="text-sm text-red-300 select-text">{item.content}</span>
        </div>
      )

    case 'info':
      return (
        <div className="flex items-center gap-2">
          <Info size={12} className="text-gray-500 shrink-0" />
          <span className="text-xs text-gray-500">{item.content}</span>
        </div>
      )

    default:
      return null
  }
})

export function MessageFeed({ items, sessionId, onDiffDecided, onEscalationResponded }: MessageFeedProps) {
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

  // Track whether user has scrolled up manually
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handleScroll = () => {
      const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      userScrolledUpRef.current = distFromBottom > 80
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  // Auto-scroll to bottom on content change — unless user scrolled up
  const lastItem = items[items.length - 1]
  useEffect(() => {
    if (userScrolledUpRef.current) return
    const container = containerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [items.length, lastItem?.content])

  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <TerminalSquare size={32} className="mx-auto text-gray-600" />
          <p className="text-sm text-gray-500">Run commands or ask NanoCore to build something.</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
      {items.map((item) => (
        <FeedItemView
          key={item.id}
          item={item}
          sessionId={sessionId}
          onDiffDecided={stableDiffDecided}
          onEscalationResponded={stableEscalationResponded}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
