import { useState, useEffect } from 'react'
import { DataPreparation } from './components/DataPreparation'
import { MemoryTetrisMini } from './components/MemoryTetrisMini'
import { ChatInterface } from './components/ChatInterface'
import { EngineInterface } from './components/EngineInterface'


import { ModelsInterface } from './components/ModelsInterface'
import { Evaluations } from './components/Evaluations'
import { RagKnowledge } from './components/RagKnowledge'
import { AgentWorkflows } from './components/AgentWorkflows'
import { Deployment } from './components/Deployment'
import { Workspace } from './components/Workspace'
import { TopBar } from './components/TopBar'
import { useGlobalState } from './context/GlobalState'
import { apiClient } from './api/client'
import { Database, Cpu, MessageSquare, BarChart2, TestTube, Brain, Zap, Rocket, FileText } from 'lucide-react'

function App() {
  const [activeTab, setActiveTab] = useState('models')
  const { backendReady, setBackendReady } = useGlobalState()
  const [loadingMessage, setLoadingMessage] = useState('Initializing backend...')

  const displayedTab = activeTab

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
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent mb-2">
              Silicon Studio
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

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden rounded-bl-lg rounded-br-lg border-t border-white/10 bg-[rgba(20,20,20,0.7)] backdrop-blur-3xl shadow-[inset_0_2px_20px_rgba(255,255,255,0.02)]">

        {/* Sidebar */}
        <div className="w-64 bg-black/40 backdrop-blur-md flex flex-col p-4 pt-6 border-r border-white/5 relative z-20 shadow-[10px_0_30px_rgba(0,0,0,0.5)] rounded-bl-lg">

          <nav className="space-y-6">

            <div>
              <div className="px-3 mb-2 text-[10px] font-bold tracking-wider text-gray-500 uppercase">Local Server</div>
              <div className="space-y-1">
                <SidebarItem
                  label="Models"
                  active={activeTab === 'models'}
                  onClick={() => setActiveTab('models')}
                  icon={<Database size={18} />}
                />
                <SidebarItem
                  label="Chat"
                  active={activeTab === 'chat'}
                  onClick={() => setActiveTab('chat')}
                  icon={<MessageSquare size={18} />}
                />
                <SidebarItem
                  label="AI Notepad"
                  active={activeTab === 'workspace'}
                  onClick={() => setActiveTab('workspace')}
                  icon={<FileText size={18} />}
                />
              </div>
            </div>

            <div>
              <div className="px-3 mb-2 text-[10px] font-bold tracking-wider text-gray-500 uppercase">Advanced Tools</div>
              <div className="space-y-1">
                <SidebarItem
                  label="Data Preparation"
                  active={activeTab === 'studio'}
                  onClick={() => setActiveTab('studio')}
                  icon={<BarChart2 size={18} />}
                />
                <SidebarItem
                  label="Fine-Tuning Engine"
                  active={activeTab === 'engine'}
                  onClick={() => setActiveTab('engine')}
                  icon={<Cpu size={18} />}
                />
                <SidebarItem
                  label="Model Evaluations"
                  active={activeTab === 'evaluations'}
                  onClick={() => setActiveTab('evaluations')}
                  icon={<TestTube size={18} />}
                />
                <SidebarItem
                  label="RAG Knowledge"
                  active={activeTab === 'rag'}
                  onClick={() => setActiveTab('rag')}
                  icon={<Brain size={18} />}
                />
                <SidebarItem
                  label="Agent Workflows"
                  active={activeTab === 'agents'}
                  onClick={() => setActiveTab('agents')}
                  icon={<Zap size={18} />}
                />
                <SidebarItem
                  label="Deployment Hub"
                  active={activeTab === 'deployment'}
                  onClick={() => setActiveTab('deployment')}
                  icon={<Rocket size={18} />}
                />
              </div>
            </div>

          </nav>

          <div className="flex-1" />

          <MemoryTetrisMini />
        </div>

        <div className="flex-1 overflow-y-auto no-drag relative">

          <div className="w-full h-full max-w-7xl mx-auto p-4 md:p-8 overflow-x-hidden">
            {displayedTab === 'studio' && <DataPreparation />}
            {displayedTab === 'models' && <ModelsInterface />}
            {displayedTab === 'engine' && <EngineInterface />}
            {displayedTab === 'evaluations' && <Evaluations />}
            {displayedTab === 'rag' && <RagKnowledge />}
            {displayedTab === 'agents' && <AgentWorkflows />}
            {displayedTab === 'deployment' && <Deployment />}
            {displayedTab === 'chat' && <ChatInterface />}
            {displayedTab === 'workspace' && <Workspace />}
          </div>
        </div>

      </div>
    </div>
  )
}

function SidebarItem({ label, active, onClick, icon }: { label: string, active: boolean, onClick: () => void, icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-300 group ${active
        ? 'bg-gradient-to-r from-blue-600/20 to-indigo-600/10 text-white border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.15)] ring-1 ring-inset ring-white/5'
        : 'text-gray-400 hover:bg-white/10 hover:text-white border border-transparent hover:shadow-lg'
        }`}
    >
      <span className={`flex items-center justify-center w-5 h-5 transition-all duration-300 ${active ? 'opacity-100 text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.6)]' : 'opacity-70 group-hover:opacity-100 group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]'}`}>{icon}</span>
      <span className="tracking-wide">{label}</span>
    </button>
  )
}

export default App
