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
from .prompts import SYSTEM_PROMPT, REVIEW_MODE_PROMPT, INSPECTOR_PROMPT
from .parser import extract_tool_calls, has_partial_tool_tag, strip_tool_calls
from .tools import (
    run_bash, apply_patch_content,
    git_tool, apply_edit, read_file as read_file_paged,
    execute_python_script,
    check_broken_imports, generate_codemap
)
from .swarm import MapReduceSwarm
from .validators import validate_content, detect_lazy_edit, run_lint_check, scan_security, scan_performance
from .guardrails import LoopGuardrails
from .context import ContextManager, count_tokens
from .repomap import RepoMapCache
from .process_manager import ProcessManager

logger = logging.getLogger(__name__)

# Strip <think>...</think> blocks and any leftover tags from model output
_THINK_RE = re.compile(r'<think>.*?</think>', re.DOTALL)
_THINK_INCOMPLETE_RE = re.compile(r'<think>.*$', re.DOTALL)  # unclosed think block at end
_THINK_OPEN_RE = re.compile(r'</?think[^>]*>')

# Max chars of tool output to inject back into the conversation
MAX_TOOL_OUTPUT_CHARS = 4000
# Max seconds to wait for diff approval before auto-rejecting
MAX_APPROVAL_WAIT_SECS = 300  # 5 minutes
# Self-healing: max consecutive bash failures before giving up
MAX_AUTO_RETRIES = 3


def _strip_think_tags(text: str) -> str:
    """Remove <think>...</think> blocks and stray tags from model output.

    Important: incomplete think blocks (no closing tag) are only stripped
    if they don't contain tool calls — small models sometimes emit tool
    calls inside unclosed think blocks.
    """
    text = _THINK_RE.sub('', text)
    # Only strip incomplete think blocks if they don't contain tool calls
    m = _THINK_INCOMPLETE_RE.search(text)
    if m and '<tool ' not in m.group(0):
        text = _THINK_INCOMPLETE_RE.sub('', text)
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
        enable_moa: bool = True,
        air_gapped_mode: bool = False,
        enable_python_sandbox: bool = False,
    ):
        self.session_id = session_id
        self.model_id = model_id
        self.max_iterations = max_iterations
        self.temperature = temperature
        self.mode = mode
        self.workspace_dir = workspace_dir
        
        self.enable_moa = enable_moa
        self.air_gapped_mode = air_gapped_mode
        self.enable_python_sandbox = enable_python_sandbox

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
        # Schedule background process cleanup safely
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # Avoid fire-and-forget without a reference; log errors if it fails
                task = loop.create_task(self.process_manager.cleanup_all())
                task.add_done_callback(
                    lambda t: logger.error(f"Cleanup error: {t.exception()}") if t.exception() else None
                )
        except Exception as e:
            logger.error(f"Error scheduling cleanup during stop: {e}")

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
            if ok:
                # Commandment 15: AI-Specific Undo
                # Inject a message into history so the agent knows the user rejected the change
                self._history.append({
                    "role": "user",
                    "content": f"[SYSTEM: User undid your last change to {file_path}. This means your previous approach was incorrect or unwanted. PLEASE PROPOSE AN ALTERNATIVE APPROACH.]"
                })
            return {"file_path": file_path, "ok": ok, "error": "" if ok else "Failed to write file"}
        except Exception as e:
            return {"file_path": file_path, "ok": False, "error": str(e)}

    def _step_label(self, label: str, iteration: int, agent_role: str = "architetto") -> dict:
        """Build a step_label SSE event with progress info and agent role."""
        budget_pct = round(self.guardrails.budget_fraction() * 100)
        return {"event": "step_label", "data": {
            "label": label,
            "iteration": iteration,
            "max_iterations": self.max_iterations,
            "budget_pct": budget_pct,
            "role": agent_role,
        }}

    def _agency_status(self, role: str, status: str) -> dict:
        """Indicate which agent is active and what it's doing."""
        return _sse("agency_status", {"role": role, "status": status})

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
        
        # --- Commandment 14: Linter Injection ---
        linter_addition = ""
        if active_file_path and os.path.exists(active_file_path):
            try:
                # Commandment 14: Linter Injection is async and only takes file_path
                # We don't need to read the content ourselves, run_lint_check does it
                linter_res = await run_lint_check(active_file_path)
                if linter_res:
                    linter_addition = f"\n\n## Current Linter Errors in {os.path.basename(active_file_path)} (Fix these if relevant):\n{linter_res}"
            except Exception:
                pass

        # --- Commandment 3: VRAM / Memory Sensing ---
        import psutil
        mem = psutil.virtual_memory()
        if mem.percent > 90:
            yield _sse("info", {"content": "⚠️ Critical: Low system memory. Performance may be degraded."})
        elif mem.percent > 80:
            yield _sse("info", {"content": "Note: System memory pressure detected. Scaling down background tasks."})

        # --- Commandment 18: Project Rules & Steering (.nanocore/) ---
        user_rules = ""
        # Legacy .nanocore_rules
        legacy_rules_path = os.path.join(cwd, ".nanocore_rules")
        if os.path.exists(legacy_rules_path):
            try:
                with open(legacy_rules_path, 'r', encoding='utf-8') as f:
                    user_rules += f"\n\n## Project Specific Rules (.nanocore_rules)\n{f.read()}"
            except Exception as e:
                logger.warning(f"Error reading .nanocore_rules: {e}")
                
        # Agent Steering Directory (.nanocore/)
        steering_dir = os.path.join(cwd, ".nanocore")
        if os.path.isdir(steering_dir):
            for file_name in ["instructions.md", "stack.md"]:
                file_path = os.path.join(steering_dir, file_name)
                if os.path.exists(file_path):
                    try:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            user_rules += f"\n\n## Steering Context ({file_name})\n{f.read()}"
                    except Exception as e:
                        logger.warning(f"Error reading {file_path}: {e}")

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
        system_content = base_prompt + user_rules + linter_addition + "\n\n## Environment\n\n" + "\n".join(env_lines) + "\n"
        if repo_map:
            system_content += f"\n\n## Repository Map\n\n{repo_map}\n"

        # Smart file discovery: only for non-trivial prompts (>30 chars, not simple create/write)
        _SIMPLE_PROMPT_RE = re.compile(r'^(create|write|make|add|generate)\s+(a\s+)?(simple|basic|new|empty)?\s*\w+', re.IGNORECASE)
        if len(prompt) > 30 and not _SIMPLE_PROMPT_RE.match(prompt):
            try:
                from app.codebase.service import codebase_service
                relevant = codebase_service.search(prompt, top_k=5)
                if relevant:
                    # --- Commandment 17: Transparent Retrieval Trace ---
                    yield _sse("rag_search", {
                        "query": prompt[:100],
                        "results": [
                            {"file_path": r.file_path, "score": r.score, "method": r.method}
                            for r in relevant
                        ]
                    })
                    
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
            # {"role": "system", "content": system_content}, # This will be inserted later after filtering
        ]

        # Inject conversation history (prior turns) for multi-turn memory
        if history:
            for turn in history:
                messages.append({"role": turn["role"], "content": turn["content"]})

        # Filter out disabled capabilities from the system prompt dynamically
        system_prompt_content = system_content.strip()
        
        if not self.enable_python_sandbox:
            system_prompt_content = re.sub(r'### execute_python_script.*?(?=###|$)', '', system_prompt_content, flags=re.DOTALL)

        if not self.enable_moa:
            system_prompt_content = re.sub(r'### ask_swarm_experts.*?(?=###|$)', '', system_prompt_content, flags=re.DOTALL)
            
        messages.insert(0, {"role": "system", "content": system_prompt_content})

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
            yield self._agency_status("architetto", "Planning trajectory")
            yield self._step_label("Thinking...", iteration, agent_role="architetto")
            yield _sse("telemetry_update", self._telemetry_data(iteration))

            # Refresh repo map only if files changed (invalidated by edit)
            if repo_map_cache.is_dirty():
                fresh_map = repo_map_cache.get()
                updated_system = base_prompt + f"\n\n## Environment\n\nWorking directory: {cwd}\n"
                if fresh_map:
                    updated_system += f"\n\n## Repository Map\n\n{fresh_map}\n"
                updated_system += no_think_suffix
                
                # Re-apply filtering for dynamic tools
                if not self.enable_python_sandbox:
                    updated_system = re.sub(r'### execute_python_script.*?(?=###|$)', '', updated_system, flags=re.DOTALL)
                if not self.enable_moa:
                    updated_system = re.sub(r'### ask_swarm_experts.*?(?=###|$)', '', updated_system, flags=re.DOTALL)

                messages[0] = {"role": "system", "content": updated_system}

            # Fix 4: fit messages into context window
            fitted_messages = self._context_mgr.fit_messages(messages)

            # Phase 11 Win: Emit context health UI
            try:
                from .context import count_tokens
                used_tokens = sum(count_tokens(str(m.get("content", ""))) for m in fitted_messages)
                yield _sse("context_health", {
                    "used_tokens": used_tokens,
                    "max_tokens": self._context_mgr.max_context_tokens
                })
            except Exception as e:
                logger.warning(f"Error emitting context health: {e}")

            # --- Generate from model ---
            accumulated = ""
            streamed_up_to = 0
            iter_tokens = 0
            in_think_block = False
            think_buffer = ""

            yield self._agency_status("operaio", "Drafting content")

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

                    result = await read_file_paged(file_path, max_lines=max_lines)
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

                    diff_info = await apply_patch_content(file_path, "", new_content, is_create=True) # Use apply_patch_content for diff generation

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

                    # --- Internal Review (Inspector) ---
                    yield self._agency_status("ispettore", "Verifying change quality")
                    review_msg = f"Proposed change to {file_path}:\n```diff\n{diff_info['diff']}\n```"
                    reviewer_messages = [
                        {"role": "system", "content": INSPECTOR_PROMPT},
                        {"role": "user", "content": review_msg}
                    ]
                    review_accum = ""
                    async for rev_chunk in engine_service.generate_stream(self.model_id, reviewer_messages, temperature=0.1):
                        if "text" in rev_chunk:
                            review_accum += rev_chunk["text"]

                    if "LGTM" not in review_accum.upper():
                        # Inspector found something! Log it and emit trace
                        logger.info(f"Inspector feedback on {file_path}: {review_accum}")
                        yield _sse("agency_trace", {
                            "role": "ispettore",
                            "content": review_accum,
                            "target": file_path
                        })
                        if "FIXED:" in review_accum:
                            # Advanced: could swap the diff here. For now just add to trace.
                            pass
                    else:
                        # Log LGTM too for trace visibility
                        yield _sse("agency_trace", {
                            "role": "ispettore",
                            "content": "Review complete: LGTM. Code matches project standards and security guidelines.",
                            "target": file_path
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
                        yield _sse("tool_output", {"content": f"Rejected: {lazy_err}"})
                        tool_results.append(f"[patch_file] Rejected: {lazy_err}. Write the complete replacement text.")
                        continue

                    yield _sse("tool_start", {"tool": "patch_file", "args": {"path": file_path}, "call_id": call_id})

                    patch_result = await apply_patch_content(file_path, search, replace)

                    if patch_result["error"]:
                        logger.warning("[patch_file] %s: %s", file_path, patch_result["error"])
                        yield _sse("tool_output", {"content": f"Error: {patch_result['error']}"})
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
                        logger.warning("[patch_file] validation failed on %s: %s", file_path, validation_err)
                        yield _sse("tool_output", {"content": f"Validation failed: {validation_err}"})
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
                        # Post-edit checks — track if any issues found
                        has_post_edit_issues = False
                        # Post-edit lint check
                        lint_err = await run_lint_check(file_path)
                        if lint_err:
                            has_post_edit_issues = True
                            yield _sse("lint_result", {"file_path": file_path, "errors": lint_err})
                            tool_results.append(f"[lint] Issues in {file_path}:\n{lint_err}\nFix these issues.")
                        # Dependency check
                        dep_warn = await check_broken_imports(file_path, patch_result["old"], new_content)
                        if dep_warn:
                            has_post_edit_issues = True
                            tool_results.append(f"[dependency] Warning:\n{dep_warn}\nCheck these files for broken references.")
                        # Security + performance scans
                        sec_warns = scan_security(new_content)
                        if sec_warns:
                            has_post_edit_issues = True
                            tool_results.append("\n".join(sec_warns) + "\nReview and fix security issues above.")
                        perf_hints = scan_performance(new_content)
                        if perf_hints:
                            has_post_edit_issues = True
                            tool_results.append("\n".join(perf_hints))
                        # If patch was clean, signal the model that the task may be complete
                        if not has_post_edit_issues:
                            tool_results.append("[DONE] Patch applied cleanly with no issues.")
                            # Fast-close: if this was the only tool call, end immediately
                            if len(tool_calls) == 1:
                                self._state = AgentState.done
                                elapsed_ms = (time.time() - self._start_time) * 1000
                                yield _sse("done", {
                                    "summary": f"Completed in {iteration} iteration(s)",
                                    "total_tokens": self._total_tokens,
                                    "total_time_ms": round(elapsed_ms),
                                    "iterations": iteration,
                                    "edits": len(self._edit_history),
                                })
                                return
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
                    full_command = f"git {subcommand} {args}".strip()

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

                elif tc.name == "generate_codemap":
                    yield self._step_label("Generating architecture map...", iteration)
                    yield _sse("tool_start", {"tool": "generate_codemap", "args": {}, "call_id": call_id})
                    try:
                        result = await generate_codemap(self.workspace_dir)
                        yield _sse("tool_done", {"call_id": call_id, "exit_code": 0})
                        tool_results.append(f"[generate_codemap] {result}")
                    except Exception as e:
                        yield _sse("tool_done", {"call_id": call_id, "exit_code": 1})
                        
                elif tc.name == "execute_python_script":
                    script_code = tc.args.get("script", "")
                    yield self._step_label("Executing Python Sandbox...", iteration)
                    yield _sse("tool_start", {"tool": "execute_python_script", "args": {"script": script_code}, "call_id": call_id})
                    
                    if not self.enable_python_sandbox:
                        yield _sse("tool_log", {"call_id": call_id, "stream": "stderr", "text": "Feature disabled in settings."})
                        yield _sse("tool_done", {"call_id": call_id, "exit_code": 1})
                        tool_results.append("[execute_python_script] Error: Sandbox is disabled in Settings.")
                        continue
                        
                    try:
                        result = await execute_python_script(script_code, timeout=15, air_gapped=self.air_gapped_mode)
                        
                        if result["error"]:
                            yield _sse("tool_log", {"call_id": call_id, "stream": "stderr", "text": result["error"]})
                            yield _sse("tool_done", {"call_id": call_id, "exit_code": 1})
                        else:
                            yield _sse("tool_log", {"call_id": call_id, "stream": "stdout", "text": result["output"]})
                            yield _sse("tool_done", {"call_id": call_id, "exit_code": 0})
                            
                        tool_results.append(f"[execute_python_script]\nSTDOUT: {result['output']}\nSTDERR: {result['error']}")
                    except Exception as e:
                        logger.error(f"Sandbox failure: {e}", exc_info=True)
                        yield _sse("tool_done", {"call_id": call_id, "exit_code": 1})
                        tool_results.append(f"[execute_python_script] Error: {e}")
                elif tc.name == "ask_swarm_experts":
                    topic = tc.args.get("topic", "")
                    context = tc.args.get("context", "")
                    yield self._step_label("Consulting Swarm Experts (MoA)...", iteration)
                    yield _sse("tool_start", {"tool": "ask_swarm_experts", "args": {"topic": topic, "context": context}, "call_id": call_id})
                    
                    if not self.enable_moa:
                        yield _sse("tool_log", {"call_id": call_id, "stream": "stderr", "text": "Feature disabled in settings."})
                        yield _sse("tool_done", {"call_id": call_id, "exit_code": 1})
                        tool_results.append("[ask_swarm_experts] Error: MoA is disabled in Settings.")
                        continue
                        
                    try:
                        swarm_events: list[dict] = []

                        async def _swarm_progress(phase: str, expert_id: str, status: str):
                            swarm_events.append({"phase": phase, "expert": expert_id, "status": status})

                        swarm = MapReduceSwarm(self.model_id, on_progress=_swarm_progress)
                        result = await swarm.run_swarm(topic=topic, context=context)

                        # Flush accumulated progress events
                        for evt in swarm_events:
                            yield _sse("swarm_progress", {**evt, "call_id": call_id})

                        yield _sse("tool_done", {"call_id": call_id, "exit_code": 0})
                        tool_results.append(f"[ask_swarm_experts]\n{result}")
                    except Exception as e:
                        logger.error(f"Swarm failure: {e}", exc_info=True)
                        yield _sse("tool_done", {"call_id": call_id, "exit_code": 1})
                        tool_results.append(f"[ask_swarm_experts] Error: {e}")

                else:
                    tool_results.append(f"Unknown tool: {tc.name}")

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
            "iterations": iteration,
            "edits": len(self._edit_history),
        })
