"""Supervisor agent — orchestrates the tool-use loop and yields SSE events."""

import asyncio
import logging
import os
import re
import subprocess
import time
import uuid
from pathlib import Path
from typing import AsyncGenerator

from .types import AgentState, TrajectoryEntry
from .prompts import SYSTEM_PROMPT, REVIEW_MODE_PROMPT
from .parser import extract_tool_calls, has_partial_tool_tag, strip_tool_calls
from .tools import run_bash, read_file, generate_edit_diff, apply_edit, apply_patch_content, git_tool, check_broken_imports
from .validators import validate_content, detect_lazy_edit, run_lint_check, scan_security, scan_performance
from .guardrails import LoopGuardrails
from .context import ContextManager, count_tokens
from .repomap import RepoMapCache
from .process_manager import ProcessManager

logger = logging.getLogger(__name__)

# Strip <think>...</think> blocks and any leftover tags from model output
_THINK_RE = re.compile(r'<think>.*?</think>', re.DOTALL)
_THINK_OPEN_RE = re.compile(r'</?think[^>]*>')

# Max chars of tool output to inject back into the conversation
MAX_TOOL_OUTPUT_CHARS = 4000
# Max seconds to wait for diff approval before auto-rejecting
MAX_APPROVAL_WAIT_SECS = 300  # 5 minutes
# Self-healing: max consecutive bash failures before giving up
MAX_AUTO_RETRIES = 3


def _strip_think_tags(text: str) -> str:
    """Remove <think>...</think> blocks and stray tags from model output."""
    text = _THINK_RE.sub('', text)
    text = _THINK_OPEN_RE.sub('', text)
    return text.strip()


def _truncate(text: str, max_chars: int = MAX_TOOL_OUTPUT_CHARS) -> str:
    """Truncate text, adding a marker if truncated."""
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + f"\n[...truncated, {len(text) - max_chars} chars omitted]"


def _sse(event: str, data: dict) -> dict:
    """Wrap an event into the SSE envelope format."""
    return {"event": event, "data": data}


def _git_snapshot(working_dir: str) -> str | None:
    """Create a git stash snapshot of the working tree.

    Uses `git stash create` which creates a stash commit without modifying
    the working tree or index. Returns the stash ref (SHA), or None if
    the directory is not a git repo or there's nothing to snapshot.
    """
    try:
        result = subprocess.run(
            ["git", "stash", "create", "nanocore-pre-session"],
            cwd=working_dir,
            capture_output=True,
            text=True,
            timeout=10,
        )
        sha = result.stdout.strip()
        if sha:
            # Store the ref so it won't be garbage-collected
            subprocess.run(
                ["git", "stash", "store", "-m", "nanocore-pre-session", sha],
                cwd=working_dir,
                capture_output=True,
                timeout=10,
            )
            logger.info(f"Git snapshot created: {sha[:12]}")
            return sha
        # Empty output means no changes to snapshot (clean tree)
        return None
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None


class SupervisorAgent:
    """Runs a multi-turn agent loop, yielding SSE-formatted dicts."""

    def __init__(
        self,
        session_id: str,
        model_id: str,
        max_iterations: int = 10,
        temperature: float = 0.3,
        max_total_tokens: int = 50_000,
        mode: str = "edit",
        workspace_dir: str | None = None,
    ):
        self.session_id = session_id
        self.model_id = model_id
        self.max_iterations = max_iterations
        self.temperature = temperature
        self.mode = mode  # "edit" or "review"
        self.workspace_dir = workspace_dir

        self._state = AgentState.thinking
        self._stopped = False
        self._pending_diffs: dict[str, dict] = {}  # call_id -> {event, approved, diff_info}
        self._pending_escalations: dict[str, dict] = {}  # esc_id -> {event, user_message}
        self._trajectory: list[TrajectoryEntry] = []
        self._total_tokens = 0
        self._start_time = 0.0

        # Edit history for undo support (list of {file_path, old_content, new_content})
        self._edit_history: list[dict] = []

        # Self-healing loop state
        self._consecutive_bash_failures = 0
        self._last_failed_stderr = ""

        # Fix 2: guardrails
        self.guardrails = LoopGuardrails(max_total_tokens=max_total_tokens)
        # Context manager — scale to model's context window (default 16K)
        self._context_mgr = ContextManager(max_context_tokens=16000)
        # Fix 3: process manager
        self.process_manager = ProcessManager()

    def stop(self):
        """Signal the agent to stop after current iteration."""
        self._stopped = True
        # Stop any active MLX generation
        try:
            from app.api.engine import service as engine_service
            engine_service.stop_generation()
        except Exception:
            pass
        # Schedule background process cleanup
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(self.process_manager.cleanup_all())
        except Exception:
            pass

    def resolve_diff(self, call_id: str, approved: bool, reason: str = "") -> bool:
        """Resolve a pending diff decision. Returns False if call_id not found."""
        pending = self._pending_diffs.get(call_id)
        if not pending:
            return False
        pending["approved"] = approved
        pending["reason"] = reason
        pending["event"].set()
        return True

    def resolve_escalation(self, escalation_id: str, user_message: str) -> bool:
        """Resolve a pending human escalation. Returns False if not found."""
        pending = self._pending_escalations.get(escalation_id)
        if not pending:
            return False
        pending["user_message"] = user_message
        pending["event"].set()
        return True

    async def undo_last(self) -> dict:
        """Undo the last approved edit. Returns {file_path, ok, error}."""
        if not self._edit_history:
            return {"file_path": "", "ok": False, "error": "Nothing to undo"}
        entry = self._edit_history.pop()
        file_path = entry["file_path"]
        old_content = entry["old_content"]
        try:
            ok = await apply_edit(file_path, old_content)
            return {"file_path": file_path, "ok": ok, "error": "" if ok else "Failed to write file"}
        except Exception as e:
            return {"file_path": file_path, "ok": False, "error": str(e)}

    def _step_label(self, label: str, iteration: int) -> dict:
        """Build a step_label SSE event with progress info."""
        budget_pct = round(self.guardrails.budget_fraction() * 100)
        return _sse("step_label", {
            "label": label,
            "iteration": iteration,
            "max_iterations": self.max_iterations,
            "budget_pct": budget_pct,
        })

    def _telemetry_data(self, iteration: int) -> dict:
        """Build a telemetry_update data payload."""
        return {
            "agent": "supervisor",
            "state": self._state.value,
            "tokens_used": self.guardrails.total_tokens,
            "elapsed_ms": (time.time() - self._start_time) * 1000,
            "iteration": iteration,
            "token_budget": self.guardrails.max_total_tokens,
            "budget_fraction": self.guardrails.budget_fraction(),
        }

    async def _wait_for_diff_approval(self, call_id: str, iteration: int):
        """Wait for human diff approval. Yields heartbeat telemetry events.

        Returns an async generator of SSE events to yield, plus sets the
        result on self._pending_diffs[call_id].
        This is an async generator (not a plain coroutine) because the
        caller needs to yield heartbeats during the wait.
        """
        event = asyncio.Event()
        self._pending_diffs[call_id] = {
            "event": event,
            "approved": False,
        }

        self._state = AgentState.waiting_human_approval
        yield _sse("telemetry_update", self._telemetry_data(iteration))

        wait_start = time.time()
        timed_out = False
        while not event.is_set():
            if self._stopped:
                break
            if time.time() - wait_start > MAX_APPROVAL_WAIT_SECS:
                timed_out = True
                break
            try:
                await asyncio.wait_for(event.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                yield _sse("telemetry_update", self._telemetry_data(iteration))

        if timed_out:
            self._pending_diffs[call_id]["timed_out"] = True
        if self._stopped:
            self._pending_diffs[call_id]["stopped"] = True

    def _consume_diff_result(self, call_id: str) -> tuple[bool | None, str]:
        """Read and clean up a pending diff result.

        Returns (approved, reason). approved is None if stopped or timed out.
        """
        pending = self._pending_diffs.pop(call_id, {})
        if pending.get("stopped"):
            return None, "Session stopped"
        if pending.get("timed_out"):
            return None, f"Auto-rejected: no response within {MAX_APPROVAL_WAIT_SECS}s"
        return pending.get("approved", False), pending.get("reason", "")

    async def _wait_for_human_escalation(self, escalation_id: str, reason: str, iteration: int):
        """Pause the agent loop and wait for user guidance.

        Emits a human_escalation SSE event, then blocks until the user
        responds via resolve_escalation(). Yields heartbeat telemetry
        while waiting.
        """
        event = asyncio.Event()
        self._pending_escalations[escalation_id] = {
            "event": event,
            "user_message": "",
        }

        self._state = AgentState.waiting_human_approval
        yield _sse("human_escalation", {
            "escalation_id": escalation_id,
            "reason": reason,
            "consecutive_errors": self.guardrails._consecutive_same,
        })
        yield _sse("telemetry_update", self._telemetry_data(iteration))

        wait_start = time.time()
        while not event.is_set():
            if self._stopped:
                break
            if time.time() - wait_start > MAX_APPROVAL_WAIT_SECS:
                break
            try:
                await asyncio.wait_for(event.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                yield _sse("telemetry_update", self._telemetry_data(iteration))

    def _consume_escalation_result(self, escalation_id: str) -> str | None:
        """Read and clean up a pending escalation result.

        Returns the user's message, or None if stopped/timed out.
        """
        pending = self._pending_escalations.pop(escalation_id, {})
        if self._stopped:
            return None
        return pending.get("user_message") or None

    async def run(self, prompt: str, history: list[dict] | None = None, active_file_path: str | None = None) -> AsyncGenerator[dict, None]:
        """Main agent loop. Yields SSE event dicts."""
        # Lazy import to avoid circular imports at module level
        from app.api.engine import service as engine_service

        self._start_time = time.time()

        # Use workspace dir if provided, otherwise fall back to backend CWD
        cwd = self.workspace_dir or os.getcwd()
        if self.workspace_dir:
            os.chdir(cwd)
            logger.info(f"Agent workspace: {cwd}")

        # Fix 38: snapshot working tree before agent starts
        snapshot_ref = _git_snapshot(cwd)
        snapshot_info = {}
        if snapshot_ref:
            snapshot_info["git_snapshot"] = snapshot_ref[:12]

        yield _sse("session_start", {"session_id": self.session_id, **snapshot_info})

        # Fix 4: repo map cache (Fix 32: refreshes when files change)
        repo_map_cache = RepoMapCache(cwd)
        repo_map = repo_map_cache.get()
        base_prompt = REVIEW_MODE_PROMPT if self.mode == "review" else SYSTEM_PROMPT

        # Suppress reasoning for models that support /no_think (e.g. Qwen3)
        # This dramatically speeds up agentic loops by avoiding wasted think tokens.
        no_think_suffix = ""
        model_lower = self.model_id.lower()
        if any(k in model_lower for k in ("qwen", "deepseek")):
            no_think_suffix = "\n\n/no_think"

        env_lines = [f"Working directory: {cwd}"]
        if active_file_path:
            env_lines.append(f"Active file (open in editor): {active_file_path}")
            env_lines.append(f"IMPORTANT: When the user asks to modify a file, use this path: {active_file_path}")
        system_content = base_prompt + "\n\n## Environment\n\n" + "\n".join(env_lines) + "\n"
        if repo_map:
            system_content += f"\n\n## Repository Map\n\n{repo_map}\n"

        # Smart file discovery: only for non-trivial prompts (>30 chars, not simple create/write)
        _SIMPLE_PROMPT_RE = re.compile(r'^(create|write|make|add|generate)\s+(a\s+)?(simple|basic|new|empty)?\s*\w+', re.IGNORECASE)
        if len(prompt) > 30 and not _SIMPLE_PROMPT_RE.match(prompt):
            try:
                from app.codebase.service import codebase_service
                relevant = codebase_service.search(prompt, top_k=5)
                if relevant:
                    ctx_lines = ["## Relevant Context (auto-discovered)\n"]
                    for r in relevant:
                        header = f"--- {r.file_path}:{r.start_line}-{r.end_line}"
                        if r.symbol:
                            header += f" ({r.kind}: {r.symbol})"
                        ctx_lines.append(f"{header}\n{r.content[:500]}")
                    system_content += "\n" + "\n\n".join(ctx_lines) + "\n"
            except Exception:
                pass  # codebase may not be indexed

        system_content += no_think_suffix

        messages = [
            {"role": "system", "content": system_content},
        ]

        # Inject conversation history (prior turns) for multi-turn memory
        if history:
            for turn in history:
                messages.append({"role": turn["role"], "content": turn["content"]})

        messages.append({"role": "user", "content": prompt})

        iteration = 0
        consecutive_no_tool = 0  # track iterations with no tool calls

        for iteration in range(1, self.max_iterations + 1):
            iter_start = time.time()
            if self._stopped:
                break

            # Fix 2: check token budget before each iteration
            if self.guardrails.is_over_budget():
                yield _sse("budget_exhausted", {
                    "total_tokens": self._total_tokens,
                    "budget": self.guardrails.max_total_tokens,
                })
                yield _sse("token_stream", {
                    "agent": "supervisor",
                    "text": "\n\nI've used my full token budget. Stopping here — you can continue with a new prompt if needed.",
                })
                break

            self._state = AgentState.thinking
            yield self._step_label("Thinking...", iteration)
            yield _sse("telemetry_update", self._telemetry_data(iteration))

            # Refresh repo map only if files changed (invalidated by edit)
            if repo_map_cache.is_dirty():
                fresh_map = repo_map_cache.get()
                updated_system = base_prompt + f"\n\n## Environment\n\nWorking directory: {cwd}\n"
                if fresh_map:
                    updated_system += f"\n\n## Repository Map\n\n{fresh_map}\n"
                updated_system += no_think_suffix
                messages[0] = {"role": "system", "content": updated_system}

            # Fix 4: fit messages into context window
            fitted_messages = self._context_mgr.fit_messages(messages)

            # --- Generate from model ---
            accumulated = ""
            streamed_up_to = 0
            iter_tokens = 0
            in_think_block = False
            think_buffer = ""

            try:
                async for chunk in engine_service.generate_stream(
                    self.model_id,
                    fitted_messages,
                    temperature=self.temperature,
                    max_tokens=4096,
                ):
                    if self._stopped:
                        engine_service.stop_generation()
                        break
                    if "error" in chunk:
                        yield _sse("error", {"message": chunk["error"]})
                        return
                    if "text" in chunk:
                        token_text = chunk["text"]
                        accumulated += token_text
                        iter_tokens += 1

                        # Handle <think> blocks: buffer them and don't stream
                        if in_think_block:
                            think_buffer += token_text
                            if "</think>" in think_buffer:
                                in_think_block = False
                                # Extract thinking content and send as a separate event
                                parts = think_buffer.split("</think>", 1)
                                think_content = parts[0].replace("<think>", "").strip()
                                if think_content:
                                    yield _sse("thinking", {"agent": "supervisor", "content": think_content})
                                # Text after </think> must not be lost
                                after_think = parts[1] if len(parts) > 1 else ""
                                streamed_up_to = len(accumulated) - len(after_think)
                                think_buffer = ""
                                # Fall through to stream any text after </think>
                                if not after_think:
                                    continue
                            else:
                                continue

                        if "<think>" in accumulated[streamed_up_to:]:
                            in_think_block = True
                            before_think = accumulated[streamed_up_to:].split("<think>")[0]
                            if before_think:
                                yield _sse("token_stream", {"agent": "supervisor", "text": before_think})
                            streamed_up_to = len(accumulated)
                            think_buffer = token_text
                            continue

                        # Stream text but suppress partial/complete tool tags
                        if not has_partial_tool_tag(accumulated):
                            new_text = accumulated[streamed_up_to:]
                            if new_text:
                                display_text = strip_tool_calls(new_text)
                                if display_text:
                                    yield _sse("token_stream", {"agent": "supervisor", "text": display_text})
                                streamed_up_to = len(accumulated)
            except Exception as e:
                yield _sse("error", {"message": str(e)})
                return

            # Fix 2: track tokens for generation
            self._total_tokens += iter_tokens
            self.guardrails.add_tokens(count_tokens(accumulated))

            # Diagnostic: log the first 200 chars of raw model output for debugging
            if accumulated:
                logger.debug(f"Model output (iter {iteration}, {iter_tokens} tokens): {repr(accumulated[:200])}")

            # Clean the accumulated text: remove think blocks before parsing
            cleaned = _strip_think_tags(accumulated)

            # --- Parse tool calls ---
            tool_calls = extract_tool_calls(cleaned)

            if not tool_calls:
                consecutive_no_tool += 1
                clean_remaining = _strip_think_tags(accumulated[streamed_up_to:])
                clean_remaining = strip_tool_calls(clean_remaining, strip_whitespace=True)
                if clean_remaining:
                    yield _sse("token_stream", {"agent": "supervisor", "text": clean_remaining})

                # If 2+ iterations with no tool calls, nudge the model to act
                if consecutive_no_tool >= 2 and iteration < self.max_iterations:
                    messages.append({"role": "assistant", "content": cleaned})
                    messages.append({
                        "role": "user",
                        "content": "[SYSTEM] You are not using your tools. You MUST use tools (patch_file, read_file, run_bash) to make changes. Do not just describe what to do — use a tool now.",
                    })
                    continue
                break

            # --- Execute tool calls ---
            self._state = AgentState.tool_calling
            consecutive_no_tool = 0  # reset — model used tools
            tool_results = []

            # Tools blocked in review mode
            _REVIEW_BLOCKED = {"edit_file", "patch_file", "run_bash"}

            for tc in tool_calls:
                if self._stopped:
                    break

                call_id = str(uuid.uuid4())[:8]
                logger.info(f"Tool call: {tc.name} (iter {iteration}/{self.max_iterations}, session={self.session_id})")

                # Block write tools in review mode
                if self.mode == "review" and tc.name in _REVIEW_BLOCKED:
                    tool_results.append(f"[{tc.name}] Blocked: review mode is read-only. Use read_file or search_codebase instead.")
                    continue

                if tc.name == "run_bash":
                    command = tc.args.get("command", "")
                    background = tc.args.get("background", "").lower() in ("true", "1", "yes")

                    # Step label for UI
                    cmd_preview = command.split()[0] if command.split() else command
                    yield self._step_label(f"Running {cmd_preview}...", iteration)

                    # Fix 3: background process support
                    if background:
                        yield _sse("tool_start", {"tool": "run_bash", "args": {"command": command, "background": True}, "call_id": call_id})
                        try:
                            proc_id, mp = await self.process_manager.spawn(command)
                            # Give it a moment to start and produce initial output
                            await asyncio.sleep(0.5)
                            initial = self.process_manager.read_output(proc_id, last_n=10)
                            initial_text = "\n".join(initial) if initial else "(started, no output yet)"
                            yield _sse("tool_log", {"call_id": call_id, "stream": "stdout", "text": f"[background {proc_id}] {initial_text}\n"})
                            yield _sse("tool_done", {"call_id": call_id, "exit_code": 0})
                            tool_results.append(f"[bash background] Started as {proc_id}. Use read_output to check output, kill_process to stop.")
                        except Exception as e:
                            yield _sse("tool_log", {"call_id": call_id, "stream": "stderr", "text": str(e)})
                            yield _sse("tool_done", {"call_id": call_id, "exit_code": 1})
                            tool_results.append(f"[bash background] Failed: {e}")
                    else:
                        yield _sse("tool_start", {"tool": "run_bash", "args": {"command": command}, "call_id": call_id})

                        output_lines = []
                        exit_code = 0
                        async for stream, text in run_bash(command):
                            if stream == "exit_code":
                                exit_code = int(text)
                                continue
                            yield _sse("tool_log", {"call_id": call_id, "stream": stream, "text": text})
                            output_lines.append(text)

                        yield _sse("tool_done", {"call_id": call_id, "exit_code": exit_code})

                        raw_output = "".join(output_lines)
                        tool_results.append(f"[bash output]\n{_truncate(raw_output)}")

                        # --- Self-Healing Loop ---
                        if exit_code != 0:
                            self._consecutive_bash_failures += 1
                            self._last_failed_stderr = raw_output[-2000:]  # keep last 2k chars
                            attempt = self._consecutive_bash_failures

                            if attempt <= MAX_AUTO_RETRIES:
                                yield _sse("auto_retry", {
                                    "attempt": attempt,
                                    "max_attempts": MAX_AUTO_RETRIES,
                                    "command": command[:200],
                                    "status": "retrying",
                                })
                                tool_results.append(
                                    f"[SELF-HEAL] The command exited with code {exit_code} "
                                    f"(attempt {attempt}/{MAX_AUTO_RETRIES}). "
                                    f"Analyze the error output above, fix the source code that caused the failure, "
                                    f"then re-run the same command to verify your fix."
                                )
                            else:
                                yield _sse("auto_retry", {
                                    "attempt": attempt,
                                    "max_attempts": MAX_AUTO_RETRIES,
                                    "command": command[:200],
                                    "status": "exhausted",
                                })
                                tool_results.append(
                                    f"[SELF-HEAL] Failed {attempt} times. Stop retrying. "
                                    f"Summarize the root cause and what you tried."
                                )

                            # Fix 2: also feed into guardrails error tracking
                            self.guardrails.record_error(raw_output)
                            if self.guardrails.is_stuck_on_same_error():
                                esc_id = str(uuid.uuid4())[:8]
                                async for evt in self._wait_for_human_escalation(
                                    esc_id,
                                    f"Same error {self.guardrails._consecutive_same} times in a row",
                                    iteration,
                                ):
                                    yield evt
                                user_msg = self._consume_escalation_result(esc_id)
                                if user_msg:
                                    tool_results.append(
                                        f"[SYSTEM] User guidance: {user_msg}\n"
                                        "Follow the user's instructions to resolve this."
                                    )
                                elif self._stopped:
                                    break
                                else:
                                    tool_results.append(self.guardrails.rubber_duck_message())
                        else:
                            # Success — reset self-healing counter
                            if self._consecutive_bash_failures > 0:
                                yield _sse("auto_retry", {
                                    "attempt": self._consecutive_bash_failures,
                                    "max_attempts": MAX_AUTO_RETRIES,
                                    "command": command[:200],
                                    "status": "resolved",
                                })
                            self._consecutive_bash_failures = 0
                            self._last_failed_stderr = ""

                        self._trajectory.append(TrajectoryEntry(
                            agent="supervisor", action="run_bash",
                            input=command, output=raw_output[:500],
                            tokens=iter_tokens,
                        ))

                elif tc.name == "read_file":
                    file_path = tc.args.get("path", "")
                    fname = Path(file_path).name if file_path else "file"
                    yield self._step_label(f"Reading {fname}...", iteration)
                    max_lines = 300
                    try:
                        max_lines = int(tc.args.get("max_lines", "300"))
                    except (ValueError, TypeError):
                        pass

                    yield _sse("tool_start", {"tool": "read_file", "args": {"path": file_path}, "call_id": call_id})

                    result = await read_file(file_path, max_lines=max_lines)
                    if result["error"]:
                        yield _sse("tool_log", {"call_id": call_id, "stream": "stderr", "text": result["error"]})
                        yield _sse("tool_done", {"call_id": call_id, "exit_code": 1})
                        tool_results.append(f"[read_file] Error: {result['error']}")
                    else:
                        yield _sse("tool_log", {"call_id": call_id, "stream": "stdout", "text": f"({result['lines']} lines)\n"})
                        yield _sse("tool_done", {"call_id": call_id, "exit_code": 0})
                        tool_results.append(f"[read_file {file_path}] ({result['lines']} lines)\n{_truncate(result['content'])}")

                elif tc.name == "edit_file":
                    file_path = tc.args.get("path", "")
                    new_content = tc.args.get("content", "")
                    fname = Path(file_path).name if file_path else "file"
                    yield self._step_label(f"Writing {fname}...", iteration)

                    # Guard: redirect to patch_file for existing files
                    if Path(file_path).exists():
                        tool_results.append(
                            f"[edit_file] Warning: {file_path} already exists. "
                            "Use patch_file for surgical edits to existing files. "
                            "edit_file will rewrite the entire file — only use it if you truly need a full rewrite."
                        )

                    # Fix 5: validate before generating diff
                    lazy_err = detect_lazy_edit(new_content)
                    if lazy_err:
                        tool_results.append(f"[edit_file] Rejected: {lazy_err}. Write the complete file content.")
                        continue

                    validation_err = await validate_content(file_path, new_content)
                    if validation_err:
                        tool_results.append(f"[edit_file] Validation failed: {validation_err}")
                        self.guardrails.record_fix_attempt(file_path)
                        if self.guardrails.is_over_fix_limit(file_path):
                            tool_results.append(self.guardrails.fix_limit_message(file_path))
                        continue

                    diff_info = await generate_edit_diff(file_path, new_content)

                    # Check if blocked
                    if diff_info["diff"].startswith("Blocked:"):
                        yield _sse("error", {"message": diff_info["diff"]})
                        tool_results.append(f"[edit_file] {diff_info['diff']}")
                        continue

                    yield _sse("diff_proposal", {
                        "call_id": call_id,
                        "file_path": diff_info["file_path"],
                        "old": diff_info["old"],
                        "new": diff_info["new"],
                        "diff": diff_info["diff"],
                    })

                    # Wait for human decision
                    async for heartbeat in self._wait_for_diff_approval(call_id, iteration):
                        yield heartbeat

                    approved, reason = self._consume_diff_result(call_id)
                    if approved is None:
                        # stopped or timed out
                        tool_results.append(f"[edit_file] {reason}")
                        if reason == "Session stopped":
                            break
                        continue

                    if approved:
                        # Track for undo
                        self._edit_history.append({
                            "file_path": file_path,
                            "old_content": diff_info["old"],
                            "new_content": new_content,
                        })
                        await apply_edit(file_path, new_content)
                        tool_results.append(f"[edit_file] Applied changes to {file_path}")
                        repo_map_cache.invalidate()
                        # Post-edit lint check
                        lint_err = await run_lint_check(file_path)
                        if lint_err:
                            yield _sse("lint_result", {"file_path": file_path, "errors": lint_err})
                            tool_results.append(f"[lint] Issues in {file_path}:\n{lint_err}\nFix these issues.")
                        # Dependency check
                        dep_warn = await check_broken_imports(file_path, diff_info["old"], new_content)
                        if dep_warn:
                            tool_results.append(f"[dependency] Warning:\n{dep_warn}\nCheck these files for broken references.")
                        # Security + performance scans
                        sec_warns = scan_security(new_content)
                        if sec_warns:
                            tool_results.append("\n".join(sec_warns) + "\nReview and fix security issues above.")
                        perf_hints = scan_performance(new_content)
                        if perf_hints:
                            tool_results.append("\n".join(perf_hints))
                    else:
                        msg = f"[edit_file] User rejected changes to {file_path}"
                        if reason:
                            msg += f" — reason: {reason}"
                        tool_results.append(msg)

                    self._trajectory.append(TrajectoryEntry(
                        agent="supervisor", action="edit_file",
                        input=file_path,
                        output="approved" if approved else "rejected",
                    ))

                elif tc.name == "patch_file":
                    # Fix 1: surgical search/replace edits
                    file_path = tc.args.get("path", "")
                    fname = Path(file_path).name if file_path else "file"
                    yield self._step_label(f"Editing {fname}...", iteration)
                    search = tc.args.get("search", "")
                    replace = tc.args.get("replace", "")

                    # Fix 5: check for lazy placeholders in the replacement
                    lazy_err = detect_lazy_edit(replace)
                    if lazy_err:
                        tool_results.append(f"[patch_file] Rejected: {lazy_err}. Write the complete replacement text.")
                        continue

                    yield _sse("tool_start", {"tool": "patch_file", "args": {"path": file_path}, "call_id": call_id})

                    patch_result = await apply_patch_content(file_path, search, replace)

                    if patch_result["error"]:
                        yield _sse("tool_done", {"call_id": call_id, "exit_code": 1})
                        tool_results.append(f"[patch_file] Error: {patch_result['error']}")
                        self.guardrails.record_fix_attempt(file_path)
                        if self.guardrails.is_over_fix_limit(file_path):
                            tool_results.append(self.guardrails.fix_limit_message(file_path))
                        continue

                    # Fix 5: validate the result before proposing
                    new_content = patch_result["new"]
                    validation_err = await validate_content(file_path, new_content)
                    if validation_err:
                        yield _sse("tool_done", {"call_id": call_id, "exit_code": 1})
                        tool_results.append(f"[patch_file] Validation failed: {validation_err}")
                        self.guardrails.record_fix_attempt(file_path)
                        if self.guardrails.is_over_fix_limit(file_path):
                            tool_results.append(self.guardrails.fix_limit_message(file_path))
                        continue

                    yield _sse("tool_done", {"call_id": call_id, "exit_code": 0})

                    # Show diff to user for approval
                    yield _sse("diff_proposal", {
                        "call_id": call_id,
                        "file_path": patch_result["file_path"],
                        "old": patch_result["old"],
                        "new": patch_result["new"],
                        "diff": patch_result["diff"],
                    })

                    async for heartbeat in self._wait_for_diff_approval(call_id, iteration):
                        yield heartbeat

                    approved, reason = self._consume_diff_result(call_id)
                    if approved is None:
                        tool_results.append(f"[patch_file] {reason}")
                        if reason == "Session stopped":
                            break
                        continue

                    if approved:
                        # Track for undo
                        self._edit_history.append({
                            "file_path": file_path,
                            "old_content": patch_result["old"],
                            "new_content": new_content,
                        })
                        await apply_edit(file_path, new_content)
                        tool_results.append(f"[patch_file] Applied patch to {file_path}")
                        repo_map_cache.invalidate()
                        # Post-edit lint check
                        lint_err = await run_lint_check(file_path)
                        if lint_err:
                            yield _sse("lint_result", {"file_path": file_path, "errors": lint_err})
                            tool_results.append(f"[lint] Issues in {file_path}:\n{lint_err}\nFix these issues.")
                        # Dependency check
                        dep_warn = await check_broken_imports(file_path, patch_result["old"], new_content)
                        if dep_warn:
                            tool_results.append(f"[dependency] Warning:\n{dep_warn}\nCheck these files for broken references.")
                        # Security + performance scans
                        sec_warns = scan_security(new_content)
                        if sec_warns:
                            tool_results.append("\n".join(sec_warns) + "\nReview and fix security issues above.")
                        perf_hints = scan_performance(new_content)
                        if perf_hints:
                            tool_results.append("\n".join(perf_hints))
                    else:
                        msg = f"[patch_file] User rejected patch to {file_path}"
                        if reason:
                            msg += f" — reason: {reason}"
                        tool_results.append(msg)

                    self._trajectory.append(TrajectoryEntry(
                        agent="supervisor", action="patch_file",
                        input=file_path,
                        output="approved" if approved else "rejected",
                    ))

                elif tc.name == "read_output":
                    # Fix 3: read background process output
                    proc_id = tc.args.get("proc_id", "")
                    yield _sse("tool_start", {"tool": "read_output", "args": {"proc_id": proc_id}, "call_id": call_id})

                    lines = self.process_manager.read_output(proc_id)
                    output = "\n".join(lines)
                    yield _sse("tool_log", {"call_id": call_id, "stream": "stdout", "text": output})
                    yield _sse("tool_done", {"call_id": call_id, "exit_code": 0})
                    tool_results.append(f"[read_output {proc_id}]\n{_truncate(output)}")

                elif tc.name == "kill_process":
                    # Fix 3: kill background process
                    proc_id = tc.args.get("proc_id", "")
                    yield _sse("tool_start", {"tool": "kill_process", "args": {"proc_id": proc_id}, "call_id": call_id})

                    result = await self.process_manager.kill(proc_id)
                    yield _sse("tool_log", {"call_id": call_id, "stream": "stdout", "text": result})
                    yield _sse("tool_done", {"call_id": call_id, "exit_code": 0})
                    tool_results.append(f"[kill_process] {result}")

                elif tc.name == "search_codebase":
                    query = tc.args.get("query", "")
                    yield self._step_label("Searching codebase...", iteration)
                    yield _sse("tool_start", {"tool": "search_codebase", "args": {"query": query}, "call_id": call_id})

                    try:
                        from app.codebase.service import codebase_service
                        results = codebase_service.search(query, top_k=8)
                        if results:
                            formatted = []
                            for r in results:
                                header = f"--- {r.file_path}:{r.start_line}-{r.end_line}"
                                if r.symbol:
                                    header += f" ({r.kind}: {r.symbol})"
                                formatted.append(f"{header}\n{r.content}")
                            output = "\n\n".join(formatted)
                        else:
                            output = "No results found. The codebase may not be indexed yet."
                        yield _sse("tool_log", {"call_id": call_id, "stream": "stdout", "text": output})
                        yield _sse("tool_done", {"call_id": call_id, "exit_code": 0})
                        tool_results.append(f"[search_codebase]\n{_truncate(output)}")
                    except Exception as e:
                        yield _sse("tool_log", {"call_id": call_id, "stream": "stderr", "text": str(e)})
                        yield _sse("tool_done", {"call_id": call_id, "exit_code": 1})
                        tool_results.append(f"[search_codebase] Error: {e}")

                elif tc.name == "git":
                    subcommand = tc.args.get("subcommand", "")
                    args = tc.args.get("args", "")
                    yield self._step_label(f"git {subcommand}...", iteration)
                    yield _sse("tool_start", {"tool": "git", "args": {"subcommand": subcommand, "args": args}, "call_id": call_id})

                    result = await git_tool(subcommand, args)
                    if result["error"]:
                        yield _sse("tool_log", {"call_id": call_id, "stream": "stderr", "text": result["error"]})
                        yield _sse("tool_done", {"call_id": call_id, "exit_code": 1})
                        tool_results.append(f"[git {subcommand}] Error: {result['error']}")
                    else:
                        yield _sse("tool_log", {"call_id": call_id, "stream": "stdout", "text": result["output"]})
                        yield _sse("tool_done", {"call_id": call_id, "exit_code": 0})
                        tool_results.append(f"[git {subcommand}]\n{_truncate(result['output'])}")

                elif tc.name == "batch_edit":
                    files_str = tc.args.get("files", "")
                    search = tc.args.get("search", "")
                    replace = tc.args.get("replace", "")
                    file_list = [f.strip() for f in files_str.split(",") if f.strip()]

                    if len(file_list) > 10:
                        tool_results.append("[batch_edit] Max 10 files per batch.")
                        continue

                    yield self._step_label(f"Batch editing {len(file_list)} files...", iteration)
                    yield _sse("tool_start", {"tool": "batch_edit", "args": {"files": files_str}, "call_id": call_id})

                    applied = 0
                    for fp in file_list:
                        patch_result = await apply_patch_content(fp, search, replace)
                        if patch_result["error"]:
                            tool_results.append(f"[batch_edit {fp}] Error: {patch_result['error']}")
                            continue

                        bc_id = str(uuid.uuid4())[:8]
                        yield _sse("diff_proposal", {
                            "call_id": bc_id,
                            "file_path": patch_result["file_path"],
                            "old": patch_result["old"],
                            "new": patch_result["new"],
                            "diff": patch_result["diff"],
                        })

                        async for heartbeat in self._wait_for_diff_approval(bc_id, iteration):
                            yield heartbeat

                        approved, reason = self._consume_diff_result(bc_id)
                        if approved:
                            self._edit_history.append({
                                "file_path": fp,
                                "old_content": patch_result["old"],
                                "new_content": patch_result["new"],
                            })
                            await apply_edit(fp, patch_result["new"])
                            applied += 1
                            repo_map_cache.invalidate()

                    yield _sse("tool_done", {"call_id": call_id, "exit_code": 0})
                    tool_results.append(f"[batch_edit] Applied to {applied}/{len(file_list)} files")

                else:
                    tool_results.append(f"[unknown tool: {tc.name}]")

            logger.info(f"Iteration {iteration}/{self.max_iterations} complete in {time.time() - iter_start:.1f}s (session={self.session_id})")

            # Fix 2: track token cost of tool results
            tool_output_text = "\n---\n".join(tool_results)
            self.guardrails.add_tokens(count_tokens(tool_output_text))

            # Append assistant message (cleaned) and tool results to conversation
            # (full messages for accurate context management later)
            messages.append({"role": "assistant", "content": cleaned})
            messages.append({
                "role": "user",
                "content": "Tool results:\n" + tool_output_text,
            })

        # --- Done ---
        # Fix 3: clean up background processes
        cleanup_msgs = await self.process_manager.cleanup_all()
        if cleanup_msgs:
            logger.info(f"Session cleanup: {cleanup_msgs}")

        self._state = AgentState.done
        elapsed_ms = (time.time() - self._start_time) * 1000
        yield _sse("done", {
            "summary": f"Completed in {iteration} iteration(s)",
            "total_tokens": self._total_tokens,
            "total_time_ms": round(elapsed_ms),
        })
