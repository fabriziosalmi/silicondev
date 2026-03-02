import { useState, useEffect } from 'react'
import { DataPreparation } from './components/DataPreparation'
import { ChatInterface } from './components/ChatInterface'
import { EngineInterface } from './components/EngineInterface'


import { ModelsInterface } from './components/ModelsInterface'
import { Evaluations } from './components/Evaluations'
import { RagKnowledge } from './components/RagKnowledge'
import { AgentWorkflows } from './components/AgentWorkflows'
import { Deployment } from './components/Deployment'
import { Workspace } from './components/Workspace'
import { Settings } from './components/Settings'
import { ModelExport } from './components/ModelExport'
import { AgentTerminal } from './components/Terminal/AgentTerminal'
import { TopBar } from './components/TopBar'
import { ConversationListPanel } from './components/ConversationListPanel'
import { NoteListPanel } from './components/NoteListPanel'
import { useGlobalState } from './context/GlobalState'
import { useConversations } from './context/ConversationContext'
import { useNotes } from './context/NotesContext'
import { apiClient } from './api/client'
import { Database, Cpu, MessageSquare, BarChart2, TestTube, Brain, Zap, Rocket, FileText, ChevronsLeft, ChevronsRight, Plus, ChevronDown, ChevronRight, Settings as SettingsIcon, Package, TerminalSquare } from 'lucide-react'

function App() {
  const [activeTab, setActiveTab] = useState('models')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true')
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [notesExpanded, setNotesExpanded] = useState(false)
  const { backendReady, setBackendReady, pendingChatInput } = useGlobalState()
  const conversations = useConversations()
  const notes = useNotes()
  const [loadingMessage, setLoadingMessage] = useState('Initializing backend...')
  const [updateReady, setUpdateReady] = useState(false)
  const [updateVersion, setUpdateVersion] = useState('')

  useEffect(() => {
    const api = (window as any).electronAPI;
    api?.onUpdateDownloaded?.((version: string) => {
      setUpdateReady(true);
      setUpdateVersion(version);
    });
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebarCollapsed', String(next));
      return next;
    });
  }


  // Switch to chat when a note sends content
  useEffect(() => {
    if (pendingChatInput) setActiveTab('chat');
  }, [pendingChatInput]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only handle Cmd (Mac) shortcuts, ignore when typing in inputs
      if (!e.metaKey) return;
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable;

      switch (e.key) {
        case 'k': // Cmd+K — quick switch: jump to chat
          e.preventDefault();
          setActiveTab('chat');
          break;
        case 'n': // Cmd+N — new conversation
          if (!isInput) {
            e.preventDefault();
            conversations.setActiveConversationId(null);
            setActiveTab('chat');
          }
          break;
        case 'b': // Cmd+B — toggle sidebar
          if (!isInput) {
            e.preventDefault();
            toggleSidebar();
          }
          break;
        case ',': // Cmd+, — settings (macOS convention)
          e.preventDefault();
          setActiveTab('settings');
          break;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [conversations, toggleSidebar]);

  // Poll backend health until ready
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    const checkBackend = async () => {
      try {
        const ok = await apiClient.checkHealth();
        if (ok && !cancelled) {
          setBackendReady(true);
          return;
        }
      } catch {
        // Network error
      }
      // Backend not ready yet — retry
      if (!cancelled) {
        attempts++;
        if (attempts > 5) {
          setLoadingMessage('Starting MLX engine...');
        }
        setTimeout(checkBackend, 500);
      }
    };

    checkBackend();

    return () => { cancelled = true; };
  }, []);



  // Show loading screen while backend starts
  if (!backendReady) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-[rgba(15,15,15,0.95)]">
        <div className="flex flex-col items-center gap-6">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white mb-2">
              SiliconDev
            </h1>
            <p className="text-sm text-gray-400">{loadingMessage}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-transparent">

      {/* Modern Top Status Bar */}
      <TopBar />

      {updateReady && (
        <div className="flex items-center justify-between px-4 py-2 bg-blue-600/20 border-b border-blue-500/30 text-sm text-blue-300">
          <span>Version {updateVersion} is ready to install.</span>
          <button
            onClick={() => (window as any).electronAPI?.installUpdate?.()}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded transition-colors"
          >
            Restart &amp; Update
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden rounded-bl-lg rounded-br-lg border-t border-white/10 bg-[rgba(20,20,20,0.7)]">

        {/* Sidebar */}
        <div className={`${sidebarCollapsed ? 'w-14' : 'w-64'} bg-black/40 flex flex-col pt-6 border-r border-white/5 relative z-20 rounded-bl-lg transition-all duration-200 overflow-hidden`}>

          <nav className={`flex-1 flex flex-col min-h-0 overflow-y-auto space-y-6 ${sidebarCollapsed ? 'px-1.5' : 'px-4'} transition-all duration-200`}>

            <div>
              {!sidebarCollapsed && <div className="px-3 mb-2 text-[10px] font-bold tracking-wide text-gray-500 uppercase">Local Server</div>}
              <div className="space-y-1">
                <SidebarItem
                  label="Models"
                  active={activeTab === 'models'}
                  onClick={() => setActiveTab('models')}
                  icon={<Database size={18} />}
                  collapsed={sidebarCollapsed}
                />
                <div>
                    <SidebarItem
                      label="Chat"
                      active={activeTab === 'chat'}
                      onClick={() => { setActiveTab('chat'); if (!historyExpanded) { setHistoryExpanded(true); conversations.fetchConversations(); } }}
                      icon={<MessageSquare size={18} />}
                      collapsed={sidebarCollapsed}
                      suffix={activeTab === 'chat' ? (
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); conversations.setActiveConversationId(null); }}
                            className="p-1 text-gray-500 hover:text-white hover:bg-white/10 rounded transition-colors"
                            title="New conversation"
                          >
                            <Plus size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setHistoryExpanded(!historyExpanded); if (!historyExpanded) conversations.fetchConversations(); }}
                            className="p-1 text-gray-500 hover:text-white hover:bg-white/10 rounded transition-colors"
                            title={historyExpanded ? 'Hide history' : 'Show history'}
                          >
                            {historyExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        </div>
                      ) : undefined}
                    />
                  {/* Conversation history list — collapsible under Chat */}
                  {!sidebarCollapsed && activeTab === 'chat' && historyExpanded && (
                    <div className="ml-2 mt-1 border-l border-white/5 pl-2">
                      <ConversationListPanel
                        conversations={conversations.conversationList}
                        activeId={conversations.activeConversationId}
                        searchQuery={conversations.searchQuery}
                        onSearch={conversations.handleSearch}
                        onSelect={(id) => conversations.setActiveConversationId(id)}
                        onDelete={conversations.handleDeleteConversation}
                        onRename={conversations.handleRenameConversation}
                        onTogglePin={conversations.handleTogglePin}
                        renamingId={conversations.renamingId}
                        renameValue={conversations.renameValue}
                        onStartRename={conversations.startRename}
                        onCancelRename={conversations.cancelRename}
                        onRenameValueChange={conversations.setRenameValue}
                        loading={conversations.listLoading}
                      />
                    </div>
                  )}
                </div>
                <SidebarItem
                  label="Terminal"
                  active={activeTab === 'terminal'}
                  onClick={() => setActiveTab('terminal')}
                  icon={<TerminalSquare size={18} />}
                  collapsed={sidebarCollapsed}
                />
                <div>
                    <SidebarItem
                      label="Notes"
                      active={activeTab === 'workspace'}
                      onClick={() => { setActiveTab('workspace'); if (!notesExpanded) { setNotesExpanded(true); notes.fetchNotes(); } }}
                      icon={<FileText size={18} />}
                      collapsed={sidebarCollapsed}
                      suffix={activeTab === 'workspace' ? (
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); notes.setActiveNoteId(null); }}
                            className="p-1 text-gray-500 hover:text-white hover:bg-white/10 rounded transition-colors"
                            title="New note"
                          >
                            <Plus size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setNotesExpanded(!notesExpanded); if (!notesExpanded) notes.fetchNotes(); }}
                            className="p-1 text-gray-500 hover:text-white hover:bg-white/10 rounded transition-colors"
                            title={notesExpanded ? 'Hide notes' : 'Show notes'}
                          >
                            {notesExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        </div>
                      ) : undefined}
                    />
                  {!sidebarCollapsed && activeTab === 'workspace' && notesExpanded && (
                    <div className="ml-2 mt-1 border-l border-white/5 pl-2">
                      <NoteListPanel
                        notes={notes.notesList}
                        activeId={notes.activeNoteId}
                        onSelect={(id) => notes.setActiveNoteId(id)}
                        onDelete={notes.handleDeleteNote}
                        onRename={notes.handleRenameNote}
                        onTogglePin={notes.handleTogglePin}
                        renamingId={notes.renamingId}
                        renameValue={notes.renameValue}
                        onStartRename={notes.startRename}
                        onCancelRename={notes.cancelRename}
                        onRenameValueChange={notes.setRenameValue}
                        loading={notes.listLoading}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div>
              {!sidebarCollapsed && <div className="px-3 mb-2 text-[10px] font-bold tracking-wide text-gray-500 uppercase">Advanced Tools</div>}
              <div className="space-y-1">
                <SidebarItem
                  label="Data Preparation"
                  active={activeTab === 'studio'}
                  onClick={() => setActiveTab('studio')}
                  icon={<BarChart2 size={18} />}
                  collapsed={sidebarCollapsed}
                />
                <SidebarItem
                  label="Fine-Tuning Engine"
                  active={activeTab === 'engine'}
                  onClick={() => setActiveTab('engine')}
                  icon={<Cpu size={18} />}
                  collapsed={sidebarCollapsed}
                />
                <SidebarItem
                  label="Model Export"
                  active={activeTab === 'export'}
                  onClick={() => setActiveTab('export')}
                  icon={<Package size={18} />}
                  collapsed={sidebarCollapsed}
                />
                <SidebarItem
                  label="Model Evaluations"
                  active={activeTab === 'evaluations'}
                  onClick={() => setActiveTab('evaluations')}
                  icon={<TestTube size={18} />}
                  collapsed={sidebarCollapsed}
                />
                <SidebarItem
                  label="RAG Knowledge"
                  active={activeTab === 'rag'}
                  onClick={() => setActiveTab('rag')}
                  icon={<Brain size={18} />}
                  collapsed={sidebarCollapsed}
                />
                <SidebarItem
                  label="Agent Workflows"
                  active={activeTab === 'agents'}
                  onClick={() => setActiveTab('agents')}
                  icon={<Zap size={18} />}
                  collapsed={sidebarCollapsed}
                />
                <SidebarItem
                  label="Deployment"
                  active={activeTab === 'deployment'}
                  onClick={() => setActiveTab('deployment')}
                  icon={<Rocket size={18} />}
                  collapsed={sidebarCollapsed}
                />
              </div>
            </div>

          </nav>

          {/* Settings — bottom of sidebar */}
          <div className={`${sidebarCollapsed ? 'px-1.5' : 'px-4'} mb-2`}>
            <div className="border-t border-white/5 pt-2">
              <SidebarItem
                label="Settings"
                active={activeTab === 'settings'}
                onClick={() => setActiveTab('settings')}
                icon={<SettingsIcon size={18} />}
                collapsed={sidebarCollapsed}
              />
            </div>
          </div>

          {/* Collapse toggle */}
          <button
            onClick={toggleSidebar}
            className={`mx-auto mb-4 p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors shrink-0 ${sidebarCollapsed ? '' : 'ml-auto mr-4'}`}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button>
        </div>

        {/* Terminal: full-bleed, no padding — stays mounted once visited */}
        <div className={`flex-1 overflow-hidden no-drag relative ${activeTab === 'terminal' ? '' : 'hidden'}`}>
          <AgentTerminal />
        </div>

        {/* Standard tabs with scroll container */}
        <div className={`flex-1 overflow-y-auto no-drag relative ${activeTab === 'terminal' ? 'hidden' : ''}`}>
          <div className="w-full h-full p-4 md:p-8 overflow-x-hidden">
            {/* Keep-alive: tabs with expensive in-memory state stay mounted but hidden */}
            <div className={activeTab === 'chat' ? '' : 'hidden'}><ChatInterface /></div>
            <div className={activeTab === 'engine' ? '' : 'hidden'}><EngineInterface /></div>
            {/* Mount-on-demand: lightweight tabs that refetch on mount */}
            {activeTab === 'studio' && <DataPreparation />}
            {activeTab === 'models' && <ModelsInterface />}
            {activeTab === 'evaluations' && <Evaluations />}
            {activeTab === 'rag' && <RagKnowledge />}
            {activeTab === 'agents' && <AgentWorkflows />}
            {activeTab === 'deployment' && <Deployment />}
            {activeTab === 'workspace' && <Workspace />}
            {activeTab === 'export' && <ModelExport />}
            {activeTab === 'settings' && <Settings />}
          </div>
        </div>

      </div>
    </div>
  )
}

function SidebarItem({ label, active, onClick, icon, collapsed, suffix }: { label: string, active: boolean, onClick: () => void, icon: React.ReactNode, collapsed?: boolean, suffix?: React.ReactNode }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      title={collapsed ? label : undefined}
      className={`w-full flex items-center ${collapsed ? 'justify-center px-0 py-2 rounded-lg' : 'px-3 py-2 rounded-r-md'} text-[13px] font-medium transition-all duration-150 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500/50 ${active
        ? `bg-[#1e1e1e] text-gray-100 ${collapsed ? '' : 'border-l-[3px] border-blue-500'}`
        : `text-gray-400 hover:bg-white/5 hover:text-white ${collapsed ? '' : 'border-l-[3px] border-transparent'}`
        }`}
    >
      <span className={`flex items-center justify-center w-5 h-5 shrink-0 ${active ? 'text-blue-400' : 'opacity-70'}`}>{icon}</span>
      {!collapsed && <span className="flex-1 tracking-wide whitespace-nowrap ml-3">{label}</span>}
      {!collapsed && suffix}
    </div>
  )
}

export default App
