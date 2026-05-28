/**
 * Minimal ANSI escape renderer for the terminal feed.
 *
 * Supports the subset that real-world CLIs produce:
 *   - SGR reset (0)
 *   - bold (1), italic (3), underline (4), and their resets (22/23/24)
 *   - 8/16-color foreground (30-37, 90-97) + default (39)
 *   - 8/16-color background (40-47, 100-107) + default (49)
 *   - 256-color (38;5;n / 48;5;n) and truecolor (38;2;r;g;b / 48;2;r;g;b)
 *
 * Cursor-movement escapes and other CSI sequences are silently dropped.
 */
import { Fragment, useMemo, type CSSProperties } from 'react'

// SGR (Select Graphic Rendition) only — strip non-SGR escapes separately.
const SGR_RE = /\x1b\[([\d;]*)m/g
// Other CSI escapes (cursor movement, clear line, etc.) — discarded.
const NON_SGR_CSI_RE = /\x1b\[[\d;?]*[a-ln-zA-LN-Z]/g

// VS Code dark palette — good contrast on dark backgrounds.
const FG_COLORS: Record<number, string> = {
    30: '#000000', 31: '#cd3131', 32: '#0dbc79', 33: '#e5e510',
    34: '#2472c8', 35: '#bc3fbc', 36: '#11a8cd', 37: '#e5e5e5',
    90: '#666666', 91: '#f14c4c', 92: '#23d18b', 93: '#f5f543',
    94: '#3b8eea', 95: '#d670d6', 96: '#29b8db', 97: '#ffffff',
}
const BG_COLORS: Record<number, string> = {
    40: '#000000', 41: '#cd3131', 42: '#0dbc79', 43: '#e5e510',
    44: '#2472c8', 45: '#bc3fbc', 46: '#11a8cd', 47: '#e5e5e5',
    100: '#666666', 101: '#f14c4c', 102: '#23d18b', 103: '#f5f543',
    104: '#3b8eea', 105: '#d670d6', 106: '#29b8db', 107: '#ffffff',
}

interface AnsiState {
    fg?: string
    bg?: string
    bold?: boolean
    italic?: boolean
    underline?: boolean
}

function xterm256(n: number): string {
    if (n < 16) {
        const map = [30, 31, 32, 33, 34, 35, 36, 37, 90, 91, 92, 93, 94, 95, 96, 97]
        return FG_COLORS[map[n]] || '#ffffff'
    }
    if (n >= 232) {
        const g = 8 + (n - 232) * 10
        return `rgb(${g},${g},${g})`
    }
    const m = n - 16
    const r = Math.floor(m / 36)
    const g = Math.floor((m % 36) / 6)
    const b = m % 6
    const conv = (v: number) => (v === 0 ? 0 : v * 40 + 55)
    return `rgb(${conv(r)},${conv(g)},${conv(b)})`
}

function applyParams(state: AnsiState, params: number[]): AnsiState {
    // Bare `\x1b[m` (no params) is interpreted as reset.
    if (params.length === 0) return {}
    const next: AnsiState = { ...state }
    let i = 0
    while (i < params.length) {
        const p = params[i]
        if (p === 0) {
            next.fg = undefined
            next.bg = undefined
            next.bold = false
            next.italic = false
            next.underline = false
        } else if (p === 1) next.bold = true
        else if (p === 3) next.italic = true
        else if (p === 4) next.underline = true
        else if (p === 22) next.bold = false
        else if (p === 23) next.italic = false
        else if (p === 24) next.underline = false
        else if (p === 39) next.fg = undefined
        else if (p === 49) next.bg = undefined
        else if (FG_COLORS[p]) next.fg = FG_COLORS[p]
        else if (BG_COLORS[p]) next.bg = BG_COLORS[p]
        else if (p === 38 && params[i + 1] === 5 && params[i + 2] !== undefined) {
            next.fg = xterm256(params[i + 2])
            i += 2
        } else if (p === 48 && params[i + 1] === 5 && params[i + 2] !== undefined) {
            next.bg = xterm256(params[i + 2])
            i += 2
        } else if (
            p === 38 && params[i + 1] === 2 &&
            params[i + 2] !== undefined && params[i + 3] !== undefined && params[i + 4] !== undefined
        ) {
            next.fg = `rgb(${params[i + 2]},${params[i + 3]},${params[i + 4]})`
            i += 4
        } else if (
            p === 48 && params[i + 1] === 2 &&
            params[i + 2] !== undefined && params[i + 3] !== undefined && params[i + 4] !== undefined
        ) {
            next.bg = `rgb(${params[i + 2]},${params[i + 3]},${params[i + 4]})`
            i += 4
        }
        i++
    }
    return next
}

interface Segment {
    text: string
    state: AnsiState
}

function parseAnsi(text: string): Segment[] {
    // Drop non-SGR CSI (cursor moves etc.) before SGR parsing so they don't pollute output.
    const cleaned = text.replace(NON_SGR_CSI_RE, '')
    const segments: Segment[] = []
    let state: AnsiState = {}
    let lastIdx = 0
    SGR_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = SGR_RE.exec(cleaned)) !== null) {
        if (match.index > lastIdx) {
            segments.push({ text: cleaned.slice(lastIdx, match.index), state })
        }
        const params = match[1]
            .split(';')
            .filter((s) => s.length > 0)
            .map((s) => parseInt(s, 10) || 0)
        state = applyParams(state, params)
        lastIdx = match.index + match[0].length
    }
    if (lastIdx < cleaned.length) {
        segments.push({ text: cleaned.slice(lastIdx), state })
    }
    return segments
}

function styleFor(state: AnsiState): CSSProperties {
    const style: CSSProperties = {}
    if (state.fg) style.color = state.fg
    if (state.bg) style.backgroundColor = state.bg
    if (state.bold) style.fontWeight = 'bold'
    if (state.italic) style.fontStyle = 'italic'
    if (state.underline) style.textDecoration = 'underline'
    return style
}

function hasStyle(state: AnsiState): boolean {
    return !!(state.fg || state.bg || state.bold || state.italic || state.underline)
}

export function AnsiText({ text }: { text: string }) {
    const segments = useMemo(() => parseAnsi(text), [text])
    return (
        <>
            {segments.map((seg, i) =>
                hasStyle(seg.state)
                    ? <span key={i} style={styleFor(seg.state)}>{seg.text}</span>
                    : <Fragment key={i}>{seg.text}</Fragment>
            )}
        </>
    )
}
