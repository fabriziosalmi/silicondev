import { useState, type ComponentPropsWithoutRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BookOpen, ChevronRight } from 'lucide-react'

// Vite raw imports from docs/
// Guide
import gettingStarted from '../../../../docs/guide/getting-started.md?raw'
import architecture from '../../../../docs/guide/architecture.md?raw'
import configuration from '../../../../docs/guide/configuration.md?raw'
// Local Server (matches sidebar order)
import modelsDoc from '../../../../docs/features/models.md?raw'
import chatDoc from '../../../../docs/features/chat.md?raw'
import terminalDoc from '../../../../docs/features/terminal.md?raw'
import codeDoc from '../../../../docs/features/code-workspace.md?raw'
import notesDoc from '../../../../docs/features/notes.md?raw'
// Advanced Tools (matches sidebar order)
import dataPrepDoc from '../../../../docs/features/data-preparation.md?raw'
import fineTuningDoc from '../../../../docs/features/fine-tuning.md?raw'
import modelExportDoc from '../../../../docs/features/model-export.md?raw'
import evaluationsDoc from '../../../../docs/features/evaluations.md?raw'
import ragDoc from '../../../../docs/features/rag.md?raw'
import agentsDoc from '../../../../docs/features/agents.md?raw'
import mcpDoc from '../../../../docs/features/mcp.md?raw'
import deploymentDoc from '../../../../docs/features/deployment.md?raw'
// App
import settingsDoc from '../../../../docs/features/settings.md?raw'

interface DocEntry {
    id: string
    title: string
    content: string
}

interface DocSection {
    label: string
    docs: DocEntry[]
}

const sections: DocSection[] = [
    {
        label: 'Guide',
        docs: [
            { id: 'getting-started', title: 'Getting Started', content: gettingStarted },
            { id: 'architecture', title: 'Architecture', content: architecture },
            { id: 'configuration', title: 'Configuration', content: configuration },
        ],
    },
    {
        label: 'Local Server',
        docs: [
            { id: 'models', title: 'Models', content: modelsDoc },
            { id: 'chat', title: 'Chat', content: chatDoc },
            { id: 'terminal', title: 'Terminal', content: terminalDoc },
            { id: 'code', title: 'Code', content: codeDoc },
            { id: 'notes', title: 'Notes', content: notesDoc },
        ],
    },
    {
        label: 'Advanced Tools',
        docs: [
            { id: 'data-preparation', title: 'Data Preparation', content: dataPrepDoc },
            { id: 'fine-tuning', title: 'Fine-Tuning', content: fineTuningDoc },
            { id: 'model-export', title: 'Model Export', content: modelExportDoc },
            { id: 'evaluations', title: 'Model Evaluations', content: evaluationsDoc },
            { id: 'rag', title: 'RAG Knowledge', content: ragDoc },
            { id: 'mcp', title: 'MCP Servers', content: mcpDoc },
            { id: 'agents', title: 'Pipelines & Jobs', content: agentsDoc },
            { id: 'deployment', title: 'Deployment', content: deploymentDoc },
        ],
    },
    {
        label: 'App',
        docs: [
            { id: 'settings', title: 'Settings', content: settingsDoc },
        ],
    },
]

// Custom renderers for markdown elements (no @tailwindcss/typography needed)
const mdComponents = {
    h1: (props: ComponentPropsWithoutRef<'h1'>) => <h1 className="text-xl font-bold text-white mb-4 mt-0" {...props} />,
    h2: (props: ComponentPropsWithoutRef<'h2'>) => <h2 className="text-lg font-semibold text-white mt-8 mb-3 pb-2 border-b border-white/10" {...props} />,
    h3: (props: ComponentPropsWithoutRef<'h3'>) => <h3 className="text-base font-medium text-white mt-6 mb-2" {...props} />,
    h4: (props: ComponentPropsWithoutRef<'h4'>) => <h4 className="text-sm font-medium text-white mt-4 mb-1" {...props} />,
    p: (props: ComponentPropsWithoutRef<'p'>) => <p className="text-sm text-gray-300 leading-relaxed mb-3" {...props} />,
    a: (props: ComponentPropsWithoutRef<'a'>) => <a className="text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer" {...props} />,
    strong: (props: ComponentPropsWithoutRef<'strong'>) => <strong className="text-white font-semibold" {...props} />,
    em: (props: ComponentPropsWithoutRef<'em'>) => <em className="text-gray-200" {...props} />,
    ul: (props: ComponentPropsWithoutRef<'ul'>) => <ul className="list-disc list-outside ml-5 mb-3 space-y-1 text-sm text-gray-300" {...props} />,
    ol: (props: ComponentPropsWithoutRef<'ol'>) => <ol className="list-decimal list-outside ml-5 mb-3 space-y-1 text-sm text-gray-300" {...props} />,
    li: (props: ComponentPropsWithoutRef<'li'>) => <li className="text-sm text-gray-300 leading-relaxed" {...props} />,
    blockquote: (props: ComponentPropsWithoutRef<'blockquote'>) => <blockquote className="border-l-2 border-blue-500 pl-4 my-3 text-sm text-gray-400 italic" {...props} />,
    hr: () => <hr className="border-white/10 my-6" />,
    code: ({ children, className, ...props }: ComponentPropsWithoutRef<'code'> & { className?: string }) => {
        // Inline code (no language class) vs code block (has language class from ```lang)
        const isBlock = className?.startsWith('language-')
        if (isBlock) {
            return <code className="text-[13px] text-gray-200" {...props}>{children}</code>
        }
        return <code className="text-[13px] text-blue-300 bg-white/5 px-1.5 py-0.5 rounded font-mono" {...props}>{children}</code>
    },
    pre: (props: ComponentPropsWithoutRef<'pre'>) => (
        <pre className="bg-black/50 border border-white/5 rounded-lg p-4 mb-3 overflow-x-auto font-mono text-[13px] leading-relaxed" {...props} />
    ),
    table: (props: ComponentPropsWithoutRef<'table'>) => (
        <div className="overflow-x-auto mb-3">
            <table className="w-full text-sm" {...props} />
        </div>
    ),
    thead: (props: ComponentPropsWithoutRef<'thead'>) => <thead className="border-b border-white/10" {...props} />,
    th: (props: ComponentPropsWithoutRef<'th'>) => <th className="text-left text-xs font-bold text-gray-400 uppercase tracking-wide py-2 px-3" {...props} />,
    td: (props: ComponentPropsWithoutRef<'td'>) => <td className="py-2 px-3 text-gray-300 border-b border-white/5" {...props} />,
    tr: (props: ComponentPropsWithoutRef<'tr'>) => <tr className="hover:bg-white/[0.02]" {...props} />,
}

export function Documentation() {
    const [activeDoc, setActiveDoc] = useState('getting-started')

    const current = sections.flatMap(s => s.docs).find(d => d.id === activeDoc)

    return (
        <div className="max-w-5xl mx-auto flex gap-6">
            {/* Sidebar nav */}
            <nav className="w-48 shrink-0 space-y-4">
                <div className="flex items-center gap-2 mb-4">
                    <BookOpen size={20} className="text-blue-400" />
                    <h2 className="text-lg font-bold text-white">Docs</h2>
                </div>
                {sections.map(section => (
                    <div key={section.label}>
                        <div className="text-[10px] font-bold tracking-wide text-gray-500 uppercase mb-1 px-2">{section.label}</div>
                        <div className="space-y-0.5">
                            {section.docs.map(doc => (
                                <button
                                    key={doc.id}
                                    onClick={() => setActiveDoc(doc.id)}
                                    className={`w-full text-left flex items-center gap-1.5 px-2 py-1.5 rounded text-[13px] transition-colors ${
                                        activeDoc === doc.id
                                            ? 'bg-blue-500/10 text-blue-400 font-medium'
                                            : 'text-gray-400 hover:text-white hover:bg-white/5'
                                    }`}
                                >
                                    {activeDoc === doc.id && <ChevronRight size={12} />}
                                    <span>{doc.title}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </nav>

            {/* Content */}
            <div className="flex-1 min-w-0">
                {current ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                        {current.content}
                    </ReactMarkdown>
                ) : (
                    <p className="text-gray-500">Select a document from the sidebar.</p>
                )}
            </div>
        </div>
    )
}
