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
