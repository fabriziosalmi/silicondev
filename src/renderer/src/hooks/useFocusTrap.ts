import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTORS = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * useFocusTrap — constrains Tab/Shift+Tab navigation within the given ref container.
 * Restores focus to the previously-focused element when the trap is released.
 *
 * Usage:
 *   const trapRef = useFocusTrap(isOpen)
 *   <div ref={trapRef} role="dialog" aria-modal="true">…</div>
 */
export function useFocusTrap(active: boolean) {
    const containerRef = useRef<HTMLDivElement>(null)
    const previousFocusRef = useRef<HTMLElement | null>(null)

    useEffect(() => {
        if (!active) return

        // Save the currently-focused element so we can restore it on close.
        previousFocusRef.current = document.activeElement as HTMLElement

        // Move focus into the modal on open.
        const container = containerRef.current
        if (!container) return

        const focusable = Array.from(
            container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)
        ).filter(el => !el.closest('[hidden]'))

        // Focus the first focusable child, or the container itself.
        const firstFocusable = focusable[0] ?? container
        firstFocusable.focus()

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Tab') return

            const focusableNow = Array.from(
                container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)
            ).filter(el => !el.closest('[hidden]'))

            if (focusableNow.length === 0) { e.preventDefault(); return }

            const first = focusableNow[0]
            const last = focusableNow[focusableNow.length - 1]
            const active = document.activeElement

            if (e.shiftKey) {
                // Shift+Tab: if on first element, wrap to last
                if (active === first) { e.preventDefault(); last.focus() }
            } else {
                // Tab: if on last element, wrap to first
                if (active === last) { e.preventDefault(); first.focus() }
            }
        }

        document.addEventListener('keydown', handleKeyDown)

        return () => {
            document.removeEventListener('keydown', handleKeyDown)
            // Restore previous focus when trap is released
            previousFocusRef.current?.focus()
        }
    }, [active])

    return containerRef
}
