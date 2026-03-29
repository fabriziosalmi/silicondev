import { useEffect, useRef } from 'react'
import { calculateInlineDiff } from './diffUtils'
import './diff.css'

// Monaco attaches itself to `window` at runtime; helper to access it with minimal type escape
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMonaco(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as Record<string, any>).monaco
}

// Monaco editor instance type -- no public export available from the package
interface MonacoEditorInstance {
    deltaDecorations: (oldDecorations: string[], newDecorations: unknown[]) => string[]
    changeViewZones: (accessor: (a: { addZone: (zone: unknown) => string; removeZone: (id: string) => void }) => void) => void
}

export function useHolographicDiff(editor: MonacoEditorInstance | null, originalContent: string | null, modifiedContent: string) {
    const decorationsRef = useRef<string[]>([])
    const viewZonesRef = useRef<string[]>([])

    useEffect(() => {
        if (!editor || !originalContent) {
            // Cleanup if diff mode is off (only if editor is available)
            if (editor) {
                if (decorationsRef.current.length > 0) {
                    editor.deltaDecorations(decorationsRef.current, [])
                    decorationsRef.current = []
                }
                editor.changeViewZones((accessor) => {
                    viewZonesRef.current.forEach(id => accessor.removeZone(id))
                    viewZonesRef.current = []
                })
            }
            return
        }

        const { additions, removals } = calculateInlineDiff(originalContent, modifiedContent)

        // Apply Decorations (Additions)
        const newDecorations = additions.map(add => ({
            range: new (getMonaco()).Range(
                add.range.startLineNumber,
                add.range.startColumn,
                add.range.endLineNumber,
                add.range.endColumn
            ),
            options: {
                isWholeLine: true,
                className: 'diff-added-bg',
                linesDecorationsClassName: 'diff-added-line-margin',
                description: 'diff-addition'
            }
        }))

        decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations)

        // Apply View Zones (Removals)
        editor.changeViewZones((accessor) => {
            // Clear old zones
            viewZonesRef.current.forEach(id => accessor.removeZone(id))
            viewZonesRef.current = []

            removals.forEach(rem => {
                const lines = rem.text.split('\n')
                if (lines[lines.length - 1] === '') lines.pop()

                const domNode = document.createElement('div')
                domNode.className = 'diff-removed-zone'

                lines.forEach(line => {
                    const lineEl = document.createElement('div')
                    lineEl.className = 'diff-removed-line'
                    lineEl.textContent = line
                    domNode.appendChild(lineEl)
                })

                const zoneId = accessor.addZone({
                    afterLineNumber: rem.afterLine,
                    heightInLines: lines.length,
                    domNode: domNode,
                })
                viewZonesRef.current.push(zoneId)
            })
        })

        return () => {
            // Cleanup on unmount or deps change
            editor.changeViewZones((accessor) => {
                viewZonesRef.current.forEach(id => accessor.removeZone(id))
            })
        }
    }, [editor, originalContent, modifiedContent])
}
