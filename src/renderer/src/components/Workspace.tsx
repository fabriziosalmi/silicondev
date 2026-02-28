import { useState, useMemo, useRef } from 'react'
import { PageHeader } from './ui/PageHeader'
import { Wand2, Copy, Loader2, Download, Upload, FileText } from 'lucide-react'
import { SimpleMdeReact } from "react-simplemde-editor";
import "simplemde/dist/simplemde.min.css";
import { useGlobalState } from '../context/GlobalState'
import { apiClient } from '../api/client'

const NOTES_STORAGE_KEY = 'silicon-studio-notes';

export function Workspace() {
    const { activeModel } = useGlobalState()
    const fileInputRef = useRef<HTMLInputElement>(null)

    const [documentBody, setDocumentBody] = useState(() => {
        try {
            const saved = localStorage.getItem(NOTES_STORAGE_KEY);
            return saved ?? '';
        } catch {
            return '';
        }
    })
    const [isGenerating, setIsGenerating] = useState(false)

    const editorOptions = useMemo(() => ({
        toolbar: false as const,
        status: false as const,
        spellChecker: false,
        placeholder: "Start writing... Markdown is supported.",
    }), [])

    const handleChange = (value: string) => {
        setDocumentBody(value)
        try { localStorage.setItem(NOTES_STORAGE_KEY, value); } catch { /* ignore */ }
    }

    // Export as .md file
    const handleExport = (format: 'md' | 'txt') => {
        const blob = new Blob([documentBody], { type: format === 'md' ? 'text/markdown' : 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `notes.${format}`
        a.click()
        URL.revokeObjectURL(url)
    }

    // Import from file
    const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
            const text = reader.result as string
            handleChange(text)
        }
        reader.readAsText(file)
        // Reset input so the same file can be imported again
        e.target.value = ''
    }

    // AI generation
    const handleAiCommand = async (command: string) => {
        if (!activeModel) return
        setIsGenerating(true)

        const prompts: Record<string, string> = {
            continue: `Continue writing the following document naturally:\n\n${documentBody}`,
            summarize: `Provide a brief TL;DR summary of this document:\n\n${documentBody}`,
            draft: `Write an introduction section for the following document:\n\n${documentBody}`,
        }

        const prompt = prompts[command] || prompts.continue

        try {
            const response = await fetch(`${apiClient.API_BASE}/api/engine/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model_id: activeModel.id,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7,
                    max_tokens: 256
                })
            })

            if (!response.ok) throw new Error(`HTTP ${response.status}`)

            const reader = response.body?.getReader()
            const decoder = new TextDecoder()
            let generated = ''
            let lineBuffer = ''

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break
                    lineBuffer += decoder.decode(value, { stream: true })
                    const lines = lineBuffer.split('\n')
                    lineBuffer = lines.pop() ?? ''
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6))
                                if (data.text) generated += data.text
                            } catch { /* skip partial JSON */ }
                        }
                    }
                }
            }

            if (generated.trim()) {
                handleChange(documentBody + '\n\n' + generated.trim())
            }
        } catch (e: any) {
            alert(`AI generation failed: ${e.message}`)
        } finally {
            setIsGenerating(false)
        }
    }

    return (
        <div className="h-full flex flex-col text-white overflow-hidden pb-4">
            <PageHeader>
                <div className="flex items-center gap-2">
                    {/* Import */}
                    <input
                        ref={fileInputRef}
                        type="file"
                        title="Import file"
                        accept=".md,.txt,.markdown,.text"
                        onChange={handleImport}
                        className="hidden"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                        title="Import file"
                    >
                        <Upload className="w-3.5 h-3.5" />
                        Import
                    </button>

                    {/* Export */}
                    <button
                        onClick={() => handleExport('md')}
                        disabled={!documentBody.trim()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40"
                        title="Export as Markdown"
                    >
                        <Download className="w-3.5 h-3.5" />
                        .md
                    </button>
                    <button
                        onClick={() => handleExport('txt')}
                        disabled={!documentBody.trim()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40"
                        title="Export as plain text"
                    >
                        <FileText className="w-3.5 h-3.5" />
                        .txt
                    </button>
                </div>
            </PageHeader>

            <div className="flex-1 flex gap-4 overflow-hidden min-h-0">

                {/* Editor Area */}
                <div className="flex-1 bg-[#18181B] border border-white/10 rounded-xl overflow-hidden flex flex-col">

                    {/* Status bar */}
                    <div className="h-9 border-b border-white/5 bg-white/[0.02] flex items-center px-4 justify-between shrink-0">
                        <span className="text-[10px] text-gray-500 font-mono tabular-nums">{documentBody.length} chars</span>
                        {activeModel && (
                            <span className="text-[10px] text-gray-500 font-mono flex items-center gap-1.5">
                                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                {activeModel.name.split('/').pop()}
                            </span>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto editor-container">
                        <SimpleMdeReact
                            value={documentBody}
                            onChange={handleChange}
                            options={editorOptions}
                        />
                    </div>
                </div>

                {/* AI Commands sidebar */}
                <div className="w-64 flex flex-col gap-3 shrink-0">
                    <div className="bg-[#18181B] border border-white/10 rounded-xl p-4 flex flex-col gap-2.5">
                        <h3 className="text-xs font-medium text-gray-400 mb-1">AI Commands</h3>
                        <p className="text-[10px] text-gray-600 mb-1">
                            {activeModel ? `Using ${activeModel.name.split('/').pop()}` : 'Load a model to enable'}
                        </p>
                        <AiButton
                            label="Continue Writing"
                            description="AI continues the document"
                            icon={<Wand2 className="w-4 h-4 text-gray-400 shrink-0" />}
                            onClick={() => handleAiCommand('continue')}
                            disabled={isGenerating || !activeModel}
                            loading={isGenerating}
                        />
                        <AiButton
                            label="Summarize"
                            description="Generate a TL;DR"
                            icon={<Copy className="w-4 h-4 text-gray-400 shrink-0" />}
                            onClick={() => handleAiCommand('summarize')}
                            disabled={isGenerating || !activeModel}
                        />
                        <AiButton
                            label="Draft Introduction"
                            description="Generate a new section"
                            icon={<FileText className="w-4 h-4 text-gray-400 shrink-0" />}
                            onClick={() => handleAiCommand('draft')}
                            disabled={isGenerating || !activeModel}
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}

function AiButton({ label, description, icon, onClick, disabled, loading }: {
    label: string
    description: string
    icon: React.ReactNode
    onClick: () => void
    disabled: boolean
    loading?: boolean
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="w-full flex items-center gap-3 px-3 py-2.5 bg-black/30 hover:bg-white/5 border border-white/5 rounded-lg transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
        >
            {icon}
            <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-gray-200">{label}</div>
                <div className="text-[10px] text-gray-600">{description}</div>
            </div>
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" />}
        </button>
    )
}
