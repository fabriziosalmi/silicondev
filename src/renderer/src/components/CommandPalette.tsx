import React, { useState, useEffect, useRef } from 'react';
import { Search, Zap, ShieldCheck, Brain, Database, X, Command } from 'lucide-react';
import { useGlobalState } from '../context/GlobalState';

interface CommandItem {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  action: () => void;
  category: string;
}

export function CommandPalette({ isOpen, onClose, onOpenKnowledgeMap }: { 
  isOpen: boolean; 
  onClose: () => void;
  onOpenKnowledgeMap?: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { systemStats, activeModel } = useGlobalState();

  const commands: CommandItem[] = [
    {
      id: 'swarm',
      label: 'Trigger Swarm Consensus',
      description: 'Analyze current problem with 3 expert agents',
      icon: <Brain size={16} className="text-purple-400" />,
      category: 'Agentic Tools',
      action: () => { console.log('Swarm triggered'); onClose(); }
    },
    {
      id: 'sanitizer',
      label: 'Security Audit',
      description: 'Run AST-based shell sanitizer check',
      icon: <ShieldCheck size={16} className="text-emerald-400" />,
      category: 'Security',
      action: () => { console.log('Sanitizer audit'); onClose(); }
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
      description: 'Start autonomous training job on local dataset',
      icon: <Database size={16} className="text-blue-400" />,
      category: 'Phase 5',
      action: () => { console.log('Fine-tuning started'); onClose(); }
    },
    {
      id: 'vram',
      label: 'Purge VRAM/KV Cache',
      description: 'Instant memory cleanup for heavy tasks',
      icon: <Zap size={16} className="text-amber-400" />,
      category: 'Performance',
      action: () => { console.log('VRAM purge'); onClose(); }
    }
  ];

  const filteredCommands = commands.filter(cmd => 
    cmd.label.toLowerCase().includes(search.toLowerCase()) ||
    cmd.category.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    if (isOpen) {
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
    <div className="fixed inset-0 z-[1000] flex items-start justify-center pt-[15vh] px-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-[#1c1c1f]/95 border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Search Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
          <Search size={18} className="text-gray-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agentic tools..."
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-600 outline-none"
          />
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-white/5 bg-white/5 text-[10px] text-gray-500 font-mono">
            <Command size={10} />
            <span>K</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/5 rounded-md text-gray-500 transition-colors">
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
