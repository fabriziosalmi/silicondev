import { Suspense, lazy, useState, useRef, useCallback, useEffect, type ComponentProps } from 'react'
import { Loader2 } from 'lucide-react'
import type MonacoEditorType from '@monaco-editor/react'

type EditorProps = ComponentProps<typeof MonacoEditorType>

const Editor = lazy(() => import('@monaco-editor/react'))

import { useHolographicDiff } from './useHolographicDiff'
import { apiClient } from '../../api/client'
import { useTheme } from '../../context/ThemeContext'

interface MonacoEditorProps {
  filePath: string
  content: string
  language: string
  onSave: (path: string, content: string) => Promise<void>
  onChange: (content: string) => void
  originalContent?: string | null
  activeModelId?: string | null
  debugLine?: number | null
}

import './debugger.css'

// Monaco attaches itself to `window` at runtime; no TS type is available for this global
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMonaco(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as Record<string, any>).monaco
}

function EditorFallback() {
  return (
    <div className="flex items-center justify-center h-full bg-elevated">
      <div className="flex items-center gap-2 text-foreground-muted text-sm">
        <Loader2 size={16} className="animate-spin" />
        Loading editor...
      </div>
    </div>
  )
}

export function MonacoEditor({ filePath, content, language, onSave, onChange, originalContent, activeModelId, debugLine }: MonacoEditorProps) {
  const { resolvedTheme } = useTheme()
  const monacoTheme = resolvedTheme === 'dark' ? 'vs-dark' : 'vs'
  // Monaco editor instance -- stored in both ref (for callbacks) and state (for hooks that need re-render on mount)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editorInstance, setEditorInstance] = useState<any>(null)

  useHolographicDiff(editorInstance, originalContent || null, content)
  // Refs to avoid stale closures in Monaco's addCommand callback
  const filePathRef = useRef(filePath)
  const onSaveRef = useRef(onSave)
  const activeModelIdRef = useRef(activeModelId)
  useEffect(() => {
    filePathRef.current = filePath
    onSaveRef.current = onSave
    activeModelIdRef.current = activeModelId
  }, [filePath, onSave, activeModelId])

  const debugDecorationsRef = useRef<string[]>([])
  useEffect(() => {
    if (!editorRef.current || !debugLine) {
      if (editorRef.current && debugDecorationsRef.current.length > 0) {
        editorRef.current.deltaDecorations(debugDecorationsRef.current, [])
        debugDecorationsRef.current = []
      }
      return
    }

    const monaco = getMonaco()
    if (!monaco) return

    const newDecorations = [
      {
        range: new monaco.Range(debugLine, 1, debugLine, 1),
        options: {
          isWholeLine: true,
          className: 'debug-line-highlight',
          glyphMarginClassName: 'debug-line-glyph',
          description: 'debug-current-line'
        }
      }
    ]

    debugDecorationsRef.current = editorRef.current.deltaDecorations(debugDecorationsRef.current, newDecorations)
    editorRef.current.revealLineInCenterIfOutsideViewport(debugLine)
  }, [debugLine])

  // Ghost Text (Inline Completions)
  useEffect(() => {
    const monaco = getMonaco()
    if (!monaco) return

    const provider = monaco.languages.registerInlineCompletionsProvider(language, {
      provideInlineCompletions: async (model: { getValueInRange: (range: unknown) => string }, position: { lineNumber: number; column: number }) => {
        if (!activeModelIdRef.current || originalContent) return { items: [] }

        // Get context before cursor (max 1000 chars for speed)
        const textUntilPosition = model.getValueInRange({
          startLineNumber: Math.max(1, position.lineNumber - 20),
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        })

        try {
          const res = await apiClient.engine.predict(activeModelIdRef.current, textUntilPosition, 30)
          if (res.completion) {
            return {
              items: [
                {
                  insertText: res.completion,
                  range: new monaco.Range(
                    position.lineNumber,
                    position.column,
                    position.lineNumber,
                    position.column
                  )
                }
              ]
            }
          }
        } catch (err) {
          console.debug('Ghost text prediction failed:', err)
        }
        return { items: [] }
      },
      freeInlineCompletions: () => { }
    })

    return () => provider.dispose()
  }, [language, originalContent])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleEditorDidMount = useCallback((editor: any) => {
    editorRef.current = editor
    setEditorInstance(editor)

    // Cmd+S to save — uses refs to avoid stale closure
    editor.addCommand(
      // Monaco.KeyMod.CtrlCmd | Monaco.KeyCode.KeyS
      2048 | 49, // CtrlCmd = 2048, KeyS = 49
      () => {
        const currentContent = editor.getValue()
        onSaveRef.current(filePathRef.current, currentContent)
      }
    )

    // Cmd+K to trigger inline edit
    editor.addCommand(
      2048 | 39, // CtrlCmd = 2048, KeyK = 39
      () => {
        const selection = editor.getSelection()
        if (!selection || selection.isEmpty()) return

        const coords = editor.getScrolledVisiblePosition(selection.getStartPosition())
        const domNode = editor.getDomNode()
        const rect = domNode?.getBoundingClientRect()

        const event = new CustomEvent('nanocore-inline-edit', {
          detail: {
            selection: {
              startLine: selection.startLineNumber,
              startColumn: selection.startColumn,
              endLine: selection.endLineNumber,
              endColumn: selection.endColumn,
              text: editor.getModel()?.getValueInRange(selection) || ''
            },
            position: {
              x: (rect?.left || 0) + (coords?.left || 0),
              y: (rect?.top || 0) + (coords?.top || 0) + 20
            }
          }
        })
        window.dispatchEvent(event)
      }
    )

    // Context menu actions for selected code → agent
    const actions = [
      { id: 'nano.explain', label: '🧠 Explain This', prompt: 'explain this code:' },
      { id: 'nano.fix', label: '🧠 Fix This', prompt: 'fix this code:' },
      { id: 'nano.refactor', label: '🧠 Refactor', prompt: 'refactor this code:' },
      { id: 'nano.tests', label: '🧠 Write Tests', prompt: 'write tests for this code:' },
      { id: 'nano.optimize', label: '🧠 Optimize', prompt: 'optimize this code:' },
    ]

    for (const action of actions) {
      editor.addAction({
        id: action.id,
        label: action.label,
        contextMenuGroupId: '9_nanocore',
        contextMenuOrder: actions.indexOf(action) + 1,
        precondition: 'editorHasSelection',
        keybindings: [],
        run: (ed: { getModel: () => { getValueInRange: (range: unknown) => string } | null; getSelection: () => unknown }) => {
          const selection = ed.getModel()?.getValueInRange(ed.getSelection())
          if (!selection) return
          const fullPrompt = `${action.prompt}\n\`\`\`\n${selection}\n\`\`\``
          window.dispatchEvent(new CustomEvent('nanocore-prompt', { detail: fullPrompt }))
        },
      })
    }

    // no-op: separator not needed, actions are grouped under 9_nanocore
  }, [])

  // Listen for "Apply" from code block snippets in agent output
  useEffect(() => {
    const handler = (e: Event) => {
      const code = (e as CustomEvent).detail as string
      const editor = editorRef.current
      if (!editor || !code) return
      const selection = editor.getSelection()
      if (selection && !selection.isEmpty()) {
        // Replace selection
        editor.executeEdits('nanocore-apply', [{
          range: selection,
          text: code,
        }])
      } else {
        // Insert at cursor
        const pos = editor.getPosition()
        if (pos) {
          editor.executeEdits('nanocore-apply', [{
            range: { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column },
            text: code,
          }])
        }
      }
      editor.focus()
    }
    window.addEventListener('nanocore-apply-snippet', handler)
    return () => window.removeEventListener('nanocore-apply-snippet', handler)
  }, [])

  const handleChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      onChange(value)
    }
  }, [onChange])

  const editorProps: EditorProps = {
    height: '100%',
    language,
    value: content,
    theme: monacoTheme,
    onMount: handleEditorDidMount,
    onChange: handleChange,
    options: {
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      padding: { top: 8 },
      lineNumbers: 'on',
      renderLineHighlight: 'line',
      bracketPairColorization: { enabled: true },
      wordWrap: 'off',
      tabSize: 2,
      automaticLayout: true,
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
    },
  }

  return (
    <Suspense fallback={<EditorFallback />}>
      <Editor {...editorProps} />
    </Suspense>
  )
}
