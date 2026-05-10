/* eslint-disable react-refresh/only-export-components -- intentional: shared settings utilities and components in one file */
import React from 'react'

export interface SettingsNavItem {
    id: string
    label: string
    icon: React.ReactNode
    group: string
}

export interface ChatDefaults {
    systemPrompt: string
    temperature: number
    maxTokens: number
    maxContext: number
    topP: number
    repetitionPenalty: number
    reasoningMode: 'off' | 'auto' | 'low' | 'high'
    webSearchEnabled: boolean
    enableMoA: boolean
    airGappedMode: boolean
    enablePythonSandbox: boolean
}

export interface RagDefaults {
    chunkSize: number
    chunkOverlap: number
}

export interface TopBarDefaults {
    warn: number
    critical: number
}

export const defaultChat: ChatDefaults = {
    systemPrompt: "You are a helpful AI assistant running locally on Apple Silicon.",
    temperature: 0.7,
    maxTokens: 2048,
    maxContext: 4096,
    topP: 0.9,
    repetitionPenalty: 1.1,
    reasoningMode: 'auto',
    webSearchEnabled: false,
    enableMoA: true,
    airGappedMode: false,
    enablePythonSandbox: false,
}

export const defaultRag: RagDefaults = {
    chunkSize: 512,
    chunkOverlap: 50,
}

export const defaultTopBar: TopBarDefaults = {
    warn: 60,
    critical: 85,
}

export const CHAT_SETTINGS_KEY = 'silicon-studio-chat-settings'
export const RAG_SETTINGS_KEY = 'silicon-studio-rag-settings'
export const TOPBAR_SETTINGS_KEY = 'silicon-studio-topbar-settings'

export function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
    return (
        <div className="flex items-center gap-2 mb-4">
            <span className="text-blue-400">{icon}</span>
            <h3 className="text-sm font-bold text-white uppercase tracking-wide">{title}</h3>
        </div>
    )
}

export function SliderField({ label, value, onChange, min, max, step = 1, hint }: {
    label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; hint?: string
}) {
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-gray-500 uppercase">{label}</label>
                <input
                    type="number"
                    value={value}
                    onChange={(e) => onChange(Number(e.target.value))}
                    min={min}
                    max={max}
                    step={step}
                    className="w-20 bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white text-right outline-none focus:border-blue-500"
                />
            </div>
            <input
                type="range"
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                min={min}
                max={max}
                step={step}
                className="w-full accent-blue-500 h-1"
            />
            {hint && <span className="text-[10px] text-gray-600">{hint}</span>}
        </div>
    )
}
