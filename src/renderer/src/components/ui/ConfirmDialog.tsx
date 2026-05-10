import { useEffect, useCallback, useState, createContext, useContext } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'

interface ConfirmOptions {
    title?: string
    message: string
    confirmLabel?: string
    cancelLabel?: string
    destructive?: boolean
}

interface ConfirmContextValue {
    confirm: (options: ConfirmOptions) => Promise<boolean>
}

const ConfirmContext = createContext<ConfirmContextValue>({ confirm: () => Promise.resolve(false) })

export function useConfirm() {
    return useContext(ConfirmContext)
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
    const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)
    const trapRef = useFocusTrap(pending !== null)

    const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
        return new Promise(resolve => {
            setPending({ ...options, resolve })
        })
    }, [])

    const handleResolve = useCallback((value: boolean) => {
        pending?.resolve(value)
        setPending(null)
    }, [pending])

    useEffect(() => {
        if (!pending) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') handleResolve(false)
            if (e.key === 'Enter') handleResolve(true)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [pending, handleResolve])

    // Focus trap is handled by useFocusTrap above.

    return (
        <ConfirmContext.Provider value={{ confirm }}>
            {children}
            {pending && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
                    <div
                        ref={trapRef}
                        tabIndex={-1}
                        className="w-full max-w-sm mx-4 bg-[#1c1c1f] border border-white/10 rounded-xl shadow-2xl p-5 outline-none animate-in zoom-in-95 duration-150"
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby="confirm-title"
                        aria-describedby="confirm-message"
                    >
                        <div className="flex items-start gap-3 mb-4">
                            {pending.destructive && (
                                <div className="p-2 rounded-lg bg-red-500/10 shrink-0">
                                    <AlertTriangle size={18} className="text-red-400" />
                                </div>
                            )}
                            <div>
                                {pending.title && (
                                    <h3 id="confirm-title" className="text-sm font-semibold text-white mb-1">
                                        {pending.title}
                                    </h3>
                                )}
                                <p id="confirm-message" className="text-sm text-gray-400">
                                    {pending.message}
                                </p>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => handleResolve(false)}
                                className="px-3 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                            >
                                {pending.cancelLabel || 'Cancel'}
                            </button>
                            <button
                                type="button"
                                onClick={() => handleResolve(true)}
                                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                                    pending.destructive
                                        ? 'bg-red-600 hover:bg-red-500 text-white'
                                        : 'bg-blue-600 hover:bg-blue-500 text-white'
                                }`}
                            >
                                {pending.confirmLabel || 'Confirm'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </ConfirmContext.Provider>
    )
}
