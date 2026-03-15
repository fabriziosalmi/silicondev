import React, { useEffect, useState, useRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Zap, Brain } from 'lucide-react';
import { apiClient } from '../api/client';

interface KnowledgeMapProps {
  isOpen: boolean;
  onClose: () => void;
}

const KnowledgeMap: React.FC<KnowledgeMapProps> = ({ isOpen, onClose }) => {
  const [data, setData] = useState<{ nodes: any[], links: any[] }>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const fgRef = useRef<any>(null);

  useEffect(() => {
    if (isOpen) {
      fetchGraphData();
    }
  }, [isOpen]);

  const fetchGraphData = async () => {
    setLoading(true);
    try {
      const nodesRes = await apiClient.apiFetch(`${apiClient.API_BASE}/api/memory/nodes`);
      const edgesRes = await apiClient.apiFetch(`${apiClient.API_BASE}/api/memory/edges`);
      
      const nodes = await nodesRes.json() as any[];
      const edges = await edgesRes.json() as any[];

      const formattedNodes = nodes.map((n: any) => ({
        ...n,
        val: n.type === 'conversation' ? 10 : 5
      }));

      const formattedLinks = edges.map((e: any) => ({
        source: e.source,
        target: e.target,
        relation: e.relation
      }));

      setData({ nodes: formattedNodes, links: formattedLinks });
    } catch (err) {
      console.error('Failed to fetch graph data:', err);
    } finally {
      setLoading(false);
    }
  };

  const getNodeColor = (type: string) => {
    switch (type) {
      case 'conversation': return '#818cf8'; // Indigo
      case 'file': return '#34d399'; // Emerald
      case 'decision': return '#fbbf24'; // Amber
      case 'bug': return '#f87171'; // Red
      default: return '#94a3b8'; // Slate
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="fixed inset-0 z-[100] bg-slate-900/95 backdrop-blur-xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-white/10 bg-white/5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500/20 rounded-lg">
                <Brain className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <h2 className="text-white font-semibold text-lg">Agentic Knowledge Map</h2>
                <p className="text-slate-400 text-xs">Phasic Semantic Memory of SiliconDev</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button 
                onClick={() => fetchGraphData()}
                className="p-2 hover:bg-white/10 rounded-lg text-slate-300 transition-colors"
                title="Refresh Graph"
              >
                <Zap className="w-5 h-5" />
              </button>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-white/10 rounded-lg text-slate-300 transition-colors"
                title="Close"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Graph Container */}
          <div className="flex-1 relative cursor-grab active:cursor-grabbing">
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
              </div>
            ) : (
              <ForceGraph2D
                ref={fgRef}
                graphData={data}
                nodeLabel={(node: any) => `${node.type.toUpperCase()}: ${node.label}`}
                nodeColor={(node: any) => getNodeColor(node.type)}
                linkColor={() => 'rgba(255, 255, 255, 0.2)'}
                nodeRelSize={6}
                linkDirectionalArrowLength={3}
                linkDirectionalArrowRelPos={1}
                onNodeClick={(node: any) => {
                  if (fgRef.current) {
                    fgRef.current.centerAt(node.x, node.y, 1000);
                    fgRef.current.zoom(2, 1000);
                  }
                }}
                backgroundColor="transparent"
              />
            )}

            {/* Legend */}
            <div className="absolute bottom-6 left-6 p-4 bg-black/40 backdrop-blur-md rounded-xl border border-white/10">
              <h4 className="text-white/80 text-xs font-bold uppercase tracking-wider mb-3">Nodes</h4>
              <div className="space-y-2">
                {[
                  { label: 'Conversations', color: '#818cf8' },
                  { label: 'Files', color: '#34d399' },
                  { label: 'Decisions', color: '#fbbf24' },
                  { label: 'Bugs', color: '#f87171' }
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></div>
                    <span className="text-slate-300 text-xs">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default KnowledgeMap;
