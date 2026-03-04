import { Suspense, lazy, useRef, useCallback, type ComponentProps } from 'react'
import { Loader2 } from 'lucide-react'
import type MonacoEditorType from '@monaco-editor/react'

type EditorProps = ComponentProps<typeof MonacoEditorType>

const Editor = lazy(() => import('@monaco-editor/react'))

interface MonacoEditorProps {
  filePath: string
  content: string
  language: string
  onSave: (path: string, content: string) => Promise<void>
  onChange: (content: string) => void
}

function EditorFallback() {
  return (
    <div className="flex items-center justify-center h-full bg-[#1e1e1e]">
      <div className="flex items-center gap-2 text-gray-500 text-sm">
        <Loader2 size={16} className="animate-spin" />
        Loading editor...
      </div>
    </div>
  )
}

export function MonacoEditor({ filePath, content, language, onSave, onChange }: MonacoEditorProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null)
  // Refs to avoid stale closures in Monaco's addCommand callback
  const filePathRef = useRef(filePath)
  const onSaveRef = useRef(onSave)
  filePathRef.current = filePath
  onSaveRef.current = onSave

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleEditorDidMount = useCallback((editor: any) => {
    editorRef.current = editor

    // Cmd+S to save — uses refs to avoid stale closure
    editor.addCommand(
      // Monaco.KeyMod.CtrlCmd | Monaco.KeyCode.KeyS
      2048 | 49, // CtrlCmd = 2048, KeyS = 49
      () => {
        const currentContent = editor.getValue()
        onSaveRef.current(filePathRef.current, currentContent)
      }
    )
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
    theme: 'vs-dark',
    onMount: handleEditorDidMount,
    onChange: handleChange,
    options: {
      fontSize: 13,
      fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', monospace",
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
