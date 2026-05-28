import React, { useState, useEffect, useRef } from 'react';
import { Search, Zap, Brain, Database, X, Command } from 'lucide-react';
import { useGlobalState } from '../context/GlobalState';
import { apiClient } from '../api/client';

interface CommandItem {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  action: () => void;
  category: string;
}

export function CommandPalette({ isOpen, onClose, onOpenKnowledgeMap, onNavigateTo }: {
  isOpen: boolean;
  onClose: () => void;
  onOpenKnowledgeMap?: () => void;
  onNavigateTo?: (tab: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { systemStats, activeModel } = useGlobalState();

  const commands: CommandItem[] = [
    {
      id: 'code',
      label: 'Open Code Workspace',
      description: 'Edit files with agent assistance. Toggle MoA / sandbox / air-gapped in the agent panel.',
      icon: <Brain size={16} className="text-purple-400" />,
      category: 'Agentic Tools',
      action: () => { onNavigateTo?.('code'); onClose(); }
    },
    {
      id: 'knowledge',
      label: 'Open Knowledge Map',
      description: 'Visualize global semantic memory (Alt+Shift+K)',
      icon: <Brain size={16} className="text-pink-400" />,
      category: 'Memory',
      action: () => { onOpenKnowledgeMap?.(); onClose(); }
    },
    {
      id: 'training',
      label: 'Local Fine-Tuning (MLX)',
      description: 'Open Fine-Tuning tab to start a training job',
      icon: <Database size={16} className="text-blue-400" />,
      category: 'Training',
      action: () => { onNavigateTo?.('engine'); onClose(); }
    },
    {
      id: 'vram',
      label: 'Purge VRAM/KV Cache',
      description: 'Unload active model and free memory',
      icon: <Zap size={16} className="text-amber-400" />,
      category: 'Performance',
      action: async () => {
        try { await apiClient.engine.unloadModel(); } catch { /* ignore if no model loaded */ }
        onClose();
      }
    }
  ];

  const filteredCommands = commands.filter(cmd => 
    cmd.label.toLowerCase().includes(search.toLowerCase()) ||
    cmd.category.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset form state and selection when palette opens
      setSearch('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % filteredCommands.length);
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + filteredCommands.length) % filteredCommands.length);
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          filteredCommands[selectedIndex].action();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredCommands, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center pt-[15vh] px-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-overlay/95 border border-outline rounded-2xl shadow-2xl shadow-black/60 overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Search Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-outline-subtle">
          <Search size={18} className="text-foreground-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agentic tools..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground-subtle outline-none"
          />
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-outline-subtle bg-hover text-[10px] text-foreground-muted font-mono">
            <Command size={10} />
            <span>K</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-hover rounded-md text-foreground-muted transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Categories & Results */}
        <div ref={scrollRef} className="max-h-[400px] overflow-y-auto p-2">
          {filteredCommands.length === 0 ? (
            <div className="py-12 text-center text-gray-500 text-sm">
              No tools found for "{search}"
            </div>
          ) : (
            <div className="space-y-4">
              {filteredCommands.map((cmd, i) => (
                <button
                  key={cmd.id}
                  onClick={cmd.action}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left ${
                    i === selectedIndex ? 'bg-blue-500/10 border border-blue-500/20' : 'bg-transparent border border-transparent'
                  }`}
                >
                  <div className={`p-2 rounded-lg ${i === selectedIndex ? 'bg-blue-500/20' : 'bg-white/5'}`}>
                    {cmd.icon}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className={`text-[13px] font-semibold ${i === selectedIndex ? 'text-white' : 'text-gray-300'}`}>
                        {cmd.label}
                      </span>
                      <span className="text-[10px] text-gray-600 uppercase font-bold tracking-wider">
                        {cmd.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5 truncate">
                      {cmd.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer Stats */}
        <div className="p-3 bg-black/20 border-t border-white/5 flex items-center justify-between text-[10px] text-gray-600 font-mono">
          <div className="flex items-center gap-4">
            <span>RAM: {systemStats ? `${(systemStats.memory.percent).toFixed(1)}%` : '--'}</span>
            <span>VRAM: {activeModel ? 'In Use' : 'Ready'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="animate-pulse">●</span>
            <span>SiliconDev Engine Operational</span>
          </div>
        </div>
      </div>
    </div>
  );
}
