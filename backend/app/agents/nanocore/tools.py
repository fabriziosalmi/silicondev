"""Tool implementations for the NanoCore agent."""

import asyncio
import difflib
import errno
import logging
import os
import pty
import re
import tempfile
from pathlib import Path
from typing import AsyncGenerator

import aiofiles

logger = logging.getLogger(__name__)

# --- ANSI escape code stripper ---
_ANSI_RE = re.compile(r'\x1b\[[0-9;]*[a-zA-Z]')


def strip_ansi(text: str) -> str:
    return _ANSI_RE.sub('', text)


# --- Safety: blocked commands and protected paths ---

BLOCKED_PATTERNS = [
    "rm -rf /",
    "rm -rf /*",
    "mkfs",
    ":(){ :|:& };:",
    "> /dev/sda",
    "dd if=/dev/zero of=/dev/",
    "chmod -r 000 /",
    "chown -r",
]

# macOS system paths that should never be touched
PROTECTED_PATHS = [
    "/System", "/Library", "/usr", "/bin", "/sbin",
    "/private", "/etc", "/var", "/cores", "/opt",
    "/Applications",
]


def _is_protected_path(file_path: str) -> str | None:
    """Check if a resolved path falls under a protected system directory.

    Returns the blocked path prefix or None if safe.
    """
    resolved = str(Path(file_path).resolve())
    for ppath in PROTECTED_PATHS:
        if resolved == ppath or resolved.startswith(ppath + "/"):
            return ppath
    return None

# Commands that require explicit user confirmation (handled via diff approval flow)
DESTRUCTIVE_PREFIXES = [
    "rm ", "rm\t", "rmdir ",
    "sudo ",
    "mv ", "mv\t",
    "chmod ", "chown ",
    "kill ", "killall ",
    "launchctl ",
    "diskutil ",
    "pip uninstall ", "pip3 uninstall ",
    "brew uninstall ", "brew remove ",
]

# Max output bytes per tool call before truncation
MAX_OUTPUT_BYTES = 10 * 1024  # 10 KB
# Max file size for edit_file reads (500 KB) — prevents blowing up LLM context
MAX_EDIT_FILE_BYTES = 500 * 1024


def _is_blocked(command: str) -> str | None:
    """Check if a command should be blocked. Returns reason or None."""
    normalized = command.strip().lower()

    # Strip shell wrapper attempts: bash -c "...", sh -c "...", zsh -c "..."
    # This catches `bash -c "rm -rf /"` style bypasses
    _shell_wrap = re.match(
        r"^(?:ba)?sh\s+-c\s+[\"'](.+?)[\"']\s*$", normalized
    ) or re.match(
        r"^(?:z|k|c)?sh\s+-c\s+[\"'](.+?)[\"']\s*$", normalized
    )
    if _shell_wrap:
        inner = _shell_wrap.group(1)
        inner_block = _is_blocked(inner)
        if inner_block:
            return f"{inner_block} (via shell -c wrapper)"

    # Check each segment of piped/chained commands
    # Splits on |, &&, ||, ; to catch `echo foo | rm -rf /`
    segments = re.split(r'\s*(?:\|\||&&|[|;])\s*', normalized)
    if len(segments) > 1:
        for seg in segments:
            seg = seg.strip()
            if not seg:
                continue
            seg_block = _is_blocked(seg)
            if seg_block:
                return f"{seg_block} (in chained command)"

    # Absolute block patterns
    for pat in BLOCKED_PATTERNS:
        if pat in normalized:
            return f"Blocked: matches safety rule '{pat}'"

    # Check if command targets protected macOS system paths
    for ppath in PROTECTED_PATHS:
        lower_pp = ppath.lower()
        # Block writes to system paths (rm, mv, cp, chmod, chown, etc.)
        write_prefixes = [
            "rm ", "mv ", "cp ", "chmod ", "chown ", "touch ", "mkdir ",
            "rmdir ", "ln ", "install ",
        ]
        if any(normalized.startswith(prefix) and lower_pp in normalized
               for prefix in write_prefixes):
            return f"Blocked: cannot modify protected system path {ppath}"
        # Also check within piped commands (already handled above, but
        # catch any path reference in the full command)
        if any(prefix in normalized and lower_pp in normalized
               for prefix in write_prefixes):
            return f"Blocked: cannot modify protected system path {ppath}"
        # Block cd + destructive combos
        if f"cd {lower_pp}" in normalized and any(d in normalized for d in ["rm ", "mv ", "chmod "]):
            return f"Blocked: destructive operation in protected path {ppath}"

    return None


def _is_destructive(command: str) -> bool:
    """Check if a command is destructive (needs user awareness, but not blocked)."""
    normalized = command.strip().lower()
    return any(normalized.startswith(p) for p in DESTRUCTIVE_PREFIXES)


async def run_bash(command: str, timeout: int = 60) -> AsyncGenerator[tuple[str, str], None]:
    """Execute a shell command via a PTY, yielding (stream, text) tuples.

    Uses a pseudo-terminal so that programs which check isatty() behave
    normally (colored output, progress bars, Y/n prompts).
    Output is stripped of ANSI codes and capped at MAX_OUTPUT_BYTES.
    """
    block_reason = _is_blocked(command)
    if block_reason:
        yield ("stderr", f"{block_reason}\n")
        yield ("exit_code", "1")
        return

    if _is_destructive(command):
        yield ("stderr", f"Warning: destructive command detected. Proceeding with caution.\n")

    # Create PTY pair
    master_fd, slave_fd = pty.openpty()

    # Prevent interactive prompts from hanging the subprocess
    safe_env = {
        **os.environ,
        "GIT_EDITOR": "/bin/true",
        "EDITOR": "/bin/true",
        "VISUAL": "/bin/true",
        "GIT_TERMINAL_PROMPT": "0",
        "PAGER": "cat",
    }

    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            env=safe_env,
        )
    except Exception as e:
        os.close(master_fd)
        os.close(slave_fd)
        yield ("stderr", f"Failed to start process: {e}\n")
        return

    # Close slave in parent — the child process owns it now
    os.close(slave_fd)

    loop = asyncio.get_event_loop()
    total_bytes = 0
    truncated = False

    def _read_master() -> bytes:
        """Blocking read from master fd. Runs in executor."""
        try:
            return os.read(master_fd, 4096)
        except OSError as e:
            # EIO means the slave side closed (process exited on macOS)
            if e.errno == errno.EIO:
                return b""
            raise

    timed_out = False
    try:
        while True:
            try:
                data = await asyncio.wait_for(
                    loop.run_in_executor(None, _read_master),
                    timeout=timeout,
                )
            except asyncio.TimeoutError:
                yield ("stderr", f"Command timed out after {timeout}s\n")
                timed_out = True
                proc.kill()
                break
            except OSError:
                # PTY closed unexpectedly
                break

            if not data:
                break

            text = strip_ansi(data.decode(errors="replace"))
            total_bytes += len(text)

            if total_bytes > MAX_OUTPUT_BYTES and not truncated:
                yield ("stderr", f"\n[Output truncated at {MAX_OUTPUT_BYTES // 1024}KB]\n")
                truncated = True
            if not truncated:
                yield ("stdout", text)
    finally:
        try:
            os.close(master_fd)
        except OSError:
            pass
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        try:
            await proc.wait()
        except Exception:
            pass

    # Yield the real exit code so the supervisor can detect failures
    if timed_out:
        yield ("exit_code", "124")  # standard timeout exit code
    else:
        code = proc.returncode if proc.returncode is not None else -1
        yield ("exit_code", str(code))


async def read_file(file_path: str, max_lines: int = 300) -> dict:
    """Read a file safely and return its content with line numbers.

    Returns {file_path, content, lines, error}. If error is set, the
    file could not be read.
    """
    # Safety: block reads of system paths (resolve to catch traversal)
    blocked = _is_protected_path(file_path)
    if blocked:
        return {
            "file_path": file_path,
            "content": "",
            "lines": 0,
            "error": f"Blocked: cannot read files in protected path {blocked}",
        }

    p = Path(file_path)
    if not p.exists():
        return {
            "file_path": file_path,
            "content": "",
            "lines": 0,
            "error": f"File not found: {file_path}",
        }

    if not p.is_file():
        return {
            "file_path": file_path,
            "content": "",
            "lines": 0,
            "error": f"Not a regular file: {file_path}",
        }

    file_size = p.stat().st_size
    if file_size > MAX_EDIT_FILE_BYTES:
        return {
            "file_path": file_path,
            "content": "",
            "lines": 0,
            "error": f"File too large ({file_size // 1024} KB, max {MAX_EDIT_FILE_BYTES // 1024} KB). Use run_bash with head/tail to read portions.",
        }

    try:
        async with aiofiles.open(file_path, mode="r", errors="replace") as f:
            content = await f.read()
    except Exception as e:
        return {
            "file_path": file_path,
            "content": "",
            "lines": 0,
            "error": f"Failed to read: {e}",
        }

    all_lines = content.splitlines()
    total_lines = len(all_lines)

    # Cap output to max_lines to avoid blowing context
    if total_lines > max_lines:
        shown = "\n".join(
            f"{i+1:4d} | {line}" for i, line in enumerate(all_lines[:max_lines])
        )
        shown += f"\n[... {total_lines - max_lines} more lines, use run_bash with sed/head to see the rest]"
    else:
        shown = "\n".join(
            f"{i+1:4d} | {line}" for i, line in enumerate(all_lines)
        )

    return {
        "file_path": file_path,
        "content": shown,
        "lines": total_lines,
        "error": None,
    }


async def generate_edit_diff(file_path: str, new_content: str) -> dict:
    """Generate a unified diff for a file edit without writing to disk.

    Returns {file_path, old, new, diff}. Blocks writes to protected paths.
    Uses aiofiles to avoid blocking the event loop on file reads.
    """
    # Safety: block edits to system paths (resolve to catch traversal)
    blocked = _is_protected_path(file_path)
    if blocked:
        return {
            "file_path": file_path,
            "old": "",
            "new": "",
            "diff": f"Blocked: cannot edit files in protected path {blocked}",
        }

    p = Path(file_path)
    if p.exists():
        file_size = p.stat().st_size
        if file_size > MAX_EDIT_FILE_BYTES:
            return {
                "file_path": file_path,
                "old": "",
                "new": "",
                "diff": f"Blocked: file too large ({file_size // 1024} KB, max {MAX_EDIT_FILE_BYTES // 1024} KB). Use targeted patch commands instead.",
            }
        async with aiofiles.open(file_path, mode="r", errors="replace") as f:
            old_content = await f.read()
    else:
        old_content = ""

    old_lines = old_content.splitlines(keepends=True)
    new_lines = new_content.splitlines(keepends=True)

    diff = "".join(difflib.unified_diff(
        old_lines, new_lines,
        fromfile=f"a/{p.name}",
        tofile=f"b/{p.name}",
    ))

    return {
        "file_path": file_path,
        "old": old_content,
        "new": new_content,
        "diff": diff,
    }


async def apply_patch_content(file_path: str, search: str, replace: str) -> dict:
    """Apply a search/replace patch to a file.

    The search block must match exactly once in the file. Returns a dict with
    {file_path, old, new, diff, error}. If error is set, the patch was not
    valid (search not found, ambiguous match, etc.) and the file was NOT modified.
    """
    # Safety: block patches to system paths (resolve to catch traversal)
    blocked = _is_protected_path(file_path)
    if blocked:
        return {
            "file_path": file_path,
            "old": "",
            "new": "",
            "diff": "",
            "error": f"Blocked: cannot edit files in protected path {blocked}",
        }

    p = Path(file_path)
    if not p.exists():
        return {
            "file_path": file_path,
            "old": "",
            "new": "",
            "diff": "",
            "error": f"File not found: {file_path}. Use edit_file to create new files.",
        }

    file_size = p.stat().st_size
    if file_size > MAX_EDIT_FILE_BYTES:
        return {
            "file_path": file_path,
            "old": "",
            "new": "",
            "diff": "",
            "error": f"File too large ({file_size // 1024} KB, max {MAX_EDIT_FILE_BYTES // 1024} KB).",
        }

    async with aiofiles.open(file_path, mode="r", errors="replace") as f:
        old_content = await f.read()

    count = old_content.count(search)
    if count == 0:
        return {
            "file_path": file_path,
            "old": old_content,
            "new": "",
            "diff": "",
            "error": (
                "Search block not found in file. "
                "Re-read the file with run_bash to see the actual content, "
                "then try again with the exact text."
            ),
        }
    if count > 1:
        return {
            "file_path": file_path,
            "old": old_content,
            "new": "",
            "diff": "",
            "error": (
                f"Search block found {count} times. "
                "Include more surrounding context to make it unique."
            ),
        }

    new_content = old_content.replace(search, replace, 1)

    old_lines = old_content.splitlines(keepends=True)
    new_lines = new_content.splitlines(keepends=True)
    diff = "".join(difflib.unified_diff(
        old_lines, new_lines,
        fromfile=f"a/{p.name}",
        tofile=f"b/{p.name}",
    ))

    return {
        "file_path": file_path,
        "old": old_content,
        "new": new_content,
        "diff": diff,
        "error": None,
    }


async def apply_edit(file_path: str, new_content: str) -> bool:
    """Write new_content to file_path atomically. Only call after human approval.

    Uses a temp file + os.replace for POSIX-atomic writes.
    Runs the blocking I/O in an executor to avoid blocking the event loop.
    """
    # Safety: never write to system paths (resolve to catch traversal)
    blocked = _is_protected_path(file_path)
    if blocked:
        logger.error(f"Refused to write to protected path: {file_path} (resolves under {blocked})")
        return False

    def _write_atomic():
        p = Path(file_path)
        p.parent.mkdir(parents=True, exist_ok=True)

        fd, tmp_path = tempfile.mkstemp(dir=str(p.parent), suffix=".tmp")
        try:
            os.write(fd, new_content.encode())
            os.close(fd)
            os.replace(tmp_path, file_path)
        except Exception:
            try:
                os.close(fd)
            except OSError:
                pass
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
            raise

    try:
        await asyncio.to_thread(_write_atomic)
        logger.info(f"Applied edit to {file_path}")
        return True
    except Exception as e:
        logger.error(f"Failed to apply edit to {file_path}: {e}")
        return False


# --- Git tools ---

# Git commands the agent is NOT allowed to run
_BLOCKED_GIT_OPS = {"push", "reset", "clean", "rebase", "merge", "pull", "fetch", "remote"}


async def git_tool(subcommand: str, args: str = "") -> dict:
    """Run a safe git subcommand. Returns {output, error}."""
    sub = subcommand.strip().lower()
    if sub in _BLOCKED_GIT_OPS:
        return {"output": "", "error": f"Blocked: git {sub} is not allowed for safety"}

    # Also block --force/--hard flags
    full_args = f"{sub} {args}".strip()
    if "--force" in full_args or "--hard" in full_args:
        return {"output": "", "error": "Blocked: --force and --hard flags are not allowed"}

    cmd = f"git {full_args}"
    try:
        proc = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "PAGER": "cat"},
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        output = stdout.decode(errors="replace").strip()
        err = stderr.decode(errors="replace").strip()
        if proc.returncode != 0:
            return {"output": output, "error": err or f"git exited with code {proc.returncode}"}
        return {"output": output, "error": ""}
    except asyncio.TimeoutError:
        return {"output": "", "error": "git command timed out"}
    except Exception as e:
        return {"output": "", "error": str(e)}


async def check_broken_imports(file_path: str, old_content: str, new_content: str) -> str | None:
    """Check if an edit broke imports/exports that other files depend on.

    Looks for removed exports (Python: def/class, JS/TS: export) and
    greps the codebase for importers. Returns a warning string or None.
    """
    ext = Path(file_path).suffix.lower()
    removed_symbols = []

    if ext == ".py":
        # Find removed function/class definitions
        import re as _re
        old_defs = set(_re.findall(r'^(?:def|class)\s+(\w+)', old_content, _re.MULTILINE))
        new_defs = set(_re.findall(r'^(?:def|class)\s+(\w+)', new_content, _re.MULTILINE))
        removed_symbols = list(old_defs - new_defs)

    elif ext in (".ts", ".tsx", ".js", ".jsx"):
        import re as _re
        old_exports = set(_re.findall(r'export\s+(?:function|class|const|let|var|type|interface)\s+(\w+)', old_content))
        new_exports = set(_re.findall(r'export\s+(?:function|class|const|let|var|type|interface)\s+(\w+)', new_content))
        removed_symbols = list(old_exports - new_exports)

    if not removed_symbols:
        return None

    # Quick grep for importers
    warnings = []
    for sym in removed_symbols[:5]:  # limit to 5 symbols
        try:
            proc = await asyncio.create_subprocess_exec(
                "grep", "-rl", sym, ".", "--include=*.py", "--include=*.ts",
                "--include=*.tsx", "--include=*.js", "--include=*.jsx",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
            importers = [
                f for f in stdout.decode().strip().split("\n")
                if f and f != file_path and os.path.realpath(f) != os.path.realpath(file_path)
            ]
            if importers:
                warnings.append(f"'{sym}' removed but referenced in: {', '.join(importers[:3])}")
        except (asyncio.TimeoutError, Exception):
            continue

    return "\n".join(warnings) if warnings else None
