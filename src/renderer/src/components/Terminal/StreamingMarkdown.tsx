import { useState, useEffect, useRef, useCallback, memo, type ComponentProps } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, Check, FileInput } from 'lucide-react'


/**
 * Code block with Copy / Apply actions.
 */
function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code.replace(/\n$/, ''))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [code])

  const handleApply = useCallback(() => {
    window.dispatchEvent(new CustomEvent('nanocore-apply-snippet', { detail: code.replace(/\n$/, '') }))
  }, [code])

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-white/[0.06] group">
      <div className="flex items-center justify-between px-3 py-1 bg-white/[0.03] border-b border-white/[0.06]">
        {lang ? (
          <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider">{lang}</span>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Copy code"
          >
            {copied ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Apply to active file"
          >
            <FileInput size={10} />
            Apply
          </button>
        </div>
      </div>
      <pre className="px-3 py-2 bg-white/[0.02] text-xs font-mono text-gray-200 leading-relaxed overflow-x-auto">
        <code>{code}</code>
      </pre>
    </div>
  )
}

/**
 * Custom components for ReactMarkdown — dark-themed, matching Companion patterns.
 */
const markdownComponents: ComponentProps<typeof ReactMarkdown>['components'] = {
  p: ({ children }) => (
    <p className="mb-2 last:mb-0">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-white">{children}</strong>
  ),
  h1: ({ children }) => (
    <h1 className="text-lg font-bold text-white mt-3 mb-2">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-bold text-white mt-3 mb-1">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-white mt-2 mb-1">{children}</h3>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-gray-200">{children}</li>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-blue-500/30 pl-3 my-2 text-gray-400 italic">
      {children}
    </blockquote>
  ),
  hr: () => (
    <hr className="border-white/10 my-3" />
  ),
  code({ className, children, ...props }: React.ComponentPropsWithoutRef<'code'> & { className?: string }) {
    const match = /language-(\w+)/.exec(className || '')
    const isBlock = match || (typeof children === 'string' && children.includes('\n'))

    if (isBlock) {
      const lang = match?.[1] || ''
      const codeText = typeof children === 'string' ? children : String(children ?? '')
      return <CodeBlock lang={lang} code={codeText} />
    }
    return (
      <code className="bg-white/[0.06] px-1.5 py-0.5 rounded text-xs font-mono text-blue-300" {...props}>
        {children}
      </code>
    )
  },
  pre({ children }) {
    return <>{children}</>
  },
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="min-w-full text-xs border border-white/10 rounded-lg overflow-hidden">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-white/[0.03]">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="px-3 py-1.5 text-left text-xs font-semibold text-white border-b border-white/10">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-1.5 text-xs text-gray-300 border-b border-white/[0.06]">
      {children}
    </td>
  ),
}

const MemoizedMarkdown = memo(function MemoizedMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  )
})

/**
* Renders markdown with a smooth "Liquid Flow" effect.
* Instead of jumping, it trickles characters from the buffer at a constant rate.
*/
export function StreamingMarkdown({ content }: { content: string }) {
  const [displayedText, setDisplayedText] = useState(content)
  const bufferRef = useRef(content)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Update buffer when content changes
  useEffect(() => {
    bufferRef.current = content

    // If we are already caught up and new content arrives, start the trickle
    if (!intervalRef.current) {
      intervalRef.current = setInterval(() => {
        setDisplayedText((prev) => {
          if (prev.length < bufferRef.current.length) {
            // Add 1-3 chars for a more natural flow
            const sliceSize = Math.min(3, bufferRef.current.length - prev.length)
            return prev + bufferRef.current.slice(prev.length, prev.length + sliceSize)
          } else {
            // Already caught up
            if (intervalRef.current) {
              clearInterval(intervalRef.current)
              intervalRef.current = null
            }
            return prev
          }
        })
      }, 25) // Smooth 40fps trickle
    }

    return () => {
      if (content.length === bufferRef.current.length && displayedText.length === content.length) {
        // wait for next update
      }
    }
  }, [content])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const isStreaming = displayedText.length < content.length

  return (
    <div className="relative">
      <MemoizedMarkdown content={displayedText} />
      {isStreaming && (
        <span className="inline-block w-1.5 h-3.5 bg-blue-400/80 ml-1 translate-y-0.5 animate-pulse rounded-sm" />
      )}
    </div>
  )
}
