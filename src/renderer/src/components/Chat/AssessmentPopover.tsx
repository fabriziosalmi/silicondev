import { ShieldCheck } from 'lucide-react'
import type { SelfAssessment } from '../../api/client'

export function AssessmentPopover({ scores }: { scores: SelfAssessment }) {
    const dimensions: { key: keyof SelfAssessment; label: string }[] = [
        { key: 'privacy', label: 'Privacy' },
        { key: 'fairness', label: 'Fairness' },
        { key: 'safety', label: 'Safety' },
        { key: 'transparency', label: 'Transparency' },
        { key: 'ethics', label: 'Ethics' },
        { key: 'reliability', label: 'Reliability' },
    ];
    const barColor = (v: number) =>
        v >= 80 ? 'bg-emerald-500' : v >= 60 ? 'bg-yellow-500' : v >= 40 ? 'bg-orange-500' : 'bg-red-500';

    return (
        <div className="absolute bottom-full left-0 mb-1 p-2.5 rounded-lg bg-[#1a1a1a] border border-white/10 shadow-xl z-50 min-w-[220px]">
            <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                <span className="text-[10px] font-medium text-gray-400">Self-Assessment</span>
            </div>
            <div className="space-y-1.5">
                {dimensions.map(d => (
                    <div key={d.key} className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500 w-[76px] shrink-0">{d.label}</span>
                        <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full ${barColor(scores[d.key])}`}
                                style={{ width: `${scores[d.key]}%` }}
                            />
                        </div>
                        <span className="text-[10px] font-mono text-gray-500 w-6 text-right">{scores[d.key]}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
