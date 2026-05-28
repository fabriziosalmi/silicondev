// Curated picks shown on the Discover page above the full catalog.
// Order matters: the first card is what a brand-new user sees first.
export const RECOMMENDED_MODELS = [
    { id: 'mlx-community/Qwen3.5-9B-MLX-4bit', label: 'Best 8GB pick', sizeGB: 5.5 },
    { id: 'mlx-community/Qwen3-30B-A3B-4bit', label: 'MoE — 32GB+', sizeGB: 17.5 },
    { id: 'mlx-community/gemma-3-12b-it-qat-4bit', label: 'Google Gemma', sizeGB: 7.8 },
    { id: 'mlx-community/Devstral-Small-2-24B-Instruct-2512-4bit', label: 'Coding', sizeGB: 13.5 },
    { id: 'mlx-community/Qwen3-1.7B-MLX-4bit', label: 'Tiny, fast', sizeGB: 1.0 },
    { id: 'mlx-community/Llama-3.3-70B-Instruct-4bit', label: 'Llama, big', sizeGB: 40.0 },
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

/**
 * Semi-official MLX builds: mlx-community/* is Apple-curated, apple/* is
 * first-party. Useful as a trust signal in Discover.
 */
export function isMlxOfficial(id: string): boolean {
    const lower = id.toLowerCase()
    return lower.startsWith('mlx-community/') || lower.startsWith('apple/')
}

/**
 * Best-effort vision detection from the model id/name. Backend flags
 * is_vision once a model is loaded, but at catalog browse time we rely on
 * naming conventions instead of fetching every config.json.
 */
export function isVisionLikely(idOrName: string, isVisionFlag?: boolean): boolean {
    if (isVisionFlag) return true
    const s = idOrName.toLowerCase()
    return (
        s.includes('vlm')
        || s.includes('vision')
        || s.includes('-vl-')
        || s.endsWith('-vl')
        || s.includes('llava')
        || s.includes('idefics')
        || s.includes('paligemma')
    )
}

export type QuantBucket = '4bit' | '8bit' | 'fp16' | 'unknown'

export function quantBucket(name: string): QuantBucket {
    const n = name.toLowerCase()
    if (n.includes('4-bit') || n.includes('4bit') || n.includes('q4_')) return '4bit'
    if (n.includes('8-bit') || n.includes('8bit') || n.includes('q8_')) return '8bit'
    if (n.includes('bf16') || n.includes('fp16') || n.includes('f16')) return 'fp16'
    return 'unknown'
}
