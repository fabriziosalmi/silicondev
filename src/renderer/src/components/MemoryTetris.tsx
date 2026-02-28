import { useState, useEffect } from 'react'
import { apiClient, type SystemStats } from '../api/client'

export function MemoryTetris() {
    const [stats, setStats] = useState<SystemStats | null>(null)

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const data = await apiClient.monitor.getStats()
                setStats(data)
            } catch {
                // silent
            }
        }

        fetchStats()
        const interval = setInterval(fetchStats, 2000)
        return () => clearInterval(interval)
    }, [])

    if (!stats) return null

    const formatGB = (bytes: number) => `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}`

    return (
        <div className="flex items-center gap-6 px-4 py-2.5 bg-black/20 rounded-lg border border-white/5">
            {/* RAM */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider shrink-0">Memory</span>
                <div className="flex-1 h-1.5 bg-black/40 rounded-full overflow-hidden border border-white/5">
                    <div
                        className="h-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-all duration-500"
                        style={{ width: `${stats.memory.percent}%` }}
                    />
                </div>
                <span className="text-[11px] font-mono text-gray-400 shrink-0">
                    {formatGB(stats.memory.used)}<span className="text-gray-600">/</span>{formatGB(stats.memory.total)} GB
                </span>
            </div>

            <div className="w-px h-4 bg-white/10" />

            {/* CPU */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider shrink-0">CPU</span>
                <div className="flex-1 h-1.5 bg-black/40 rounded-full overflow-hidden border border-white/5">
                    <div
                        className="h-full bg-gradient-to-r from-purple-600 to-pink-400 transition-all duration-300"
                        style={{ width: `${stats.cpu.percent}%` }}
                    />
                </div>
                <span className="text-[11px] font-mono text-gray-400 shrink-0">
                    {stats.cpu.percent.toFixed(0)}% <span className="text-gray-600">·</span> {stats.cpu.cores} cores
                </span>
            </div>

            <div className="w-px h-4 bg-white/10" />

            {/* Disk */}
            <div className="flex items-center gap-3 min-w-0">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider shrink-0">Disk</span>
                <span className="text-[11px] font-mono text-gray-400 shrink-0">
                    {stats.disk.percent.toFixed(0)}%
                </span>
            </div>
        </div>
    )
}
