import { useState } from 'react'
import { ChevronDown, ChevronRight, Eye, Pencil, Plus, Gauge, File } from 'lucide-react'

interface PreLayerBarProps {
  profile: {
    intent: string
    complexity: string
    extracted_paths: string[]
  }
}

const INTENT_CONFIG = {
  review: { icon: Eye, label: 'Review', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  edit: { icon: Pencil, label: 'Edit', color: 'text-blue-400', bg: 'bg-blue-500/10' },
  create: { icon: Plus, label: 'Create', color: 'text-amber-400', bg: 'bg-amber-500/10' },
} as const

const COMPLEXITY_CONFIG = {
  simple: { label: 'Simple', color: 'text-green-400', dot: 'bg-green-400' },
  normal: { label: 'Normal', color: 'text-gray-400', dot: 'bg-gray-400' },
  complex: { label: 'Complex', color: 'text-orange-400', dot: 'bg-orange-400' },
} as const

export function PreLayerBar({ profile }: PreLayerBarProps) {
  const [expanded, setExpanded] = useState(false)

  const intent = INTENT_CONFIG[profile.intent as keyof typeof INTENT_CONFIG] ?? INTENT_CONFIG.edit
  const complexity = COMPLEXITY_CONFIG[profile.complexity as keyof typeof COMPLEXITY_CONFIG] ?? COMPLEXITY_CONFIG.normal
  const IntentIcon = intent.icon
  const pathCount = profile.extracted_paths.length

  return (
    <div className="shrink-0 border-t border-white/[0.04] bg-black/20">
      {/* Collapsed bar */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-white/[0.02] transition-colors"
      >
        {expanded ? (
          <ChevronDown size={10} className="text-gray-600 shrink-0" />
        ) : (
          <ChevronRight size={10} className="text-gray-600 shrink-0" />
        )}

        <Gauge size={10} className="text-gray-500 shrink-0" />
        <span className="text-[10px] text-gray-500 font-mono">pre-layer</span>

        <div className="flex items-center gap-1.5 ml-auto">
          {/* Intent badge */}
          <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono ${intent.color} ${intent.bg}`}>
            <IntentIcon size={9} />
            {intent.label}
          </span>

          {/* Complexity dot + label */}
          <span className={`flex items-center gap-1 text-[9px] font-mono ${complexity.color}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${complexity.dot}`} />
            {complexity.label}
          </span>

          {/* File count */}
          {pathCount > 0 && (
            <span className="flex items-center gap-0.5 text-[9px] font-mono text-gray-500">
              <File size={8} />
              {pathCount}
            </span>
          )}
        </div>
      </button>

      {/* Expanded details */}
      {expanded && pathCount > 0 && (
        <div className="px-3 pb-2 pt-0.5 border-t border-white/[0.03]">
          <div className="text-[9px] text-gray-600 font-mono mb-1">Pre-read files:</div>
          {profile.extracted_paths.map((p) => (
            <div key={p} className="flex items-center gap-1.5 py-0.5">
              <File size={8} className="text-gray-600 shrink-0" />
              <span className="text-[9px] text-gray-400 font-mono truncate" title={p}>
                {p.split('/').slice(-2).join('/')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
