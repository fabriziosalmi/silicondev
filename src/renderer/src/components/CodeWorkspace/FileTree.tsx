import { useState, useEffect, useRef, memo, useCallback, useMemo } from 'react'
import { FolderOpen, FolderClosed, FileCode, FileText, ChevronRight, ChevronDown, MoreHorizontal, Pencil, Trash2, Copy, Pin } from 'lucide-react'

export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: TreeNode[]
}

interface FileTreeProps {
  tree: TreeNode | null
  onFileSelect: (path: string) => void
  onRename: (path: string, newName: string) => void
  onDelete: (path: string) => void
  activeFile: string | null
  pinnedItems?: { id: string; type: 'file' | 'text'; name: string; content: string }[]
  onTogglePin?: (item: { id: string; type: 'file' | 'text'; name: string; content: string }) => void
  scoutIssues?: { file: string; type: 'error' | 'warning'; message: string }[]
}

const FILE_ICON_MAP: Record<string, string> = {
  '.py': 'text-yellow-400',
  '.ts': 'text-blue-400',
  '.tsx': 'text-blue-400',
  '.js': 'text-yellow-300',
  '.jsx': 'text-yellow-300',
  '.json': 'text-green-400',
  '.md': 'text-gray-400',
  '.css': 'text-pink-400',
  '.html': 'text-orange-400',
  '.yaml': 'text-purple-400',
  '.yml': 'text-purple-400',
  '.toml': 'text-gray-400',
  '.sh': 'text-green-300',
}

function getFileColor(name: string): string {
  const ext = name.substring(name.lastIndexOf('.'))
  return FILE_ICON_MAP[ext] || 'text-gray-500'
}

function isCodeFile(name: string): boolean {
  const codeExts = ['.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.rb', '.php', '.swift', '.sh']
  const ext = name.substring(name.lastIndexOf('.'))
  return codeExts.includes(ext)
}

function ContextMenu({ x, y, onRename, onDelete, onCopyPath, onClose }: {
  x: number; y: number
  onRename: () => void; onDelete: () => void; onCopyPath: () => void; onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[140px] py-1 bg-[#1e1e1e] border border-white/10 rounded-md shadow-xl"
      style={{ left: x, top: y }}
    >
      <button
        type="button"
        onClick={() => { onRename(); onClose() }}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-gray-300 hover:bg-white/10 transition-colors text-left"
      >
        <Pencil size={12} /> Rename
      </button>
      <button
        type="button"
        onClick={() => { onCopyPath(); onClose() }}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-gray-300 hover:bg-white/10 transition-colors text-left"
      >
        <Copy size={12} /> Copy Path
      </button>
      <div className="my-1 border-t border-white/5" />
      <button
        type="button"
        onClick={() => { onDelete(); onClose() }}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-red-400 hover:bg-red-500/10 transition-colors text-left"
      >
        <Trash2 size={12} /> Delete
      </button>
    </div>
  )
}

const TreeItem = memo(function TreeItem({
  node,
  depth,
  onFileSelect,
  onRename,
  onDelete,
  activeFile,
  pinnedItems,
  onTogglePin,
  scoutIssues,
}: {
  node: TreeNode
  depth: number
  onFileSelect: (path: string) => void
  onRename: (path: string, newName: string) => void
  onDelete: (path: string) => void
  activeFile: string | null
  pinnedItems?: { id: string; type: 'file' | 'text'; name: string; content: string }[]
  onTogglePin?: (item: { id: string; type: 'file' | 'text'; name: string; content: string }) => void
  scoutIssues?: { file: string; type: 'error' | 'warning'; message: string }[]
}) {
  const [expanded, setExpanded] = useState(depth < 1)
  const [renaming, setRenaming] = useState(false)
  const [renameName, setRenameName] = useState(node.name)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const handleClick = useCallback(() => {
    if (renaming) return
    if (node.type === 'dir') {
      setExpanded(prev => !prev)
    } else {
      onFileSelect(node.path)
    }
  }, [node.type, node.path, onFileSelect, renaming])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const handleDotsClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setContextMenu({ x: rect.right, y: rect.bottom })
  }, [])

  const startRename = useCallback(() => {
    setRenameName(node.name)
    setRenaming(true)
    setTimeout(() => {
      const input = renameInputRef.current
      if (input) {
        input.focus()
        // Select name without extension for files
        const dotIdx = node.name.lastIndexOf('.')
        if (node.type === 'file' && dotIdx > 0) {
          input.setSelectionRange(0, dotIdx)
        } else {
          input.select()
        }
      }
    }, 50)
  }, [node.name, node.type])

  const commitRename = useCallback(() => {
    const trimmed = renameName.trim()
    if (trimmed && trimmed !== node.name) {
      onRename(node.path, trimmed)
    }
    setRenaming(false)
  }, [renameName, node.name, node.path, onRename])

  const handleDelete = useCallback(() => {
    const what = node.type === 'dir' ? `folder "${node.name}" and all its contents` : `"${node.name}"`
    if (confirm(`Delete ${what}?`)) {
      onDelete(node.path)
    }
  }, [node.name, node.path, node.type, onDelete])

  const handleCopyPath = useCallback(() => {
    navigator.clipboard.writeText(node.path).catch(() => { })
  }, [node.path])

  const handleTogglePin = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!onTogglePin) return
    try {
      const { content } = await (window as any).apiClient.workspace.readFile(node.path)
      onTogglePin({
        id: node.path,
        type: 'file',
        name: node.name,
        content
      })
    } catch (err) {
      console.error('Failed to pin file:', err)
    }
  }, [node.path, node.name, onTogglePin])

  const isPinned = pinnedItems?.some(it => it.id === node.path)
  const isActive = node.type === 'file' && node.path === activeFile
  const paddingLeft = 8 + depth * 16

  // Scout Alert Logic
  const hasScoutIssue = useMemo(() => {
    if (!scoutIssues) return false
    return scoutIssues.some(issue => node.path.endsWith(issue.file))
  }, [scoutIssues, node.path])

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick() }}
        className={`group flex items-center gap-1.5 py-[3px] pr-1 cursor-pointer text-xs transition-colors hover:bg-white/5 ${isActive ? 'bg-blue-500/15 text-blue-300' : 'text-gray-400'
          } ${hasScoutIssue ? 'animate-pulse bg-orange-500/10' : ''}`}
        style={{ paddingLeft }}
      >
        {node.type === 'dir' ? (
          <>
            <span className="text-gray-600 w-3.5 flex justify-center shrink-0">
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
            {expanded ? (
              <FolderOpen size={14} className="text-blue-400/70 shrink-0" />
            ) : (
              <FolderClosed size={14} className="text-blue-400/50 shrink-0" />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5 shrink-0" />
            {isCodeFile(node.name) ? (
              <FileCode size={14} className={`${getFileColor(node.name)} shrink-0`} />
            ) : (
              <FileText size={14} className={`${getFileColor(node.name)} shrink-0`} />
            )}
          </>
        )}
        {renaming ? (
          <input
            ref={renameInputRef}
            type="text"
            value={renameName}
            onChange={e => setRenameName(e.target.value)}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') setRenaming(false)
            }}
            onBlur={commitRename}
            title="Rename"
            placeholder="New name"
            className="flex-1 min-w-0 px-1 py-0 bg-black/40 border border-blue-500/40 rounded text-[11px] text-gray-200 outline-none"
          />
        ) : (
          <>
            <span className={`truncate flex-1 min-w-0 ${hasScoutIssue ? 'text-orange-400 font-medium' : ''}`}>{node.name}</span>
            {hasScoutIssue && (
              <div className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0 shadow-[0_0_8px_rgba(249,115,22,0.6)]" title="Scout detected issues" />
            )}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              {node.type === 'file' && (
                <button
                  type="button"
                  title={isPinned ? 'Remove from context' : 'Add to context'}
                  onClick={handleTogglePin}
                  className={`p-0.5 rounded hover:bg-white/10 transition-colors ${isPinned ? 'text-blue-400' : 'text-gray-600 hover:text-gray-300'
                    }`}
                >
                  <Pin size={12} className={isPinned ? 'fill-blue-400' : ''} />
                </button>
              )}
              <button
                type="button"
                title="Actions"
                onClick={handleDotsClick}
                className="p-0.5 rounded hover:bg-white/10 text-gray-600 hover:text-gray-300 transition-all shrink-0"
              >
                <MoreHorizontal size={12} />
              </button>
            </div>
          </>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onRename={startRename}
          onDelete={handleDelete}
          onCopyPath={handleCopyPath}
          onClose={() => setContextMenu(null)}
        />
      )}

      {node.type === 'dir' && expanded && node.children?.map(child => (
        <TreeItem
          key={child.path}
          node={child}
          depth={depth + 1}
          onFileSelect={onFileSelect}
          onRename={onRename}
          onDelete={onDelete}
          activeFile={activeFile}
          pinnedItems={pinnedItems}
          onTogglePin={onTogglePin}
          scoutIssues={scoutIssues}
        />
      ))}
    </>
  )
})

export function FileTree({ tree, onFileSelect, onRename, onDelete, activeFile, pinnedItems, onTogglePin, scoutIssues }: FileTreeProps) {
  if (!tree) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-gray-600">
        No workspace loaded
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden py-1 select-none">
      {tree.children?.map(child => (
        <TreeItem
          key={child.path}
          node={child}
          depth={0}
          onFileSelect={onFileSelect}
          onRename={onRename}
          onDelete={onDelete}
          activeFile={activeFile}
          pinnedItems={pinnedItems}
          onTogglePin={onTogglePin}
          scoutIssues={scoutIssues}
        />
      ))}
    </div>
  )
}
