import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from './ui/PageHeader'
import { useToast } from './ui/Toast'
import { Wand2, Copy, Loader2, Download, Upload, FileText, Table, List, Expand, ListTree, Send, Printer, Sparkles, Plus, Save, Sheet, Bold, Italic, Strikethrough, Code, Heading1, Heading2, Link, ListOrdered, Quote, Eye, EyeOff, Minus, ChevronDown } from 'lucide-react'
import { SimpleMdeReact } from "react-simplemde-editor";
import type EasyMDE from "easymde";
import "easymde/dist/easymde.min.css";
import { useGlobalState } from '../context/GlobalState'
import { useNotes } from '../context/NotesContext'
import { apiClient, cleanModelName } from '../api/client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const LEGACY_STORAGE_KEY = 'silicon-studio-notes';

export function Workspace() {
    const { t } = useTranslation()
    const { toast } = useToast()
    const { activeModel, setPendingChatInput } = useGlobalState()
    const { activeNoteId, setActiveNoteId, fetchNotes } = useNotes()
    const fileInputRef = useRef<HTMLInputElement>(null)
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const skipLoadRef = useRef(false)

    const [documentBody, setDocumentBody] = useState('')
    const [isGenerating, setIsGenerating] = useState(false)
    const [noteLoaded, setNoteLoaded] = useState(false)
    const [showPreview, setShowPreview] = useState(false)
    const [splitPercent, setSplitPercent] = useState(50)
    const [showExportMenu, setShowExportMenu] = useState(false)
    const isDraggingRef = useRef(false)
    const splitContainerRef = useRef<HTMLDivElement>(null)
    const exportMenuRef = useRef<HTMLDivElement>(null)
    const creatingNoteRef = useRef(false)
    const lastSavedContentRef = useRef<string>('')
    const mdeRef = useRef<EasyMDE | null>(null)

    const getMdeInstance = useCallback((instance: EasyMDE) => {
        mdeRef.current = instance
    }, [])

    // Close export menu on outside click
    useEffect(() => {
        if (!showExportMenu) return
        const handler = (e: MouseEvent) => {
            if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
                setShowExportMenu(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [showExportMenu])

    // Insert markdown formatting around selection or at cursor
    const insertFormat = useCallback((prefix: string, suffix?: string, block?: boolean) => {
        const cm = mdeRef.current?.codemirror
        if (!cm) return
        const suf = suffix ?? prefix
        const sel = cm.getSelection()
        if (block) {
            // Line-level: prepend to each selected line or current line
            if (sel) {
                const lines = sel.split('\n').map(l => `${prefix}${l}`)
                cm.replaceSelection(lines.join('\n'))
            } else {
                const cursor = cm.getCursor()
                const line = cm.getLine(cursor.line)
                cm.replaceRange(`${prefix}${line}`, { line: cursor.line, ch: 0 }, { line: cursor.line, ch: line.length })
            }
        } else if (sel) {
            cm.replaceSelection(`${prefix}${sel}${suf}`)
        } else {
            const cursor = cm.getCursor()
            cm.replaceRange(`${prefix}${suf}`, cursor)
            cm.setCursor({ line: cursor.line, ch: cursor.ch + prefix.length })
        }
        cm.focus()
    }, [])

    // Load note when activeNoteId changes
    useEffect(() => {
        if (skipLoadRef.current) { skipLoadRef.current = false; return; }
        if (activeNoteId) {
            (async () => {
                try {
                    const note = await apiClient.notes.get(activeNoteId);
                    setDocumentBody(note.content);
                    setNoteLoaded(true);
                } catch {
                    setDocumentBody('');
                    setNoteLoaded(true);
                }
            })();
        } else {
            setDocumentBody('');
            setNoteLoaded(true);
        }
    }, [activeNoteId]);

    // Migrate legacy localStorage note on first load
    useEffect(() => {
        if (!activeNoteId && noteLoaded) {
            try {
                const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
                if (legacy && legacy.trim()) {
                    setDocumentBody(legacy);
                    // Create a note from the legacy content
                    (async () => {
                        const note = await apiClient.notes.create('Migrated Note', legacy);
                        skipLoadRef.current = true;
                        setActiveNoteId(note.id);
                        fetchNotes();
                        localStorage.removeItem(LEGACY_STORAGE_KEY);
                    })();
                }
            } catch { /* ignore */ }
        }
    }, [noteLoaded, activeNoteId]);

    const editorOptions = useMemo(() => ({
        toolbar: false as const,
        status: false as const,
        spellChecker: false,
        placeholder: "Start writing... Markdown is supported.",
    }), [])

    // Flush pending save on unmount or note switch
    useEffect(() => {
        return () => {
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
        };
    }, [activeNoteId]);

    // Debounced save: immediate local state, delayed backend persist
    const handleChange = useCallback((value: string) => {
        setDocumentBody(value);
        lastSavedContentRef.current = value;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(async () => {
            if (activeNoteId) {
                try {
                    await apiClient.notes.update(activeNoteId, { content: value });
                } catch {
                    // save failed silently
                }
            } else if (value.trim() && !creatingNoteRef.current) {
                // Auto-create a new note (guarded against double-create)
                creatingNoteRef.current = true;
                try {
                    const title = value.split('\n')[0].replace(/^#+\s*/, '').slice(0, 60) || 'Untitled';
                    const note = await apiClient.notes.create(title, value);
                    skipLoadRef.current = true;
                    setActiveNoteId(note.id);
                    fetchNotes();
                } catch {
                    // create failed silently
                } finally {
                    creatingNoteRef.current = false;
                }
            }
        }, 800);
    }, [activeNoteId, setActiveNoteId, fetchNotes]);

    const handleNewNote = useCallback(() => {
        setActiveNoteId(null);
        setDocumentBody('');
    }, [setActiveNoteId]);

    // Export as .md file
    const handleExport = (format: 'md' | 'txt') => {
        const blob = new Blob([documentBody], { type: format === 'md' ? 'text/markdown' : 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const titleSlug = (documentBody.split('\n')[0]?.replace(/^#+\s*/, '').trim() || 'note').slice(0, 40).replace(/[^a-zA-Z0-9]+/g, '-').replace(/-+$/, '');
        a.download = `${titleSlug}.${format}`
        a.click()
        URL.revokeObjectURL(url)
    }

    // PDF export via print dialog
    const handleExportPdf = () => {
        const win = window.open('', '_blank');
        if (!win) return;
        // Convert markdown to basic HTML (simple approach)
        const html = documentBody
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`(.+?)`/g, '<code style="background:#f0f0f0;padding:2px 4px;border-radius:3px">$1</code>')
            .replace(/\n/g, '<br>');
        win.document.write(`<!DOCTYPE html><html><head><title>Note</title><style>body{font-family:system-ui,sans-serif;max-width:700px;margin:40px auto;line-height:1.6;color:#333}h1,h2,h3{margin-top:1.5em}code{font-family:monospace}</style></head><body>${html}</body></html>`);
        win.document.close();
        win.print();
    };

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
        e.target.value = ''
    }

    // Force-save immediately (flush debounce)
    const handleSave = useCallback(async () => {
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        if (activeNoteId) {
            try {
                await apiClient.notes.update(activeNoteId, { content: documentBody });
                toast('Saved', 'success');
            } catch {
                toast('Save failed', 'error');
            }
        } else if (documentBody.trim() && !creatingNoteRef.current) {
            creatingNoteRef.current = true;
            try {
                const title = documentBody.split('\n')[0].replace(/^#+\s*/, '').slice(0, 60) || 'Untitled';
                const note = await apiClient.notes.create(title, documentBody);
                skipLoadRef.current = true;
                setActiveNoteId(note.id);
                fetchNotes();
                toast('Saved', 'success');
            } catch {
                toast('Save failed', 'error');
            } finally {
                creatingNoteRef.current = false;
            }
        }
    }, [activeNoteId, documentBody, setActiveNoteId, fetchNotes, toast]);

    // Keyboard shortcuts (Ctrl/Cmd + B, I, S, Shift+P for preview)
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const mod = e.metaKey || e.ctrlKey
            if (!mod) return
            switch (e.key.toLowerCase()) {
                case 'b':
                    e.preventDefault()
                    insertFormat('**')
                    break
                case 'i':
                    e.preventDefault()
                    insertFormat('_')
                    break
                case 's':
                    e.preventDefault()
                    handleSave()
                    break
                case 'p':
                    if (e.shiftKey) {
                        e.preventDefault()
                        setShowPreview(p => !p)
                    }
                    break
            }
        }
        document.addEventListener('keydown', handler)
        return () => document.removeEventListener('keydown', handler)
    }, [insertFormat, handleSave])

    // Export as Excel XML (.xlsx)
    const handleExportXlsx = () => {
        const lines = documentBody.split('\n');
        const xmlRows = lines.map(line => {
            const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `<Row><Cell><Data ss:Type="String">${escaped}</Data></Cell></Row>`;
        }).join('\n');
        const xml = `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n<Worksheet ss:Name="Note"><ss:Table>\n${xmlRows}\n</ss:Table></Worksheet>\n</Workbook>`;
        const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const titleSlug = (documentBody.split('\n')[0]?.replace(/^#+\s*/, '').trim() || 'note').slice(0, 40).replace(/[^a-zA-Z0-9]+/g, '-').replace(/-+$/, '');
        a.download = `${titleSlug}.xls`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Send selection or full content to chat
    const handleSendToChat = () => {
        const text = documentBody.trim();
        if (!text) return;
        setPendingChatInput(text);
    };

    // AI generation with streaming
    const handleAiCommand = async (command: string) => {
        if (!activeModel) return
        setIsGenerating(true)

        const prompts: Record<string, string> = {
            continue: `Continue writing the following document naturally. Do NOT repeat any of the existing text. Return ONLY the new continuation text, nothing else:\n\n${documentBody}`,
            summarize: `Provide a brief TL;DR summary of this document. Return only the summary:\n\n${documentBody}`,
            draft: `Write an introduction section for the following document. Return only the introduction:\n\n${documentBody}`,
            toTable: `Restructure the following content as a well-formatted markdown table. Return only the table:\n\n${documentBody}`,
            keyPoints: `Extract the key points from this document as a concise bulleted list. Return only the bullet points:\n\n${documentBody}`,
            expand: `Expand the last paragraph of this document with more detail and depth. Return only the expanded paragraph, do NOT repeat earlier content:\n\n${documentBody}`,
            outline: `Generate a structured outline (with headings and sub-points) from this document. Return only the outline:\n\n${documentBody}`,
        }

        const prompt = prompts[command] || prompts.continue
        const appendCommands = ['continue', 'expand'];
        const shouldAppend = appendCommands.includes(command);

        try {
            const response = await fetch(`${apiClient.API_BASE}/api/engine/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model_id: activeModel.id,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7,
                    max_tokens: 512
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

            // Strip <think>/<talk> reasoning blocks that some models emit
            const cleaned = generated
                .replace(/<(?:think|talk)>[\s\S]*?<\/(?:think|talk)>/g, '')
                .replace(/<\/?(?:think|talk)[^>]*>/g, '')
                .trim()

            if (cleaned) {
                if (shouldAppend) {
                    handleChange(documentBody + '\n\n' + cleaned)
                } else {
                    handleChange(documentBody + '\n\n---\n\n' + cleaned)
                }
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            toast(`AI generation failed: ${msg}`, 'error')
        } finally {
            setIsGenerating(false)
        }
    }

    return (
        <div className="h-full flex flex-col text-white overflow-hidden pb-4">
            <PageHeader>
                <div className="flex items-center gap-2">
                    {/* New Note */}
                    <button
                        type="button"
                        onClick={handleNewNote}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-white/10 hover:bg-white/20 text-white transition-colors border border-white/5 font-medium"
                        title="New note"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        {t('notes.new')}
                    </button>

                    {/* Save */}
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={!documentBody.trim()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Save (Ctrl+S)"
                    >
                        <Save className="w-3.5 h-3.5" />
                        {t('common.save')}
                    </button>

                    <div className="w-px h-5 bg-white/10 mx-1" />

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
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                        title="Import file"
                    >
                        <Upload className="w-3.5 h-3.5" />
                        {t('workspace.files')}
                    </button>

                    {/* Export dropdown */}
                    <div className="relative" ref={exportMenuRef}>
                        <button
                            type="button"
                            onClick={() => setShowExportMenu(p => !p)}
                            disabled={!documentBody.trim()}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Export"
                        >
                            <Download className="w-3.5 h-3.5" />
                            Export
                            <ChevronDown className="w-3 h-3" />
                        </button>
                        {showExportMenu && (
                            <div className="absolute top-full left-0 mt-1 bg-[#1a1a1e] border border-white/10 rounded-lg shadow-xl py-1 z-50 min-w-[140px]">
                                <button type="button" onClick={() => { handleExport('md'); setShowExportMenu(false) }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5 hover:text-white transition-colors">
                                    <Download size={12} /> Markdown (.md)
                                </button>
                                <button type="button" onClick={() => { handleExport('txt'); setShowExportMenu(false) }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5 hover:text-white transition-colors">
                                    <FileText size={12} /> Plain text (.txt)
                                </button>
                                <button type="button" onClick={() => { handleExportXlsx(); setShowExportMenu(false) }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5 hover:text-white transition-colors">
                                    <Sheet size={12} /> Excel (.xls)
                                </button>
                                <button type="button" onClick={() => { handleExportPdf(); setShowExportMenu(false) }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5 hover:text-white transition-colors">
                                    <Printer size={12} /> PDF (print)
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </PageHeader>

            <div className="flex-1 flex flex-col overflow-hidden min-h-0">

                {/* Full-width editor */}
                <div className="flex-1 bg-[#18181B] border border-white/10 rounded-xl overflow-hidden flex flex-col">

                    {/* Status bar */}
                    <div className="h-8 border-b border-white/5 bg-white/[0.02] flex items-center px-4 justify-between shrink-0">
                        <div className="flex items-center gap-3 text-[10px] text-gray-500 font-mono tabular-nums">
                            <span>{documentBody.length} chars</span>
                            <span>{documentBody.trim() ? documentBody.trim().split(/\s+/).length : 0} words</span>
                            <span>{documentBody.split('\n').length} lines</span>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-gray-500 font-mono">
                            {activeModel && (
                                <span className="flex items-center gap-1.5">
                                    <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                    {cleanModelName(activeModel.name)}
                                </span>
                            )}
                            <span className="text-gray-600">Ctrl+B bold · Ctrl+I italic · Ctrl+S save</span>
                        </div>
                    </div>

                    {/* Formatting + AI toolbar */}
                    <div className="border-b border-white/5 bg-white/[0.01] px-3 py-1.5 flex items-center gap-1 overflow-x-auto shrink-0">
                        {/* Markdown formatting */}
                        <ToolbarIcon icon={<Bold size={13} />} title="Bold" onClick={() => insertFormat('**')} />
                        <ToolbarIcon icon={<Italic size={13} />} title="Italic" onClick={() => insertFormat('_')} />
                        <ToolbarIcon icon={<Strikethrough size={13} />} title="Strikethrough" onClick={() => insertFormat('~~')} />
                        <ToolbarIcon icon={<Code size={13} />} title="Inline code" onClick={() => insertFormat('`')} />
                        <div className="w-px h-4 bg-white/[0.06] mx-0.5 shrink-0" />
                        <ToolbarIcon icon={<Heading1 size={13} />} title="Heading 1" onClick={() => insertFormat('# ', '', true)} />
                        <ToolbarIcon icon={<Heading2 size={13} />} title="Heading 2" onClick={() => insertFormat('## ', '', true)} />
                        <ToolbarIcon icon={<Quote size={13} />} title="Blockquote" onClick={() => insertFormat('> ', '', true)} />
                        <ToolbarIcon icon={<List size={13} />} title="Bullet list" onClick={() => insertFormat('- ', '', true)} />
                        <ToolbarIcon icon={<ListOrdered size={13} />} title="Numbered list" onClick={() => insertFormat('1. ', '', true)} />
                        <ToolbarIcon icon={<Minus size={13} />} title="Horizontal rule" onClick={() => insertFormat('\n---\n', '', false)} />
                        <ToolbarIcon icon={<Link size={13} />} title="Link" onClick={() => insertFormat('[', '](url)')} />
                        <div className="w-px h-4 bg-white/[0.06] mx-0.5 shrink-0" />
                        <ToolbarIcon
                            icon={showPreview ? <EyeOff size={13} /> : <Eye size={13} />}
                            title={showPreview ? 'Hide preview' : 'Show preview'}
                            onClick={() => setShowPreview(p => !p)}
                            active={showPreview}
                        />

                        {/* Spacer */}
                        <div className="flex-1" />

                        {/* AI commands */}
                        <div className="flex items-center gap-1 text-[10px] text-gray-500 mr-1 shrink-0">
                            <Sparkles size={11} className="text-gray-600" />
                            <span className="font-medium uppercase tracking-wider">AI</span>
                        </div>
                        <ToolbarBtn icon={<Wand2 size={12} />} label="Continue" onClick={() => handleAiCommand('continue')} disabled={isGenerating || !activeModel} loading={isGenerating} />
                        <ToolbarBtn icon={<Copy size={12} />} label="Summarize" onClick={() => handleAiCommand('summarize')} disabled={isGenerating || !activeModel || !documentBody.trim()} />
                        <ToolbarBtn icon={<FileText size={12} />} label="Draft Intro" onClick={() => handleAiCommand('draft')} disabled={isGenerating || !activeModel} />
                        <div className="w-px h-4 bg-white/[0.06] mx-0.5 shrink-0" />
                        <ToolbarBtn icon={<Table size={12} />} label="To Table" onClick={() => handleAiCommand('toTable')} disabled={isGenerating || !activeModel || !documentBody.trim()} />
                        <ToolbarBtn icon={<List size={12} />} label="Key Points" onClick={() => handleAiCommand('keyPoints')} disabled={isGenerating || !activeModel || !documentBody.trim()} />
                        <ToolbarBtn icon={<Expand size={12} />} label="Expand" onClick={() => handleAiCommand('expand')} disabled={isGenerating || !activeModel || !documentBody.trim()} />
                        <ToolbarBtn icon={<ListTree size={12} />} label="Outline" onClick={() => handleAiCommand('outline')} disabled={isGenerating || !activeModel || !documentBody.trim()} />
                        <div className="w-px h-4 bg-white/[0.06] mx-0.5 shrink-0" />
                        <ToolbarBtn icon={<Send size={12} />} label="Send to Chat" onClick={handleSendToChat} disabled={!documentBody.trim()} />
                    </div>

                    <div
                        ref={splitContainerRef}
                        className={`flex-1 overflow-hidden flex ${showPreview ? 'flex-row' : 'flex-col'}`}
                        onMouseMove={(e) => {
                            if (!isDraggingRef.current || !splitContainerRef.current) return
                            const rect = splitContainerRef.current.getBoundingClientRect()
                            const pct = ((e.clientX - rect.left) / rect.width) * 100
                            setSplitPercent(Math.min(80, Math.max(20, pct)))
                        }}
                        onMouseUp={() => { isDraggingRef.current = false }}
                        onMouseLeave={() => { isDraggingRef.current = false }}
                    >
                        <div
                            className={`${showPreview ? '' : 'flex-1'} overflow-y-auto editor-container`}
                            style={showPreview ? { width: `${splitPercent}%` } : undefined}
                        >
                            <SimpleMdeReact
                                value={documentBody}
                                onChange={handleChange}
                                options={editorOptions}
                                getMdeInstance={getMdeInstance}
                            />
                        </div>
                        {showPreview && (
                            <>
                                <div
                                    className="w-1 shrink-0 cursor-col-resize bg-white/[0.04] hover:bg-blue-500/30 active:bg-blue-500/40 transition-colors relative group"
                                    onMouseDown={(e) => { e.preventDefault(); isDraggingRef.current = true }}
                                >
                                    <div className="absolute inset-y-0 -left-1 -right-1" />
                                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-8 bg-white/20 rounded-full group-hover:bg-blue-400/60 transition-colors" />
                                </div>
                                <div
                                    className="overflow-y-auto p-6 prose prose-invert prose-sm max-w-none select-text"
                                    style={{ width: `${100 - splitPercent}%` }}
                                >
                                    <MarkdownPreview content={documentBody} />
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

function ToolbarBtn({ icon, label, onClick, disabled, loading }: {
    icon: React.ReactNode
    label: string
    onClick: () => void
    disabled: boolean
    loading?: boolean
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className="group/tb flex items-center gap-0 hover:gap-1.5 w-7 hover:w-auto px-0 hover:px-2 py-1 rounded-md text-[11px] text-gray-400 hover:text-white hover:bg-white/[0.06] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0 justify-center hover:justify-start"
            title={label}
        >
            <span className="shrink-0">{loading ? <Loader2 size={12} className="animate-spin" /> : icon}</span>
            <span className="max-w-0 overflow-hidden group-hover/tb:max-w-[120px] transition-all duration-150">{label}</span>
        </button>
    )
}

function ToolbarIcon({ icon, title, onClick, active }: {
    icon: React.ReactNode
    title: string
    onClick: () => void
    active?: boolean
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors shrink-0 ${
                active ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-white hover:bg-white/[0.06]'
            }`}
            title={title}
        >
            {icon}
        </button>
    )
}

function MarkdownPreview({ content }: { content: string }) {
    if (!content.trim()) {
        return <p className="text-gray-600 italic">Nothing to preview yet.</p>
    }
    return (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content}
        </ReactMarkdown>
    )
}
