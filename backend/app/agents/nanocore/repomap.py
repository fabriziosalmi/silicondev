"""Lightweight repo map generator for NanoCore.

Walks the working directory, extracts top-level symbols from Python
and JS/TS files, and returns a compact text map the model can use
for navigation.
"""

import ast
import logging
import os
import re
import time
from pathlib import Path

logger = logging.getLogger(__name__)

# Directories to always skip
SKIP_DIRS = {
    "node_modules", ".git", ".venv", "venv", "__pycache__",
    ".next", ".nuxt", "dist", "build", ".tox", ".mypy_cache",
    ".pytest_cache", "egg-info", ".eggs", "coverage",
    ".claude", ".DS_Store",
}

# Max files to process
MAX_FILES = 100
# Max chars in the final map
MAX_MAP_CHARS = 3000

# JS/TS symbol extraction patterns
_JS_CLASS_RE = re.compile(r'^\s*(?:export\s+)?class\s+(\w+)', re.MULTILINE)
_JS_FUNC_RE = re.compile(
    r'^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)',
    re.MULTILINE,
)
_JS_CONST_RE = re.compile(
    r'^\s*export\s+(?:const|let|var)\s+(\w+)',
    re.MULTILINE,
)


def _extract_python_symbols(path: Path) -> list[str]:
    """Extract class and function names from a Python file using AST."""
    try:
        source = path.read_text(errors="replace")
        tree = ast.parse(source)
    except Exception:
        return []

    symbols = []
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.ClassDef):
            methods = [
                n.name for n in ast.iter_child_nodes(node)
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                and not n.name.startswith("_")
            ]
            if methods:
                symbols.append(f"class {node.name}: {', '.join(methods)}")
            else:
                symbols.append(f"class {node.name}")
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            symbols.append(f"def {node.name}()")
    return symbols


def _extract_js_symbols(path: Path) -> list[str]:
    """Extract class, function, and exported const names via regex."""
    try:
        source = path.read_text(errors="replace")
    except Exception:
        return []

    symbols = []
    for m in _JS_CLASS_RE.finditer(source):
        symbols.append(f"class {m.group(1)}")
    for m in _JS_FUNC_RE.finditer(source):
        symbols.append(f"function {m.group(1)}")
    for m in _JS_CONST_RE.finditer(source):
        symbols.append(f"const {m.group(1)}")
    return symbols


def generate_repo_map(working_dir: str, max_chars: int = MAX_MAP_CHARS) -> str:
    """Walk the working directory and build a compact symbol map.

    Returns a text block showing directory structure with key symbols.
    Empty string if the directory doesn't exist or has no relevant files.
    """
    root = Path(working_dir)
    if not root.is_dir():
        return ""

    # Collect files grouped by directory
    dir_files: dict[str, list[tuple[str, list[str]]]] = {}
    file_count = 0

    for dirpath, dirnames, filenames in os.walk(root):
        # Skip hidden and vendor dirs
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        dirnames.sort()

        rel_dir = os.path.relpath(dirpath, root)
        if rel_dir == ".":
            rel_dir = ""

        for fname in sorted(filenames):
            if file_count >= MAX_FILES:
                break

            fpath = Path(dirpath) / fname
            ext = fpath.suffix.lower()

            symbols = []
            if ext == ".py":
                symbols = _extract_python_symbols(fpath)
            elif ext in (".js", ".ts", ".tsx", ".jsx"):
                symbols = _extract_js_symbols(fpath)
            else:
                continue  # only map code files

            key = rel_dir or "."
            if key not in dir_files:
                dir_files[key] = []
            dir_files[key].append((fname, symbols))
            file_count += 1

        if file_count >= MAX_FILES:
            break

    if not dir_files:
        return ""

    # Build text output
    lines = ["Project structure:"]
    for dir_path in sorted(dir_files.keys()):
        display_path = dir_path + "/" if dir_path != "." else "./"
        lines.append(f"  {display_path}")
        for fname, symbols in dir_files[dir_path]:
            if symbols:
                sym_str = "; ".join(symbols[:5])  # cap per file
                if len(symbols) > 5:
                    sym_str += f" (+{len(symbols) - 5} more)"
                lines.append(f"    {fname}: {sym_str}")
            else:
                lines.append(f"    {fname}")

    result = "\n".join(lines)

    # Truncate if too long
    if len(result) > max_chars:
        result = result[:max_chars - 20] + "\n  [... truncated]"

    return result


class RepoMapCache:
    """Cached repo map that regenerates when marked dirty.

    The agent should call invalidate() after any file edit/patch so
    the next iteration picks up changed symbols.
    """

    def __init__(self, working_dir: str, max_chars: int = MAX_MAP_CHARS):
        self._working_dir = working_dir
        self._max_chars = max_chars
        self._cached: str = ""
        self._dirty = True

    def invalidate(self) -> None:
        """Mark the cache as stale. Next get() will regenerate."""
        self._dirty = True

    def get(self) -> str:
        """Return the repo map, regenerating if dirty."""
        if self._dirty:
            self._cached = generate_repo_map(self._working_dir, self._max_chars)
            self._dirty = False
        return self._cached
