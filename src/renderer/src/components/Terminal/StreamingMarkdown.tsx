import { useState, useEffect, useRef, memo, type ComponentProps } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const DEBOUNCE_MS = 120

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
      return (
        <div className="my-2 rounded-lg overflow-hidden border border-white/[0.06]">
          {lang && (
            <div className="px-3 py-1 bg-white/[0.03] border-b border-white/[0.06] text-[10px] text-gray-500 font-mono uppercase tracking-wider">
              {lang}
            </div>
          )}
          <pre className="px-3 py-2 bg-white/[0.02] text-[12px] font-mono text-gray-200 leading-relaxed overflow-x-auto">
            <code>{children}</code>
          </pre>
        </div>
      )
    }
    return (
      <code className="bg-white/[0.06] px-1.5 py-0.5 rounded text-[12px] font-mono text-blue-300" {...props}>
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
 * Renders markdown with debounced updates during streaming.
 */
export function StreamingMarkdown({ content }: { content: string }) {
  const [renderedContent, setRenderedContent] = useState(content)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevLenRef = useRef(content.length)

  useEffect(() => {
    const isGrowing = content.length > prevLenRef.current
    prevLenRef.current = content.length

    if (!isGrowing) {
      if (timerRef.current) clearTimeout(timerRef.current)
      setRenderedContent(content)
      return
    }

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setRenderedContent(content)
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [content])

  const tail = content.slice(renderedContent.length)

  return (
    <>
      <MemoizedMarkdown content={renderedContent} />
      {tail && <span className="whitespace-pre-wrap">{tail}</span>}
    </>
  )
}
