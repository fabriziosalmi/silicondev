import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react'
import { X, Circle, Save, FolderSearch, Settings as SettingsIcon, FilePlus, PanelRightOpen, PanelRightClose } from 'lucide-react'
import { FileTree } from './FileTree'
import { MonacoEditor } from './MonacoEditor'
import { DiffEditor } from './DiffEditor'
import { AgentPanel } from './AgentPanel'
import { apiClient } from '../../api/client'
import type { TreeNode } from './FileTree'
import type { DiffMetadata } from '../Terminal/types'

interface OpenFile {
  path: string
  name: string
  content: string
  language: string
  dirty: boolean
  savedContent: string
}

export function CodeWorkspace() {
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [workspaceDir, setWorkspaceDir] = useState<string | null>(() =>
    localStorage.getItem('silicon-studio-workspace-dir')
  )
  const [loading, setLoading] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [creatingFile, setCreatingFile] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const newFileInputRef = useRef<HTMLInputElement>(null)
  const [agentPanelOpen, setAgentPanelOpen] = useState(true)
  const [pendingDiffs, setPendingDiffs] = useState<Map<string, DiffMetadata>>(new Map())

  // --- Resizable panels ---
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('code-sidebar-width')
    return saved ? Number(saved) : 192
  })
  const [agentWidth, setAgentWidth] = useState(() => {
    const saved = localStorage.getItem('code-agent-width')
    return saved ? Number(saved) : 384
  })
  const containerRef = useRef<HTMLDivElement>(null)

  // Persist widths
  useLayoutEffect(() => {
    localStorage.setItem('code-sidebar-width', String(sidebarWidth))
  }, [sidebarWidth])
  useLayoutEffect(() => {
    localStorage.setItem('code-agent-width', String(agentWidth))
  }, [agentWidth])

  const startDrag = useCallback((
    setter: React.Dispatch<React.SetStateAction<number>>,
    direction: 'left' | 'right',
    min: number,
    max: number,
    startX: number,
    startW: number,
  ) => {
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - startX
      const newW = direction === 'left'
        ? Math.min(max, Math.max(min, startW + dx))
        : Math.min(max, Math.max(min, startW - dx))
      setter(newW)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  const handleSidebarDrag = useCallback((e: React.MouseEvent) => {
    startDrag(setSidebarWidth, 'left', 120, 400, e.clientX, sidebarWidth)
  }, [sidebarWidth, startDrag])

  const handleAgentDrag = useCallback((e: React.MouseEvent) => {
    startDrag(setAgentWidth, 'right', 280, 700, e.clientX, agentWidth)
  }, [agentWidth, startDrag])

  // Provide active file context to the agent panel (called at submit time via ref)
  const openFilesRef = useRef(openFiles)
  openFilesRef.current = openFiles
  const activeFileRef = useRef(activeFile)
  activeFileRef.current = activeFile
  const getActiveFile = useCallback(() => {
    const path = activeFileRef.current
    if (!path) return null
    const f = openFilesRef.current.find(of => of.path === path)
    if (!f) return null
    return { path: f.path, content: f.content, language: f.language }
  }, [])

  // Listen for workspace directory changes from Settings
  useEffect(() => {
    const handler = (e: Event) => {
      const dir = (e as CustomEvent).detail
      setWorkspaceDir(dir)
    }
    window.addEventListener('workspace-dir-changed', handler)
    return () => window.removeEventListener('workspace-dir-changed', handler)
  }, [])

  // Load file tree when workspace dir changes
  useEffect(() => {
    if (!workspaceDir) {
      setTree(null)
      return
    }
    setLoading(true)
    apiClient.workspace.tree(workspaceDir)
      .then(setTree)
      .catch((err) => { console.error('Failed to load file tree:', err); setTree(null) })
      .finally(() => setLoading(false))
  }, [workspaceDir])

  const handleFileSelect = useCallback(async (path: string) => {
    // Check if already open
    const existing = openFiles.find(f => f.path === path)
    if (existing) {
      setActiveFile(path)
      return
    }

    try {
      const { content, language } = await apiClient.workspace.readFile(path)
      const name = path.split('/').pop() || path
      setOpenFiles(prev => [...prev, { path, name, content, language, dirty: false, savedContent: content }])
      setActiveFile(path)
    } catch (err) {
      console.error('Failed to read file:', path, err)
      setSaveStatus('Failed to open file')
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => setSaveStatus(null), 3000)
    }
  }, [openFiles])

  // Called by AgentPanel when a diff proposal arrives — open the target file
  const handleAgentOpenFile = useCallback((path: string) => {
    handleFileSelect(path)
  }, [handleFileSelect])

  // Called by AgentPanel when a diff proposal arrives — show in DiffEditor
  const handleDiffProposal = useCallback((filePath: string, meta: DiffMetadata) => {
    setPendingDiffs(prev => {
      const next = new Map(prev)
      next.set(filePath, meta)
      return next
    })
  }, [])

  const handleCloseFile = useCallback((path: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setOpenFiles(prev => {
      const remaining = prev.filter(f => f.path !== path)
      // Update active file using fresh filtered list (avoids stale closure)
      if (activeFile === path) {
        setActiveFile(remaining.length > 0 ? remaining[remaining.length - 1].path : null)
      }
      return remaining
    })
    // Clear any pending diff for this file
    setPendingDiffs(prev => {
      const next = new Map(prev)
      next.delete(path)
      return next
    })
  }, [activeFile])

  const handleSave = useCallback(async (path: string, content: string) => {
    try {
      await apiClient.workspace.saveFile(path, content)
      setOpenFiles(prev => prev.map(f =>
        f.path === path ? { ...f, dirty: false, savedContent: content, content } : f
      ))
      setSaveStatus('Saved')
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => setSaveStatus(null), 2000)
    } catch {
      setSaveStatus('Save failed')
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => setSaveStatus(null), 3000)
    }
  }, [])

  const handleContentChange = useCallback((path: string, content: string) => {
    setOpenFiles(prev => prev.map(f =>
      f.path === path ? { ...f, content, dirty: content !== f.savedContent } : f
    ))
  }, [])

  const handleCreateFile = useCallback(async () => {
    const name = newFileName.trim()
    if (!name || !workspaceDir) return
    setCreatingFile(false)
    setNewFileName('')
    const fullPath = `${workspaceDir}/${name}`
    try {
      await apiClient.workspace.createFile(fullPath)
      const newTree = await apiClient.workspace.tree(workspaceDir)
      setTree(newTree)
      try {
        const { content, language } = await apiClient.workspace.readFile(fullPath)
        const shortName = name.split('/').pop() || name
        setOpenFiles(prev => [...prev, { path: fullPath, name: shortName, content, language, dirty: false, savedContent: content }])
        setActiveFile(fullPath)
      } catch (err) {
        console.error('Failed to open newly created file:', err)
        setActiveFile(null)
      }
    } catch (err) {
      setSaveStatus(err instanceof Error ? err.message : 'Create failed')
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => setSaveStatus(null), 3000)
    }
  }, [newFileName, workspaceDir])

  const refreshTree = useCallback(async () => {
    if (!workspaceDir) return
    try {
      const newTree = await apiClient.workspace.tree(workspaceDir)
      setTree(newTree)
    } catch (err) { console.error('Failed to refresh file tree:', err) }
  }, [workspaceDir])

  const handleRenameFile = useCallback(async (filePath: string, newName: string) => {
    try {
      const result = await apiClient.workspace.renameFile(filePath, newName)
      setOpenFiles(prev => prev.map(f => {
        if (f.path === filePath) {
          return { ...f, path: result.new_path, name: newName }
        }
        return f
      }))
      if (activeFile === filePath) setActiveFile(result.new_path)
      await refreshTree()
    } catch (err) {
      setSaveStatus(err instanceof Error ? err.message : 'Rename failed')
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => setSaveStatus(null), 3000)
    }
  }, [activeFile, refreshTree])

  const handleDeleteFile = useCallback(async (filePath: string) => {
    try {
      await apiClient.workspace.deleteFile(filePath)
      setOpenFiles(prev => {
        const remaining = prev.filter(f => f.path !== filePath)
        // Update active file using fresh filtered list (avoids stale closure)
        if (activeFile === filePath) {
          setActiveFile(remaining.length > 0 ? remaining[remaining.length - 1].path : null)
        }
        return remaining
      })
      await refreshTree()
    } catch (err) {
      setSaveStatus(err instanceof Error ? err.message : 'Delete failed')
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => setSaveStatus(null), 3000)
    }
  }, [activeFile, refreshTree])

  // Diff approval: apply the new content to the file
  const handleDiffApprove = useCallback((filePath: string) => {
    const diff = pendingDiffs.get(filePath)
    if (!diff) return
    // Update editor content with the new content
    setOpenFiles(prev => prev.map(f =>
      f.path === filePath ? { ...f, content: diff.newContent, dirty: true } : f
    ))
    // Remove the pending diff
    setPendingDiffs(prev => {
      const next = new Map(prev)
      next.delete(filePath)
      return next
    })
    // Auto-save
    handleSave(filePath, diff.newContent)
  }, [pendingDiffs, handleSave])

  // Diff rejection: just remove the pending diff
  const handleDiffReject = useCallback((filePath: string) => {
    setPendingDiffs(prev => {
      const next = new Map(prev)
      next.delete(filePath)
      return next
    })
  }, [])

  // Sync: when agent panel's HolographicDiff approve/reject fires, mirror it here
  const handleDiffSynced = useCallback((filePath: string, approved: boolean) => {
    if (approved) {
      handleDiffApprove(filePath)
    } else {
      handleDiffReject(filePath)
    }
  }, [handleDiffApprove, handleDiffReject])

  const active = openFiles.find(f => f.path === activeFile)
  const activeDiff = activeFile ? pendingDiffs.get(activeFile) : undefined

  // Empty state: no workspace configured
  if (!workspaceDir) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-3 max-w-sm">
          <FolderSearch size={40} className="mx-auto text-gray-600" />
          <h3 className="text-sm font-medium text-gray-400">No workspace configured</h3>
          <p className="text-xs text-gray-600">
            Go to Settings and select a project directory under "Codebase Index" to enable the code workspace.
          </p>
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('switch-tab', { detail: 'settings' }))
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 rounded text-xs text-blue-400 transition-colors"
          >
            <SettingsIcon size={12} />
            Open Settings
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex items-center border-b border-white/5 bg-black/20 overflow-x-auto shrink-0">
        {openFiles.map(f => (
          <div
            key={f.path}
            role="button"
            tabIndex={0}
            onClick={() => setActiveFile(f.path)}
            onKeyDown={(e) => { if (e.key === 'Enter') setActiveFile(f.path) }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-white/5 cursor-pointer shrink-0 transition-colors ${
              f.path === activeFile
                ? 'bg-[#1e1e1e] text-white'
                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
            }`}
          >
            {f.dirty && <Circle size={6} className="text-blue-400 fill-blue-400" />}
            {pendingDiffs.has(f.path) && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
            <span className="truncate max-w-[120px]">{f.name}</span>
            <span
              role="button"
              tabIndex={0}
              title="Close"
              onClick={(e) => handleCloseFile(f.path, e)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); handleCloseFile(f.path) } }}
              className="ml-1 p-0.5 rounded hover:bg-white/10 text-gray-600 hover:text-white transition-colors"
            >
              <X size={10} />
            </span>
          </div>
        ))}
        {saveStatus && (
          <div className="ml-auto px-3 py-1.5 text-[10px] text-gray-500 flex items-center gap-1 shrink-0">
            <Save size={10} />
            {saveStatus}
          </div>
        )}
        {/* Agent panel toggle */}
        <button
          type="button"
          onClick={() => setAgentPanelOpen(!agentPanelOpen)}
          className="ml-auto p-1.5 text-gray-600 hover:text-white hover:bg-white/5 transition-colors shrink-0"
          title={agentPanelOpen ? 'Hide agent' : 'Show agent'}
        >
          {agentPanelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
        </button>
      </div>

      {/* Main content: three-column layout */}
      <div ref={containerRef} className="flex-1 flex overflow-hidden">
        {/* File tree sidebar */}
        <div style={{ width: sidebarWidth }} className="border-r border-white/5 bg-black/20 shrink-0 overflow-hidden flex flex-col">
          <div className="px-2 py-1.5 flex items-center justify-between border-b border-white/5">
            <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wide truncate">
              {tree?.name || 'Explorer'}
            </span>
            <button
              type="button"
              title="New File"
              onClick={() => { setCreatingFile(true); setTimeout(() => newFileInputRef.current?.focus(), 50) }}
              className="p-0.5 rounded hover:bg-white/10 text-gray-600 hover:text-gray-300 transition-colors"
            >
              <FilePlus size={13} />
            </button>
          </div>
          {creatingFile && (
            <div className="px-2 py-1 border-b border-white/5 bg-black/30">
              <input
                ref={newFileInputRef}
                type="text"
                value={newFileName}
                onChange={e => setNewFileName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreateFile()
                  if (e.key === 'Escape') { setCreatingFile(false); setNewFileName('') }
                }}
                onBlur={() => { if (!newFileName.trim()) { setCreatingFile(false); setNewFileName('') } }}
                placeholder="filename.py (or path/to/file.py)"
                className="w-full px-1.5 py-1 bg-black/40 border border-white/10 rounded text-[11px] text-gray-300 placeholder-gray-600 outline-none focus:border-blue-500/40"
              />
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-8 text-gray-600 text-xs">
              Loading...
            </div>
          ) : tree && (!tree.children || tree.children.length === 0) ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-center px-3">
              <p className="text-[11px] text-gray-600">Empty directory</p>
              <button
                type="button"
                onClick={() => { setCreatingFile(true); setTimeout(() => newFileInputRef.current?.focus(), 50) }}
                className="inline-flex items-center gap-1 px-2 py-1 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 rounded text-[11px] text-blue-400 transition-colors"
              >
                <FilePlus size={12} />
                New File
              </button>
            </div>
          ) : (
            <FileTree tree={tree} onFileSelect={handleFileSelect} onRename={handleRenameFile} onDelete={handleDeleteFile} activeFile={activeFile} />
          )}
        </div>

        {/* Sidebar resize handle */}
        <div
          role="separator"
          onMouseDown={handleSidebarDrag}
          className="w-1 shrink-0 cursor-col-resize hover:bg-blue-500/30 active:bg-blue-500/50 transition-colors"
        />

        {/* Editor area */}
        <div className="flex-1 min-w-0">
          {active ? (
            activeDiff ? (
              <DiffEditor
                key={`diff-${active.path}`}
                filePath={active.path}
                originalContent={activeDiff.oldContent}
                modifiedContent={activeDiff.newContent}
                language={active.language}
                onApprove={() => handleDiffApprove(active.path)}
                onReject={() => handleDiffReject(active.path)}
              />
            ) : (
              <MonacoEditor
                key={active.path}
                filePath={active.path}
                content={active.content}
                language={active.language}
                onSave={handleSave}
                onChange={(content) => handleContentChange(active.path, content)}
              />
            )
          ) : (
            <div className="h-full flex items-center justify-center bg-[#1e1e1e]">
              <p className="text-sm text-gray-600">Select a file to open</p>
            </div>
          )}
        </div>

        {/* Agent panel resize handle + panel */}
        {agentPanelOpen && (
          <>
          <div
            role="separator"
            onMouseDown={handleAgentDrag}
            className="w-1 shrink-0 cursor-col-resize hover:bg-blue-500/30 active:bg-blue-500/50 transition-colors"
          />
          <div style={{ width: agentWidth }} className="border-l border-white/5 shrink-0 overflow-hidden">
            <AgentPanel onOpenFile={handleAgentOpenFile} onDiffProposal={handleDiffProposal} onDiffSynced={handleDiffSynced} getActiveFile={getActiveFile} />
          </div>
          </>
        )}
      </div>
    </div>
  )
}
