import { useState, useEffect } from 'react'
import { DataPreparation } from './components/DataPreparation'
import { ChatInterface } from './components/ChatInterface'
import { EngineInterface } from './components/EngineInterface'


import { ModelsInterface } from './components/ModelsInterface'
import { Evaluations } from './components/Evaluations'
import { RagKnowledge } from './components/RagKnowledge'
import { MCPServers } from './components/MCPServers'
import { PipelinesJobs } from './components/PipelinesJobs'
import { Deployment } from './components/Deployment'
import { Workspace } from './components/Workspace'
import { Settings } from './components/Settings'
import { Documentation } from './components/Documentation'
import { ModelExport } from './components/ModelExport'
import { AgentTerminal } from './components/Terminal/AgentTerminal'
import { TopBar } from './components/TopBar'
import { ConversationListPanel } from './components/ConversationListPanel'
import { NoteListPanel } from './components/NoteListPanel'
import { useGlobalState } from './context/GlobalState'
import { useConversations } from './context/ConversationContext'
import { useNotes } from './context/NotesContext'
// apiClient imported in GlobalState — App uses backendReady from context
import { CodeWorkspace } from './components/CodeWorkspace/CodeWorkspace'
import { Database, Cpu, MessageSquare, BarChart2, TestTube, Brain, Rocket, FileText, ChevronsLeft, ChevronsRight, Plus, ChevronDown, ChevronRight, Settings as SettingsIcon, Package, TerminalSquare, Code, BookOpen, Search, Server, Workflow } from 'lucide-react'

function App() {
  const [activeTab, setActiveTab] = useState('chat')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true')
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [chatSearchOpen, setChatSearchOpen] = useState(false)
  const [notesExpanded, setNotesExpanded] = useState(false)
  const { backendReady, pendingChatInput } = useGlobalState()
  const conversations = useConversations()
  const notes = useNotes()
  const [loadingMessage, setLoadingMessage] = useState('Initializing backend...')
  const [updateReady, setUpdateReady] = useState(false)
  const [updateVersion, setUpdateVersion] = useState('')

  useEffect(() => {
    const cleanup = window.electronAPI?.onUpdateDownloaded?.((version: string) => {
      setUpdateReady(true);
      setUpdateVersion(version);
    });
    return () => { cleanup?.(); };
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

  // Listen for tab switch events from child components
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail
      if (tab && typeof tab === 'string') setActiveTab(tab)
    }
    window.addEventListener('switch-tab', handler)
    return () => window.removeEventListener('switch-tab', handler)
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only handle Cmd (Mac) shortcuts, ignore when typing in inputs
      if (!e.metaKey) return;
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable;

      switch (e.key) {
        case 'k': // Cmd+K — quick switch: jump to chat
          if (!isInput) {
            e.preventDefault();
            setActiveTab('chat');
          }
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
        case 'e': // Cmd+E — code workspace
          if (!isInput) {
            e.preventDefault();
            setActiveTab('code');
          }
          break;
        case ',': // Cmd+, — settings (macOS convention)
          if (!isInput) {
            e.preventDefault();
            setActiveTab('settings');
          }
          break;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [conversations, toggleSidebar]);

  // Update loading message after a few seconds if backend isn't ready yet
  useEffect(() => {
    if (backendReady) return;
    const timer = setTimeout(() => setLoadingMessage('Starting MLX engine...'), 3000);
    return () => clearTimeout(timer);
  }, [backendReady]);



  // Show loading screen while backend starts
  if (!backendReady) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#0a0a0f] relative overflow-hidden">
        {/* Subtle radial glow behind icon */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[60%] w-[500px] h-[500px] rounded-full bg-indigo-500/[0.04] blur-[100px] pointer-events-none" />

        <div className="flex flex-col items-center gap-6 relative z-10">
          {/* Animated chip icon */}
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" className="w-40 h-40 drop-shadow-[0_0_40px_rgba(99,102,241,0.2)]">
            <defs>
              <linearGradient id="s-bg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#1a1a2e"/>
                <stop offset="100%" stopColor="#0f0f1a"/>
              </linearGradient>
              <linearGradient id="s-chip" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#3b82f6"/>
                <stop offset="100%" stopColor="#6366f1"/>
              </linearGradient>
              <linearGradient id="s-trace" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#60a5fa"/>
                <stop offset="100%" stopColor="#818cf8"/>
              </linearGradient>
              <linearGradient id="s-dot" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#93c5fd"/>
                <stop offset="100%" stopColor="#a5b4fc"/>
              </linearGradient>
              <radialGradient id="s-glow" cx="512" cy="512" r="200" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="0.15"/>
                <stop offset="100%" stopColor="#6366f1" stopOpacity="0"/>
              </radialGradient>
            </defs>
            {/* Background */}
            <rect width="1024" height="1024" rx="220" fill="url(#s-bg)"/>
            {/* Inner glow */}
            <circle cx="512" cy="512" r="200" fill="url(#s-glow)">
              <animate attributeName="r" values="180;220;180" dur="3s" repeatCount="indefinite"/>
            </circle>
            {/* Chip body */}
            <rect x="302" y="302" width="420" height="420" rx="48" fill="url(#s-chip)" opacity="0.12" stroke="url(#s-chip)" strokeWidth="5"/>
            {/* Pins — top/bottom/left/right */}
            {[390,460,530,600].map(x => <rect key={`t${x}`} x={x} y="222" width="16" height="96" rx="8" fill="url(#s-trace)" opacity="0.6"/>)}
            {[390,460,530,600].map(x => <rect key={`b${x}`} x={x} y="706" width="16" height="96" rx="8" fill="url(#s-trace)" opacity="0.6"/>)}
            {[390,460,530,600].map(y => <rect key={`l${y}`} x="222" y={y} width="96" height="16" rx="8" fill="url(#s-trace)" opacity="0.6"/>)}
            {[390,460,530,600].map(y => <rect key={`r${y}`} x="706" y={y} width="96" height="16" rx="8" fill="url(#s-trace)" opacity="0.6"/>)}
            {/* Grid traces */}
            <line x1="380" y1="440" x2="644" y2="440" stroke="url(#s-trace)" strokeWidth="3" opacity="0.3"/>
            <line x1="380" y1="512" x2="644" y2="512" stroke="url(#s-trace)" strokeWidth="3" opacity="0.3"/>
            <line x1="380" y1="584" x2="644" y2="584" stroke="url(#s-trace)" strokeWidth="3" opacity="0.3"/>
            <line x1="440" y1="380" x2="440" y2="644" stroke="url(#s-trace)" strokeWidth="3" opacity="0.3"/>
            <line x1="512" y1="380" x2="512" y2="644" stroke="url(#s-trace)" strokeWidth="3" opacity="0.3"/>
            <line x1="584" y1="380" x2="584" y2="644" stroke="url(#s-trace)" strokeWidth="3" opacity="0.3"/>
            {/* Diagonal traces */}
            <line x1="440" y1="440" x2="512" y2="512" stroke="url(#s-trace)" strokeWidth="2" opacity="0.2"/>
            <line x1="584" y1="440" x2="512" y2="512" stroke="url(#s-trace)" strokeWidth="2" opacity="0.2"/>
            <line x1="440" y1="584" x2="512" y2="512" stroke="url(#s-trace)" strokeWidth="2" opacity="0.2"/>
            <line x1="584" y1="584" x2="512" y2="512" stroke="url(#s-trace)" strokeWidth="2" opacity="0.2"/>
            {/* Animated dots — wave pulse from center outward */}
            {[
              { cx: 512, cy: 512, r: 14, delay: '0s' },
              { cx: 440, cy: 512, r: 8, delay: '0.2s' },
              { cx: 584, cy: 512, r: 8, delay: '0.2s' },
              { cx: 512, cy: 440, r: 8, delay: '0.2s' },
              { cx: 512, cy: 584, r: 8, delay: '0.2s' },
              { cx: 440, cy: 440, r: 10, delay: '0.4s' },
              { cx: 584, cy: 440, r: 10, delay: '0.4s' },
              { cx: 440, cy: 584, r: 10, delay: '0.4s' },
              { cx: 584, cy: 584, r: 10, delay: '0.4s' },
              { cx: 380, cy: 512, r: 7, delay: '0.6s' },
              { cx: 644, cy: 512, r: 7, delay: '0.6s' },
              { cx: 380, cy: 440, r: 5, delay: '0.8s' },
              { cx: 644, cy: 440, r: 5, delay: '0.8s' },
              { cx: 380, cy: 584, r: 5, delay: '0.8s' },
              { cx: 644, cy: 584, r: 5, delay: '0.8s' },
            ].map((d, i) => (
              <circle key={i} cx={d.cx} cy={d.cy} r={d.r} fill="url(#s-dot)">
                <animate attributeName="opacity" values="0.15;1;0.15" dur="2s" begin={d.delay} repeatCount="indefinite"/>
              </circle>
            ))}
            {/* Center bright core */}
            <circle cx="512" cy="512" r="6" fill="white">
              <animate attributeName="opacity" values="0.4;1;0.4" dur="1.5s" repeatCount="indefinite"/>
              <animate attributeName="r" values="5;7;5" dur="1.5s" repeatCount="indefinite"/>
            </circle>
          </svg>

          <div className="text-center">
            <h1 className="text-[26px] font-bold text-white tracking-tight mb-1">SiliconDev</h1>
            <p className="text-[11px] text-gray-600 font-mono mb-5">v{__APP_VERSION__}</p>

            {/* Loading indicator */}
            <p className="text-[12px] text-gray-500 mb-3">{loadingMessage}</p>
            <div className="w-48 h-[2px] rounded-full bg-white/5 overflow-hidden">
              <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-indigo-400/60 to-transparent animate-shimmer" />
            </div>
          </div>
        </div>

        {/* Footer credits — pinned to bottom */}
        <div className="absolute bottom-6 left-0 right-0 text-center">
          <p className="text-[10px] font-semibold text-gray-700/50">Made with ❤️ by Fabrizio Salmi</p>
          <p className="text-[10px] font-semibold text-gray-700/50 mt-0.5">MIT License</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-transparent">

      {/* Modern Top Status Bar */}
      <header className="glass-header z-50">
        <TopBar />
      </header>

      {updateReady && (
        <div className="flex items-center justify-between px-4 py-2 bg-blue-600/20 border-b border-blue-500/30 text-sm text-blue-300">
          <span>Version {updateVersion} is ready to install.</span>
          <button
            onClick={() => window.electronAPI?.installUpdate?.()}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded transition-colors"
          >
            Restart &amp; Update
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden rounded-bl-lg rounded-br-lg border-t premium-border bg-[rgba(20,20,20,0.7)]">

        {/* Sidebar */}
        <div className={`${sidebarCollapsed ? 'w-14' : 'w-64'} glass-sidebar flex flex-col pt-6 border-r premium-border relative z-20 rounded-bl-lg transition-all duration-200 overflow-hidden`}>

          <nav className={`flex-1 flex flex-col min-h-0 overflow-y-auto space-y-6 ${sidebarCollapsed ? 'px-1.5' : 'px-4'} transition-all duration-200`}>

            <div>
              {!sidebarCollapsed && <div className="px-3 mb-2 text-[10px] font-bold tracking-wide text-gray-500 uppercase">Local Server</div>}
              <div className="space-y-1">
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
                          onClick={(e) => { e.stopPropagation(); setChatSearchOpen(!chatSearchOpen); if (!chatSearchOpen && !historyExpanded) { setHistoryExpanded(true); conversations.fetchConversations(); } }}
                          className={`p-1 rounded transition-colors ${chatSearchOpen ? 'text-blue-400 bg-blue-500/10' : 'text-gray-500 hover:text-white hover:bg-white/10'}`}
                          title="Search conversations"
                        >
                          <Search size={14} />
                        </button>
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
                        searchOpen={chatSearchOpen}
                        onCloseSearch={() => { setChatSearchOpen(false); conversations.handleSearch(''); }}
                      />
                    </div>
                  )}
                </div>
                <SidebarItem
                  label="Models"
                  active={activeTab === 'models'}
                  onClick={() => setActiveTab('models')}
                  icon={<Database size={18} />}
                  collapsed={sidebarCollapsed}
                />
                <SidebarItem
                  label="Terminal"
                  active={activeTab === 'terminal'}
                  onClick={() => setActiveTab('terminal')}
                  icon={<TerminalSquare size={18} />}
                  collapsed={sidebarCollapsed}
                />
                <SidebarItem
                  label="Code"
                  active={activeTab === 'code'}
                  onClick={() => setActiveTab('code')}
                  icon={<Code size={18} />}
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
                  label="MCP Servers"
                  active={activeTab === 'mcp'}
                  onClick={() => setActiveTab('mcp')}
                  icon={<Server size={18} />}
                  collapsed={sidebarCollapsed}
                />
                <SidebarItem
                  label="Pipelines & Jobs"
                  active={activeTab === 'pipelines'}
                  onClick={() => setActiveTab('pipelines')}
                  icon={<Workflow size={18} />}
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

          {/* Docs & Settings — bottom of sidebar */}
          <div className={`${sidebarCollapsed ? 'px-1.5' : 'px-4'} mb-2`}>
            <div className="border-t border-white/5 pt-2 space-y-1">
              <SidebarItem
                label="Documentation"
                active={activeTab === 'docs'}
                onClick={() => setActiveTab('docs')}
                icon={<BookOpen size={18} />}
                collapsed={sidebarCollapsed}
              />
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

        {/* Code workspace: full-bleed, no padding — stays mounted */}
        <div className={`flex-1 overflow-hidden no-drag relative ${activeTab === 'code' ? '' : 'hidden'}`}>
          <CodeWorkspace />
        </div>

        {/* Standard tabs with scroll container */}
        <div className={`flex-1 overflow-y-auto no-drag relative ${activeTab === 'terminal' || activeTab === 'code' ? 'hidden' : ''}`}>
          <div className="w-full h-full p-4 md:p-8 overflow-x-hidden">
            {/* Keep-alive: tabs with expensive in-memory state stay mounted but hidden */}
            <div className={activeTab === 'chat' ? '' : 'hidden'}><ChatInterface /></div>
            <div className={activeTab === 'engine' ? '' : 'hidden'}><EngineInterface /></div>
            {/* Mount-on-demand: lightweight tabs that refetch on mount */}
            {activeTab === 'studio' && <DataPreparation />}
            {activeTab === 'models' && <ModelsInterface />}
            {activeTab === 'evaluations' && <Evaluations />}
            {activeTab === 'rag' && <RagKnowledge />}
            {activeTab === 'mcp' && <MCPServers />}
            {activeTab === 'pipelines' && <PipelinesJobs />}
            {activeTab === 'deployment' && <Deployment />}
            {activeTab === 'workspace' && <Workspace />}
            {activeTab === 'export' && <ModelExport />}
            {activeTab === 'docs' && <Documentation />}
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
