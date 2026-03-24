export const RECOMMENDED_MODELS = [
    { id: 'mlx-community/Qwen3-0.6B-4bit', label: 'Tiny, fast', sizeGB: 0.4 },
    { id: 'mlx-community/Qwen2.5-3B-Instruct-4bit', label: 'Good default', sizeGB: 1.8 },
    { id: 'mlx-community/Llama-3.2-3B-Instruct-4bit', label: 'Meta Llama', sizeGB: 1.8 },
    { id: 'mlx-community/Gemma-3-4b-it-4bit', label: 'Google Gemma', sizeGB: 2.6 },
]

export function parseSizeGB(size: string): number {
    const match = size.match(/([\d.]+)\s*GB/i)
    return match ? parseFloat(match[1]) : 0
}

export function archColor(arch: string | undefined): { bg: string; border: string; text: string; dot: string } {
    const a = (arch || '').toLowerCase()
    if (a.includes('qwen')) return { bg: 'bg-violet-500/10', border: 'border-violet-500/20', text: 'text-violet-400', dot: 'bg-violet-400' }
    if (a.includes('llama')) return { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-400', dot: 'bg-blue-400' }
    if (a.includes('gemma')) return { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400', dot: 'bg-emerald-400' }
    if (a.includes('phi')) return { bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', text: 'text-cyan-400', dot: 'bg-cyan-400' }
    if (a.includes('mistral') || a.includes('mixtral')) return { bg: 'bg-orange-500/10', border: 'border-orange-500/20', text: 'text-orange-400', dot: 'bg-orange-400' }
    if (a.includes('lfm')) return { bg: 'bg-pink-500/10', border: 'border-pink-500/20', text: 'text-pink-400', dot: 'bg-pink-400' }
    return { bg: 'bg-gray-500/10', border: 'border-gray-500/20', text: 'text-gray-400', dot: 'bg-gray-400' }
}

export function guessQuant(name: string) {
    if (name.toLowerCase().includes('4-bit') || name.toLowerCase().includes('4bit')) return '4-BIT'
    if (name.toLowerCase().includes('8-bit') || name.toLowerCase().includes('8bit')) return '8-BIT'
    if (name.toLowerCase().includes('bf16')) return 'BF16'
    if (name.toLowerCase().includes('fp16')) return 'FP16'
    return ''
}

export function guessPublisher(id: string) {
    return id.split('/')[0] || '-'
}
