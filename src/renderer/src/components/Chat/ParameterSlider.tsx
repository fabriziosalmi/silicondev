import { useState } from 'react'

interface ParameterSliderProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    format: (v: number) => string;
    onChange: (v: number) => void;
    hint?: string;
}

export function ParameterSlider({
    label, value, min, max, step, format, onChange, hint
}: ParameterSliderProps) {
    const [editing, setEditing] = useState(false);
    const [editValue, setEditValue] = useState('');

    const applyValue = () => {
        const parsed = parseFloat(editValue);
        if (!isNaN(parsed)) {
            onChange(Math.min(max, Math.max(min, parsed)));
        }
        setEditing(false);
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs text-gray-500" title={hint}>{label}</label>
                <input
                    type="text"
                    title={label}
                    value={editing ? editValue : format(value)}
                    onFocus={(e) => { setEditing(true); setEditValue(String(value)); e.target.select(); }}
                    onBlur={applyValue}
                    onKeyDown={(e) => { if (e.key === 'Enter') { applyValue(); (e.target as HTMLInputElement).blur(); } if (e.key === 'Escape') { setEditing(false); } }}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="w-16 text-right text-xs font-mono text-gray-400 tabular-nums bg-transparent outline-none border-b border-transparent focus:border-white/20 transition-colors"
                />
            </div>
            <input
                type="range"
                title={label}
                min={min} max={max} step={step}
                value={value}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-white/50"
            />
        </div>
    )
}
