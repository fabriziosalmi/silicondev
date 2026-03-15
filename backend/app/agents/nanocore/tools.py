"""Tool implementations for the NanoCore agent."""

import asyncio
import difflib
import errno
import logging
import os
import pty
import re
import sys
import tempfile
from pathlib import Path
from typing import AsyncGenerator

import aiofiles
import json
import ast
from dataclasses import dataclass

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
    "rm ", "rm\t",
    "rmdir ",
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


import shlex


class ShellSanitizer:
    """Level 0: AST-inspired shell command verification."""
    
    BLOCKED_COMMANDS = {
        "mkfs", "dd", "shutdown", "reboot", "poweroff", "alias", "unalias"
    }
    
    # Phrases that should be blocked if they appear in any segment
    FORBIDDEN_PHRASES = [
        "rm -rf /", ":(){ :|:& };:", "> /dev/sda", "chmod -r 000 /"
    ]
    
    DANGEROUS_FILES = {
        "/etc/shadow", "/etc/passwd", "/etc/sudoers", "/dev/sda", "/dev/mem"
    }

    @classmethod
    def validate(cls, command: str) -> str | None:
        """Parses the command and returns a reason if blocked, else None."""
        normalized = command.strip().lower()
        
        # 1. Check for forbidden literal phrases first
        for phrase in cls.FORBIDDEN_PHRASES:
            if phrase in normalized:
                return f"Blocked: matches forbidden safety rule '{phrase}'."

        try:
            parts = shlex.split(command)
            if not parts:
                return None
                
            cmd = parts[0].lower()
            
            # Block base commands and their variations
            for blocked in cls.BLOCKED_COMMANDS:
                if cmd == blocked or cmd.startswith(blocked + "."):
                    return f"Blocked: base command '{cmd}' is restricted."
            
            # Check for binary execution attempts by path
            if cmd.startswith("/") or cmd.startswith("./") or cmd.startswith("../"):
                # Normalize path for check
                clean_cmd = os.path.normpath(cmd)
                if any(x in clean_cmd for x in ["/bin/", "/sbin/"]):
                    allowed = ["/bin/ls", "/bin/echo", "/bin/cat", "/usr/bin/git", "/usr/bin/python3", "/usr/bin/pip"]
                    if not any(clean_cmd.endswith(a) for a in allowed):
                        return f"Blocked: attempt to execute sensitive system binary '{cmd}'."

            # Check for dangerous file access in arguments
            for part in parts:
                for df in cls.DANGEROUS_FILES:
                    if df in part:
                        return f"Blocked: attempt to access protected system file '{df}'."
                
                # Check for recursive destruction attempt in args
                if part == "-rf" and "/" in parts:
                     # This catches 'rm -rf /' even if split
                     idx_rf = parts.index("-rf")
                     if idx_rf > 0 and parts[idx_rf-1] == "rm" and "/" in parts:
                         return "Blocked: recursive root destruction attempt."
            
            # Detect pipe chains and sub-shells
            if any(char in command for char in ['>', '<', '|', '&', ';', '`', '$']):
                # Simple check for nested execution bypasses
                if "$(" in command or "`" in command:
                    return "Blocked: sub-shell execution is restricted for security."
                
                # Block the common -exec recursive trick
                if "-exec" in parts and "rm" in parts:
                    return "Blocked: risky -exec operation detected."
                    
            return None
        except Exception as e:
            # If shlex fails, it might be an obfuscation attempt or just complex quoting
            return f"Validation Error (Possible Obfuscation): {str(e)}"


class DockerSandbox:
    """Level 2: Containerized execution for high-risk tools."""
    
    IMAGE = "python:3.11-slim" # Lightweight and safe
    
    @classmethod
    def wrap_command(cls, command: str, workspace_path: str) -> str:
        """Wraps a host command in a Docker run call with resource limits."""
        abs_workspace = os.path.abspath(workspace_path)
        # Sandbox parameters:
        # --rm: delete container after run
        # --net none: disable networking
        # --memory 256m: limit RAM
        # --cpus 0.5: limit CPU
        # -v: mount workspace as /workspace (Read/Write)
        # -w: set working directory
        
        # Escape command for shell
        escaped_cmd = shlex.quote(command)
        
        docker_cmd = f"docker run --rm --net none --memory 256m --cpus 0.5 " \
                     f"-v {abs_workspace}:/workspace -w /workspace {cls.IMAGE} " \
                     f"sh -c {escaped_cmd}"
        return docker_cmd


def _is_blocked(command: str) -> str | None:
    """Check if a command should be blocked. Returns reason or None."""
    # 1. Level 0 Sanitization (Formal Verification)
    sanitizer_reason = ShellSanitizer.validate(command)
    if sanitizer_reason:
        return sanitizer_reason

    normalized = command.strip().lower()

    # Legacy regex-based patterns (safety net)
    _shell_wrap = re.match(
        r"^(?:ba|da|z|k|c|tc|fi)?sh\s+-c\s+(?:[\"'](.+?)[\"']|(.+))\s*$", normalized
    )
    if _shell_wrap:
        inner = _shell_wrap.group(1) or _shell_wrap.group(2)
        inner_block = _is_blocked(inner)
        if inner_block:
            return f"{inner_block} (via shell -c wrapper)"

    segments = re.split(r'\s*(?:\|\||&&|[|;])\s*', normalized)
    if len(segments) > 1:
        for seg in segments:
            seg = seg.strip()
            if not seg:
                continue
            seg_block = _is_blocked(seg)
            if seg_block:
                return f"{seg_block} (in chained command)"

    for pat in BLOCKED_PATTERNS:
        if pat in normalized:
            return f"Blocked: matches safety rule '{pat}'"

    for ppath in PROTECTED_PATHS:
        lower_pp = ppath.lower()
        write_prefixes = [
            "rm ", "mv ", "cp ", "chmod ", "chown ", "touch ", "mkdir ",
            "rmdir ", "ln ", "install ",
        ]
        if any(normalized.startswith(prefix) and lower_pp in normalized
               for prefix in write_prefixes):
            return f"Blocked: cannot modify protected system path {ppath}"
        if any(prefix in normalized and lower_pp in normalized
               for prefix in write_prefixes):
            return f"Blocked: cannot modify protected system path {ppath}"
        if f"cd {lower_pp}" in normalized and any(d in normalized for d in ["rm ", "mv ", "chmod "]):
            return f"Blocked: destructive operation in protected path {ppath}"

    return None


def _is_destructive(command: str) -> bool:
    """Check if a command is destructive (needs user awareness, but not blocked)."""
    normalized = command.strip().lower()
    return any(normalized.startswith(p) for p in DESTRUCTIVE_PREFIXES)


async def run_bash(command: str, timeout: int = 60, sandbox_level: int = 0) -> AsyncGenerator[tuple[str, str], None]:
    """Execute a shell command via a PTY or Docker Sandbox.
    
    sandbox_level:
    0: Host PTY (Strict Sanitization only)
    1: Optional - Dry run simulation (TBD)
    2: Docker Micro-Sandbox (Isolated Container)
    """
    block_reason = _is_blocked(command)
    if block_reason:
        yield ("stderr", f"{block_reason}\n")
        yield ("exit_code", "1")
        return

    # Auto-escalate destructive commands to sandbox level 2 if supported
    if _is_destructive(command) and sandbox_level < 2:
         # For this implementation, we still prefer level 0 by default for speed,
         # but we log the capability.
         pass

    if sandbox_level >= 2:
        workspace = os.getcwd()
        command = DockerSandbox.wrap_command(command, workspace)
        yield ("stderr", f"Security: Executing in isolated Docker container...\n")
    elif _is_destructive(command):
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
            "error": f"File too large ({file_size // 1024} KB, max {MAX_EDIT_FILE_BYTES // 1024} KB).",
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

    if total_lines > max_lines:
        shown = "\n".join(
            f"{i+1:4d} | {line}" for i, line in enumerate(all_lines[:max_lines])
        )
        shown += f"\n[... {total_lines - max_lines} more lines]"
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


async def generate_codemap(root_dir: str) -> str:
    """Scan the codebase and generate a CODEMAP.md with Mermaid architecture diagram."""
    from app.codebase.chunker import TEXT_EXTENSIONS, _should_skip_dir

    def _do_generate():
        deps = {}  # module -> set(dependencies)
        root = Path(root_dir).resolve()

        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if not _should_skip_dir(d)]
            for fname in filenames:
                fpath = Path(dirpath) / fname
                if fpath.suffix not in (".py", ".js", ".ts", ".tsx"):
                    continue
                
                rel_path = fpath.relative_to(root)
                mod_name = str(rel_path).replace(os.sep, ".").replace(fpath.suffix, "")
                if mod_name not in deps:
                    deps[mod_name] = set()

                try:
                    content = fpath.read_text(errors="ignore")
                    if fpath.suffix == ".py":
                        tree = ast.parse(content)
                        for node in ast.walk(tree):
                            if isinstance(node, ast.Import):
                                for alias in node.names:
                                    deps[mod_name].add(alias.name.split(".")[0])
                            elif isinstance(node, ast.ImportFrom):
                                if node.module:
                                    deps[mod_name].add(node.module.split(".")[0])
                    else:
                        # Simple regex for JS/TS imports
                        imports = re.findall(r"from\s+['\"](.+?)['\"]", content)
                        imports += re.findall(r"import\s+['\"](.+?)['\"]", content)
                        for imp in imports:
                            if imp.startswith("."):
                                # Resolve relative import to "module" style
                                target = (rel_path.parent / imp).resolve()
                                try:
                                    imp_rel = target.relative_to(root)
                                    deps[mod_name].add(str(imp_rel).replace(os.sep, "."))
                                except ValueError:
                                    pass
                            else:
                                deps[mod_name].add(imp.split("/")[0])
                except Exception:
                    continue

        # Build Mermaid graph
        lines = ["# Codebase Architecture Map\n", "```mermaid", "graph TD"]
        # Filter only internal dependencies (those that exist as keys in deps)
        internal_mods = set(deps.keys())
        for mod, targets in deps.items():
            # Shorten module names for better graph readability
            short_mod = mod.split(".")[-1]
            for t in targets:
                # Check if t is an internal module or a sub-part of one
                is_internal = any(t == m or m.startswith(t + ".") for m in internal_mods)
                if is_internal and t != mod:
                    short_t = t.split(".")[-1]
                    lines.append(f"  {short_mod} --> {short_t}")

        lines.append("```\n")
        output_path = root / "CODEMAP.md"
        content = "\n".join(lines)
        
        with open(output_path, "w") as f:
            f.write(content)
        
        return f"Successfully generated architecture map at {output_path}"

    return await asyncio.to_thread(_do_generate)


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
    if not file_path or not file_path.strip():
        return {
            "file_path": file_path,
            "old": "",
            "new": "",
            "diff": "",
            "error": "Empty file path. Provide the full path to the file.",
        }

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
        # Try fuzzy match: normalize whitespace (strip trailing spaces per line)
        def _normalize_ws(text: str) -> str:
            return "\n".join(line.rstrip() for line in text.splitlines())

        norm_content = _normalize_ws(old_content)
        norm_search = _normalize_ws(search)
        fuzzy_count = norm_content.count(norm_search) if norm_search.strip() else 0

        if fuzzy_count == 1:
            # Fuzzy match succeeded — apply on normalized content, then reconstruct
            new_content = old_content  # We need to find the actual position
            # Find the matching region in normalized space, then map back
            norm_start = norm_content.index(norm_search)
            # Count newlines to find line-based position
            start_line = norm_content[:norm_start].count("\n")
            end_line = start_line + norm_search.count("\n")
            old_lines = old_content.splitlines(keepends=True)
            matched_text = "".join(old_lines[start_line:end_line + 1])
            new_content = old_content.replace(matched_text, replace, 1)

            old_lines_diff = old_content.splitlines(keepends=True)
            new_lines_diff = new_content.splitlines(keepends=True)
            diff = "".join(difflib.unified_diff(
                old_lines_diff, new_lines_diff,
                fromfile=f"a/{p.name}", tofile=f"b/{p.name}",
            ))
            return {
                "file_path": file_path,
                "old": old_content,
                "new": new_content,
                "diff": diff,
                "error": None,
            }

        # Show a snippet of the actual file to help the model correct itself
        preview_lines = old_content.splitlines()[:20]
        preview = "\n".join(f"  {i+1}: {line}" for i, line in enumerate(preview_lines))
        if len(old_content.splitlines()) > 20:
            preview += f"\n  ... ({len(old_content.splitlines()) - 20} more lines)"

        return {
            "file_path": file_path,
            "old": old_content,
            "new": "",
            "diff": "",
            "error": (
                "Search block not found in file. "
                "Use read_file to see the actual content, then copy the exact text "
                "you want to replace (including whitespace and indentation).\n"
                f"Actual file content:\n{preview}"
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


async def check_broken_imports(file_path: str, old_content: str = None, new_content: str = None) -> str | None:
    """Check if a file has broken imports or if an edit broke dependencies.
    
    If old_content and new_content are provided, it checks the diff.
    If only file_path is provided, it performs a static check on the current file.
    """
    ext = Path(file_path).suffix.lower()
    
    # 1. Background static check (Scout mode)
    if old_content is None or new_content is None:
        try:
            content = Path(file_path).read_text(errors="ignore")
            if ext == ".py":
                ast.parse(content) # Check syntax
            return None # Implementation placeholder for deeper background checks
        except SyntaxError as e:
            return f"Syntax error: {e}"
        except Exception:
            return None

    # 2. Patch verification mode (Supervisor mode)
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


async def execute_python_script(script_code: str, timeout: int = 15, air_gapped: bool = False) -> dict:
    """Executes a Python script in an isolated subprocess.
    If air_gapped is True, network access is theoretically disabled (via environment/mocks, or just logged as such
    since true air-gapping requires OS-level namespaces or sandboxing not uniformly available on macOS, 
    but we will drop standard proxy/network env vars just in case).
    """
    # Strip dangerous imports if air_gapped is strict (Best effort for this quick win)
    if air_gapped:
        blocked_imports = ["urllib", "requests", "http.client", "socket", "ftplib", "aiohttp", "httpx"]
        for bi in blocked_imports:
            if f"import {bi}" in script_code or f"from {bi}" in script_code:
                return {
                    "output": "",
                    "error": f"Security Error: Air-gapped mode is ENABLED. Import of '{bi}' is blocked."
                }
    
    # Write script to temporary file
    fd, tmp_path = tempfile.mkstemp(suffix=".py", prefix="nanocore_sandbox_")
    try:
        os.write(fd, script_code.encode("utf-8"))
        os.close(fd)
        
        env = os.environ.copy()
        if air_gapped:
            # Drop proxy environments to hinder unintentional network access
            env.pop("HTTP_PROXY", None)
            env.pop("HTTPS_PROXY", None)
            env.pop("http_proxy", None)
            env.pop("https_proxy", None)
            
        proc = await asyncio.create_subprocess_exec(
            sys.executable, tmp_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env
        )
        
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        output = stdout.decode("utf-8", errors="replace").strip()
        err = stderr.decode("utf-8", errors="replace").strip()
        
        if proc.returncode != 0:
            return {"output": output, "error": err or f"Process exited with code {proc.returncode}"}
        return {"output": output, "error": ""}
        
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except OSError:
            pass
        return {"output": "", "error": f"Execution timed out after {timeout} seconds."}
    except Exception as e:
        return {"output": "", "error": str(e)}
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
