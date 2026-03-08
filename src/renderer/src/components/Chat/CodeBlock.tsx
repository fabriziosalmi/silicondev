import { useState, useEffect, useRef, memo } from 'react'
import { Copy, Check, Play, Loader2, ChevronLeft, ChevronRight, Square, CircleCheck, CircleX, Wand2, Shield, Zap, FileText, TestTube2 } from 'lucide-react'
import { apiClient } from '../../api/client'
import type { SandboxResult, SyntaxCheckResult } from '../../api/client'

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

// Lightweight PII redaction — regex patterns for common PII types
const PII_PATTERNS: [RegExp, string][] = [
    [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL]'],
    [/\b(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[PHONE]'],
    [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP]'],
    [/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[CARD]'],
    [/\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, '[SSN]'],
    [/\b(?:sk-|ghp_|gho_|glpat-|xoxb-|xoxp-)[A-Za-z0-9_-]{20,}\b/g, '[KEY]'],
];

export function redactPII(text: string): { text: string; count: number } {
    let count = 0;
    let result = text;
    for (const [pattern, replacement] of PII_PATTERNS) {
        result = result.replace(new RegExp(pattern.source, pattern.flags), () => { count++; return replacement; });
    }
    return { text: result, count };
}

interface SnippetVersion {
    code: string;
    action: string;
    timestamp: number;
}

export const CodeBlock = memo(function CodeBlock({
    code,
    language,
    onTestAction,
    onRewrite,
    enabledActions,
    syntaxCheck,
    autoFixSyntax,
    piiRedaction,
}: {
    code: string;
    language: string;
    onTestAction: (code: string, action: string) => void;
    onRewrite: (code: string, action: string, context?: string, onToken?: (partial: string) => void) => Promise<string>;
    enabledActions?: Record<string, boolean>;
    syntaxCheck?: boolean;
    autoFixSyntax?: boolean;
    piiRedaction?: boolean;
}) {
    const [copied, setCopied] = useState(false);
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<SandboxResult | null>(null);
    const [showOutput, setShowOutput] = useState(false);
    const runIdRef = useRef<string | null>(null);
    const [checkResult, setCheckResult] = useState<SyntaxCheckResult | null>(null);
    const [checking, setChecking] = useState(false);
    const checkRanRef = useRef(false);

    // Versioning state
    const [versions, setVersions] = useState<SnippetVersion[]>([]);
    const [versionIndex, setVersionIndex] = useState(-1);
    const [rewriting, setRewriting] = useState(false);
    const [streamingCode, setStreamingCode] = useState<string | null>(null);
    const [showRewriteMenu, setShowRewriteMenu] = useState(false);
    const rewriteMenuRef = useRef<HTMLDivElement>(null);

    // Close rewrite menu on outside click
    useEffect(() => {
        if (!showRewriteMenu) return;
        const handler = (e: MouseEvent) => {
            if (rewriteMenuRef.current && !rewriteMenuRef.current.contains(e.target as Node)) {
                setShowRewriteMenu(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showRewriteMenu]);

    // The code to display: streaming > active version > original
    const displayCode = streamingCode ?? (versionIndex >= 0 && versions[versionIndex] ? versions[versionIndex].code : code);
    const totalVersions = versions.length;
    const displayVersionNum = versionIndex >= 0 ? versionIndex + 1 : (totalVersions > 0 ? 0 : -1);

    // Languages too vague for meaningful syntax checking
    const skipLangs = new Set(['', 'code', 'text', 'txt', 'output', 'plaintext', 'log', 'console', 'terminal', 'stdout', 'stderr']);

    // Auto-run syntax check on mount (only for blocks > 2 lines with a real language)
    useEffect(() => {
        if (!syntaxCheck || checkRanRef.current || code.split('\n').length <= 2 || skipLangs.has(language.toLowerCase())) return;
        checkRanRef.current = true;
        setChecking(true);
        apiClient.sandbox.check(code, language)
            .then(setCheckResult)
            .catch(err => console.error('Syntax check failed:', err))
            .finally(() => setChecking(false));
    }, [syntaxCheck, code, language]);

    // Re-check syntax when version changes
    useEffect(() => {
        if (!syntaxCheck || versionIndex < 0 || displayCode.split('\n').length <= 2 || skipLangs.has(language.toLowerCase())) return;
        setChecking(true);
        setCheckResult(null);
        apiClient.sandbox.check(displayCode, language)
            .then(setCheckResult)
            .catch(err => console.error('Syntax check failed:', err))
            .finally(() => setChecking(false));
    }, [versionIndex]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleCopy = () => {
        navigator.clipboard.writeText(displayCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleRun = async () => {
        setRunning(true);
        setShowOutput(true);
        setResult(null);
        try {
            const res = await apiClient.sandbox.run(displayCode, language);
            runIdRef.current = res.run_id;
            setResult(res);
        } catch (e: unknown) {
            setResult({
                stdout: '',
                stderr: e instanceof Error ? e.message : 'Execution failed',
                exit_code: 1,
                execution_time: 0,
                language: language || 'unknown',
                timed_out: false,
                run_id: '',
            });
        } finally {
            setRunning(false);
        }
    };

    const handleKill = async () => {
        if (runIdRef.current) {
            try { await apiClient.sandbox.kill(runIdRef.current); } catch { /* ignore */ }
        }
    };

    const handleInlineRewrite = async (action: string, context?: string) => {
        if (rewriting) return;
        setRewriting(true);
        setShowRewriteMenu(false);
        setStreamingCode('');
        try {
            const sourceCode = versionIndex >= 0 && versions[versionIndex] ? versions[versionIndex].code : code;
            const result = await onRewrite(sourceCode, action, context, (partial) => {
                setStreamingCode(partial);
            });
            setStreamingCode(null);
            // Initialize with original if first rewrite
            const current = versions.length === 0
                ? [{ code, action: 'original', timestamp: Date.now() }]
                : [...versions];
            // Truncate any "future" versions if user navigated back then rewrote
            const base = versionIndex >= 0 ? current.slice(0, versionIndex + 1) : current;
            const updated = [...base, { code: result, action, timestamp: Date.now() }];
            setVersions(updated);
            setVersionIndex(updated.length - 1);
        } catch {
            setStreamingCode(null);
        } finally {
            setRewriting(false);
        }
    };

    const handleRedactCode = () => {
        const { text, count } = redactPII(displayCode);
        if (count === 0 || text === displayCode) return;
        const current = versions.length === 0
            ? [{ code, action: 'original', timestamp: Date.now() }]
            : [...versions];
        const base = versionIndex >= 0 ? current.slice(0, versionIndex + 1) : current;
        const updated = [...base, { code: text, action: 'redact', timestamp: Date.now() }];
        setVersions(updated);
        setVersionIndex(updated.length - 1);
    };

    const rewriteActions = [
        { key: 'improve', label: 'Improve', icon: <Wand2 className="w-3 h-3" /> },
        { key: 'secure', label: 'Secure', icon: <Shield className="w-3 h-3" /> },
        { key: 'faster', label: 'Optimize', icon: <Zap className="w-3 h-3" /> },
        { key: 'docs', label: 'Document', icon: <FileText className="w-3 h-3" /> },
        ...(enabledActions?.['tests'] !== false ? [{ key: 'tests', label: 'Generate Tests', icon: <TestTube2 className="w-3 h-3" /> }] : []),
        ...(piiRedaction ? [{ key: 'redact', label: 'Redact PII', icon: <Shield className="w-3 h-3" /> }] : []),
    ].filter(a => a.key === 'tests' || a.key === 'redact' || enabledActions?.[a.key] !== false);

    const hasOutput = result && (result.stdout || result.stderr);

    return (
        <div className="rounded-lg border border-white/5 bg-black/30 overflow-hidden my-3 group/code">
            {/* Header bar */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.03] border-b border-white/5">
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-gray-500">{language || 'code'}</span>
                    {checking && <Loader2 className="w-3 h-3 animate-spin text-gray-500" />}
                    {!checking && checkResult && !checkResult.skipped && (
                        checkResult.valid
                            ? <span title="Syntax valid"><CircleCheck className="w-3 h-3 text-green-500" /></span>
                            : <span title={stripAnsi(checkResult.errors) || 'Syntax error'}><CircleX className="w-3 h-3 text-red-400" /></span>
                    )}
                    {rewriting && (
                        <span className="flex items-center gap-1 text-[10px] text-blue-400">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Rewriting...</span>
                        </span>
                    )}
                    {/* Version navigation */}
                    {totalVersions > 0 && !rewriting && (
                        <div className="flex items-center gap-0.5 ml-1">
                            <button
                                type="button"
                                onClick={() => setVersionIndex(Math.max(versionIndex - 1, -1))}
                                disabled={versionIndex <= -1}
                                className={`p-0.5 rounded transition-colors ${versionIndex > -1 ? 'text-gray-400 hover:text-white hover:bg-white/5' : 'text-gray-700 cursor-default'}`}
                                title="Previous version"
                            >
                                <ChevronLeft className="w-3 h-3" />
                            </button>
                            <span className="text-[10px] font-mono text-gray-500 min-w-[32px] text-center">
                                {versionIndex < 0 ? 'orig' : `v${displayVersionNum}`}/{totalVersions}
                            </span>
                            <button
                                type="button"
                                onClick={() => setVersionIndex(Math.min(versionIndex + 1, totalVersions - 1))}
                                disabled={versionIndex >= totalVersions - 1}
                                className={`p-0.5 rounded transition-colors ${versionIndex < totalVersions - 1 ? 'text-gray-400 hover:text-white hover:bg-white/5' : 'text-gray-700 cursor-default'}`}
                                title="Next version"
                            >
                                <ChevronRight className="w-3 h-3" />
                            </button>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-0.5">
                    {/* Run button */}
                    {running ? (
                        <button
                            type="button"
                            onClick={handleKill}
                            title="Kill process"
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                            <Square className="w-3 h-3 fill-current" />
                            <span>Kill</span>
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handleRun}
                            title="Run code"
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-green-400 hover:bg-green-500/10 transition-colors"
                        >
                            <Play className="w-3 h-3 fill-current" />
                            <span>Run</span>
                        </button>
                    )}
                    <div className="w-px h-3 bg-white/10 mx-1" />
                    {/* Rewrite dropdown */}
                    <div className="relative" ref={rewriteMenuRef}>
                        <button
                            type="button"
                            onClick={() => !rewriting && setShowRewriteMenu(!showRewriteMenu)}
                            disabled={rewriting}
                            title="Rewrite"
                            className={`p-1 rounded transition-colors ${rewriting ? 'text-blue-400 cursor-wait' : showRewriteMenu ? 'text-blue-400 bg-blue-500/10' : 'text-gray-600 hover:text-gray-300 hover:bg-white/5'}`}
                        >
                            <Wand2 className="w-3 h-3" />
                        </button>
                        {showRewriteMenu && (
                            <div className="absolute right-0 top-full mt-1 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl py-1 z-50 min-w-[140px]">
                                {rewriteActions.map(a => (
                                    <button
                                        type="button"
                                        key={a.key}
                                        onClick={() => {
                                            if (a.key === 'tests') { onTestAction(displayCode, 'tests'); setShowRewriteMenu(false); }
                                            else if (a.key === 'redact') { handleRedactCode(); setShowRewriteMenu(false); }
                                            else handleInlineRewrite(a.key);
                                        }}
                                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                                    >
                                        {a.icon}
                                        {a.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="w-px h-3 bg-white/10 mx-1" />
                    <button
                        type="button"
                        onClick={handleCopy}
                        title="Copy code"
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors"
                    >
                        {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                        <span>{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                </div>
            </div>
            {/* Code content */}
            <pre className="p-4 overflow-x-auto">
                <code className={`text-sm font-mono leading-relaxed ${rewriting ? 'text-blue-300/60' : 'text-blue-300'}`}>{displayCode}</code>
            </pre>
            {/* Version action label */}
            {!rewriting && versionIndex >= 0 && versions[versionIndex] && versions[versionIndex].action !== 'original' && (
                <div className="px-3 py-1 border-t border-white/5 bg-white/[0.02]">
                    <span className="text-[10px] text-gray-500">
                        {versions[versionIndex].action} rewrite
                    </span>
                </div>
            )}
            {/* Syntax errors — hidden when syntax check is toggled off */}
            {syntaxCheck && checkResult && !checkResult.valid && !checkResult.skipped && (
                <div className="border-t border-red-500/10 bg-red-500/[0.03] px-3 py-2">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-medium text-red-400">Syntax error</span>
                        {autoFixSyntax && (
                            <button
                                type="button"
                                onClick={() => handleInlineRewrite('fix', stripAnsi(checkResult.errors))}
                                disabled={rewriting}
                                aria-label="Auto-fix syntax error"
                                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${rewriting ? 'bg-red-500/5 text-red-400/50 cursor-wait' : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'}`}
                            >
                                {rewriting ? 'Fixing...' : 'Fix syntax'}
                            </button>
                        )}
                    </div>
                    {checkResult.errors && (
                        <pre className="text-[10px] font-mono text-red-400/70 mt-1 whitespace-pre-wrap leading-relaxed max-h-24 overflow-y-auto">
                            {stripAnsi(checkResult.errors)}
                        </pre>
                    )}
                </div>
            )}
            {/* Sandbox output */}
            {showOutput && (
                <div className="border-t border-white/5">
                    <div className="flex items-center justify-between px-3 py-1 bg-white/[0.02]">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-gray-500">Output</span>
                            {running && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
                            {result && (
                                <>
                                    <span className={`text-[10px] font-mono ${result.exit_code === 0 ? 'text-green-500' : 'text-red-400'}`}>
                                        exit {result.exit_code}
                                    </span>
                                    <span className="text-[10px] font-mono text-gray-600">
                                        {result.execution_time}s
                                    </span>
                                    {result.timed_out && (
                                        <span className="text-[10px] text-yellow-500">timeout</span>
                                    )}
                                </>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => { setShowOutput(false); setResult(null); }}
                            aria-label="Close output"
                            className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
                        >
                            Close
                        </button>
                    </div>
                    {hasOutput && (
                        <pre className="px-4 py-3 overflow-x-auto max-h-48 overflow-y-auto text-xs font-mono leading-relaxed">
                            {result.stdout && <span className="text-gray-300">{result.stdout}</span>}
                            {result.stderr && <span className="text-red-400/80">{result.stderr}</span>}
                        </pre>
                    )}
                    {running && !hasOutput && (
                        <div className="px-4 py-3 text-xs text-gray-600">Running...</div>
                    )}
                </div>
            )}
        </div>
    );
});
