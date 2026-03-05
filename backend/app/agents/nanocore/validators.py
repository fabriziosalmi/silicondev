"""Content validators for NanoCore file edits.

Catches syntax errors and lazy placeholder text before the user
ever sees a diff proposal.
"""

import ast
import json
import re
import asyncio
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Patterns that indicate the model took a shortcut instead of writing real code.
# Each tuple is (compiled regex, human-readable label).
_LAZY_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r'//\s*\.{3,}\s*rest\b', re.IGNORECASE), '// ... rest of code'),
    (re.compile(r'#\s*\.{3,}\s*rest\b', re.IGNORECASE), '# ... rest of code'),
    (re.compile(r'//\s*remain(ing|der)\s+(of\s+)?(the\s+)?(code|file|implementation)', re.IGNORECASE),
     '// remaining code placeholder'),
    (re.compile(r'#\s*remain(ing|der)\s+(of\s+)?(the\s+)?(code|file|implementation)', re.IGNORECASE),
     '# remaining code placeholder'),
    (re.compile(r'//\s*\.\.\.\s*(same|unchanged|existing|previous)', re.IGNORECASE),
     '// ... same as before'),
    (re.compile(r'#\s*\.\.\.\s*(same|unchanged|existing|previous)', re.IGNORECASE),
     '# ... same as before'),
    (re.compile(r'//\s*TODO:?\s*implement', re.IGNORECASE), '// TODO implement'),
    (re.compile(r'#\s*TODO:?\s*implement', re.IGNORECASE), '# TODO implement'),
    (re.compile(r'/\*\s*\.{3,}\s*\*/', re.IGNORECASE), '/* ... */ block'),
    (re.compile(r'\.{3,}\s*\(?\s*keep\s', re.IGNORECASE), '... keep ... placeholder'),
    (re.compile(r'//\s*\[rest\s+of', re.IGNORECASE), '// [rest of ...] placeholder'),
    (re.compile(r'#\s*\[rest\s+of', re.IGNORECASE), '# [rest of ...] placeholder'),
]


def detect_lazy_edit(content: str) -> str | None:
    """Scan content for lazy placeholder text.

    Returns a description of the first match found, or None if clean.
    """
    for pattern, label in _LAZY_PATTERNS:
        match = pattern.search(content)
        if match:
            # Show a few chars of context around the match
            start = max(0, match.start() - 20)
            end = min(len(content), match.end() + 20)
            snippet = content[start:end].replace('\n', '\\n')
            return f"Lazy placeholder detected ({label}): ...{snippet}..."
    return None


def _validate_python(content: str) -> str | None:
    """Check Python syntax via ast.parse(). Returns error or None."""
    try:
        ast.parse(content)
        return None
    except SyntaxError as e:
        return f"Python syntax error at line {e.lineno}: {e.msg}"


def _validate_json(content: str) -> str | None:
    """Check JSON validity. Returns error or None."""
    try:
        json.loads(content)
        return None
    except json.JSONDecodeError as e:
        return f"JSON parse error at line {e.lineno}: {e.msg}"


def _validate_yaml(content: str) -> str | None:
    """Check YAML validity if PyYAML is available. Returns error or None."""
    try:
        import yaml
        yaml.safe_load(content)
        return None
    except ImportError:
        return None  # skip if pyyaml not installed
    except yaml.YAMLError as e:
        return f"YAML parse error: {e}"


async def _validate_js(content: str, file_path: str) -> str | None:
    """Check JS syntax via node --check. Returns error or None."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "node", "--check", file_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
        if proc.returncode != 0:
            return f"JS syntax error: {stderr.decode(errors='replace').strip()}"
        return None
    except FileNotFoundError:
        return None  # node not installed, skip
    except asyncio.TimeoutError:
        return None  # too slow, skip
    except Exception:
        return None  # don't block edits on validator failures


# Map file extensions to validators.
# Async validators take (content, file_path); sync take (content,).
_SYNC_VALIDATORS: dict[str, callable] = {
    ".py": _validate_python,
    ".json": _validate_json,
    ".yaml": _validate_yaml,
    ".yml": _validate_yaml,
}

_ASYNC_VALIDATORS: dict[str, callable] = {
    ".js": _validate_js,
}

# Extensions we intentionally skip (need tsconfig, too heavy)
_SKIP_EXTENSIONS = {".ts", ".tsx", ".jsx"}


async def run_lint_check(file_path: str) -> str | None:
    """Run a quick lint check on a file after it's been written.

    Returns lint output if issues found, None if clean or unsupported.
    This is a post-write check (unlike validate_content which is pre-write).
    """
    ext = Path(file_path).suffix.lower()

    try:
        if ext == ".py":
            # Try ruff first, fall back to python -m py_compile
            for cmd in [
                ["ruff", "check", "--no-fix", "--output-format=text", file_path],
                ["python", "-m", "py_compile", file_path],
            ]:
                try:
                    proc = await asyncio.create_subprocess_exec(
                        *cmd,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                    )
                    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15)
                    if proc.returncode != 0:
                        output = (stdout or stderr).decode(errors="replace").strip()
                        return output[:2000] if output else None
                    return None
                except FileNotFoundError:
                    continue
            return None

        if ext in (".js", ".jsx"):
            proc = await asyncio.create_subprocess_exec(
                "node", "--check", file_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
            if proc.returncode != 0:
                return stderr.decode(errors="replace").strip()[:2000]
            return None

        if ext in (".ts", ".tsx"):
            # Quick syntax check via tsc --noEmit (if available)
            proc = await asyncio.create_subprocess_exec(
                "npx", "tsc", "--noEmit", "--pretty", "false", file_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
            if proc.returncode != 0:
                output = (stdout or stderr).decode(errors="replace").strip()
                return output[:2000] if output else None
            return None

    except (FileNotFoundError, asyncio.TimeoutError, OSError):
        return None

    return None


# Security patterns to flag in code edits
_SECURITY_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r'(?:password|secret|api_key|token)\s*=\s*["\'][^"\']{4,}["\']', re.IGNORECASE),
     'Possible hardcoded secret/credential'),
    (re.compile(r'eval\s*\(', re.IGNORECASE),
     'eval() usage — potential code injection'),
    (re.compile(r'innerHTML\s*=', re.IGNORECASE),
     'innerHTML assignment — potential XSS'),
    (re.compile(r'dangerouslySetInnerHTML', re.IGNORECASE),
     'dangerouslySetInnerHTML — ensure input is sanitized'),
    (re.compile(r'subprocess\.call\s*\([^)]*shell\s*=\s*True', re.IGNORECASE),
     'subprocess with shell=True — potential command injection'),
    (re.compile(r'os\.system\s*\(', re.IGNORECASE),
     'os.system() — prefer subprocess with shell=False'),
    (re.compile(r'execute\s*\(\s*["\'].*%s', re.IGNORECASE),
     'SQL string formatting — use parameterized queries'),
    (re.compile(r'execute\s*\(\s*f["\']', re.IGNORECASE),
     'SQL f-string — use parameterized queries'),
]

# Performance anti-patterns
_PERF_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r'for\s+\w+\s+in\s+.*\.all\(\)', re.IGNORECASE),
     'Iterating over .all() — consider filtering or pagination'),
    (re.compile(r'time\.sleep\s*\(\s*\d{2,}', re.IGNORECASE),
     'Long sleep — consider async or event-based approach'),
    (re.compile(r'SELECT\s+\*\s+FROM', re.IGNORECASE),
     'SELECT * — specify needed columns for performance'),
]


def scan_security(content: str) -> list[str]:
    """Scan content for security anti-patterns. Returns list of warnings."""
    warnings = []
    for pattern, label in _SECURITY_PATTERNS:
        if pattern.search(content):
            warnings.append(f"[security] {label}")
    return warnings


def scan_performance(content: str) -> list[str]:
    """Scan content for performance anti-patterns. Returns list of hints."""
    hints = []
    for pattern, label in _PERF_PATTERNS:
        if pattern.search(content):
            hints.append(f"[perf] {label}")
    return hints


async def validate_content(file_path: str, content: str) -> str | None:
    """Validate file content based on extension.

    Returns an error string if validation fails, None if valid or
    if no validator exists for this file type.
    """
    ext = Path(file_path).suffix.lower()

    if ext in _SKIP_EXTENSIONS:
        return None

    sync_validator = _SYNC_VALIDATORS.get(ext)
    if sync_validator:
        return sync_validator(content)

    async_validator = _ASYNC_VALIDATORS.get(ext)
    if async_validator:
        return await async_validator(content, file_path)

    return None
