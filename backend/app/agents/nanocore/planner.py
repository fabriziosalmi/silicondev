"""Planner/Editor orchestrator — two-phase agentic editing.

Phase 1 (Plan): Model generates a structured plan with file targets and descriptions.
Phase 2 (Execute): For each step, read the target file, generate the edit, yield diff.

Uses the same SSE event format as SupervisorAgent for seamless frontend integration.
"""

import asyncio
import json
import logging
import os
import re
import time
import uuid
from pathlib import Path
from typing import AsyncGenerator

from .types import AgentState
from .context import ContextManager, count_tokens

logger = logging.getLogger(__name__)

PLANNER_SYSTEM_PROMPT = """\
You are a senior software architect. Given a task, produce a precise execution plan.

## Output Format

Return ONLY a JSON array. Each element is one edit step:

```json
[
  {
    "file": "relative/path/to/file.py",
    "action": "modify",
    "description": "What to change and why"
  }
]
```

Rules:
- "action" must be one of: "modify", "create", "delete"
- "file" must be a real path relative to the workspace root
- "description" must be specific enough for a junior dev to execute
- Order steps by dependency (foundational changes first)
- Keep the plan minimal — only files that MUST change
- Do NOT include explanations outside the JSON array
"""

EDITOR_SYSTEM_PROMPT = """\
You are a precise code editor. You receive a file and an edit instruction.
Output ONLY the complete new file content. No explanations, no markdown fences, no commentary.
If creating a new file, output the full file content.
"""

# Regex to extract JSON array from model output (handles markdown fences)
_JSON_ARRAY_RE = re.compile(r'\[[\s\S]*\]')


def _sse(event: str, data: dict) -> dict:
    return {"event": event, "data": data}


def _parse_plan(raw: str) -> list[dict]:
    """Extract a JSON array of plan steps from model output."""
    # Strip markdown fences if present
    cleaned = re.sub(r'```(?:json)?\s*', '', raw)
    cleaned = re.sub(r'```\s*$', '', cleaned)

    m = _JSON_ARRAY_RE.search(cleaned)
    if not m:
        raise ValueError("No JSON array found in planner output")

    steps = json.loads(m.group(0))
    if not isinstance(steps, list) or len(steps) == 0:
        raise ValueError("Plan must be a non-empty array")

    validated = []
    for i, step in enumerate(steps):
        if not isinstance(step, dict):
            raise ValueError(f"Step {i} is not an object")
        file_path = step.get("file", "").strip()
        action = step.get("action", "modify").strip().lower()
        description = step.get("description", "").strip()
        if not file_path:
            raise ValueError(f"Step {i} missing 'file'")
        if action not in ("modify", "create", "delete"):
            raise ValueError(f"Step {i} has invalid action '{action}'")
        if not description:
            raise ValueError(f"Step {i} missing 'description'")
        validated.append({"file": file_path, "action": action, "description": description})

    return validated


class PlannerEditor:
    """Two-phase orchestrator: plan then execute edits."""

    def __init__(
        self,
        session_id: str,
        model_id: str,
        workspace_dir: str,
        temperature: float = 0.3,
        max_edit_tokens: int = 8192,
    ):
        self.session_id = session_id
        self.model_id = model_id
        self.workspace_dir = workspace_dir
        self.temperature = temperature
        self.max_edit_tokens = max_edit_tokens

        self._stopped = False
        self._state = AgentState.thinking
        self._total_tokens = 0
        self._start_time = 0.0

        # Plan approval gate
        self._plan_approved = asyncio.Event()
        self._plan_decision: bool = False
        self._plan_modifications: list[dict] | None = None

        # Pending diffs (reuses supervisor's approval flow)
        self._pending_diffs: dict[str, dict] = {}
        self._edit_history: list[dict] = []

    def stop(self):
        self._stopped = True
        try:
            from app.api.engine import service as engine_service
            engine_service.stop_generation()
        except Exception:
            pass

    def resolve_plan(self, approved: bool, modifications: list[dict] | None = None) -> bool:
        self._plan_decision = approved
        self._plan_modifications = modifications
        self._plan_approved.set()
        return True

    def resolve_diff(self, call_id: str, approved: bool, reason: str = "") -> bool:
        pending = self._pending_diffs.get(call_id)
        if not pending:
            return False
        pending["approved"] = approved
        pending["reason"] = reason
        pending["event"].set()
        return True

    async def run(self, prompt: str) -> AsyncGenerator[dict, None]:
        """Main orchestration loop. Yields SSE events."""
        from app.api.engine import service as engine_service

        self._start_time = time.time()

        yield _sse("session_start", {"session_id": self.session_id, "mode": "plan"})

        # ── Phase 1: Generate Plan ──────────────────────────────

        yield _sse("plan_status", {"phase": "planning", "message": "Generating plan..."})

        plan_messages = [
            {"role": "system", "content": PLANNER_SYSTEM_PROMPT},
            {"role": "user", "content": self._build_plan_prompt(prompt)},
        ]

        plan_raw = ""
        plan_tokens = 0
        try:
            async for chunk in engine_service.generate_stream(
                self.model_id, plan_messages,
                temperature=self.temperature, max_tokens=4096,
            ):
                if self._stopped:
                    engine_service.stop_generation()
                    return
                if "error" in chunk:
                    yield _sse("error", {"message": chunk["error"]})
                    return
                if "text" in chunk:
                    plan_raw += chunk["text"]
                    plan_tokens += 1
        except Exception as e:
            yield _sse("error", {"message": f"Plan generation failed: {e}"})
            return

        self._total_tokens += plan_tokens

        # Parse plan
        try:
            steps = _parse_plan(plan_raw)
        except ValueError as e:
            yield _sse("error", {"message": f"Plan parsing failed: {e}\n\nRaw output:\n{plan_raw[:500]}"})
            return

        # Yield plan for user review
        yield _sse("plan_proposal", {
            "session_id": self.session_id,
            "steps": steps,
            "plan_tokens": plan_tokens,
        })

        # Wait for user to approve/modify/reject the plan
        yield _sse("plan_status", {"phase": "awaiting_approval", "message": "Waiting for plan approval..."})

        try:
            await asyncio.wait_for(self._plan_approved.wait(), timeout=300)
        except asyncio.TimeoutError:
            yield _sse("plan_status", {"phase": "timeout", "message": "Plan approval timed out"})
            return

        if not self._plan_decision:
            yield _sse("plan_status", {"phase": "rejected", "message": "Plan rejected by user"})
            yield _sse("done", self._done_data(0))
            return

        # Apply modifications if user edited the plan
        if self._plan_modifications is not None:
            steps = self._plan_modifications

        yield _sse("plan_status", {"phase": "executing", "message": f"Executing {len(steps)} step(s)..."})

        # ── Phase 1.5: Speculative Prefetch ─────────────────────

        file_cache: dict[str, str] = {}
        for step in steps:
            if step["action"] in ("modify", "delete"):
                abs_path = os.path.join(self.workspace_dir, step["file"])
                if os.path.isfile(abs_path):
                    try:
                        with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
                            file_cache[step["file"]] = f.read()
                    except Exception:
                        pass

        # ── Phase 2: Execute Each Step ──────────────────────────

        completed = 0
        for i, step in enumerate(steps):
            if self._stopped:
                break

            step_id = str(uuid.uuid4())[:8]
            file_path = step["file"]
            action = step["action"]
            description = step["description"]
            abs_path = os.path.join(self.workspace_dir, file_path)

            yield _sse("plan_step_start", {
                "step_index": i,
                "step_id": step_id,
                "total_steps": len(steps),
                "file": file_path,
                "action": action,
                "description": description,
            })

            if action == "delete":
                # Delete file — yield as diff (full content → empty)
                old_content = file_cache.get(file_path, "")
                call_id = str(uuid.uuid4())[:8]
                yield _sse("diff_proposal", {
                    "call_id": call_id,
                    "file_path": abs_path,
                    "old": old_content,
                    "new": "",
                    "diff": f"--- {file_path}\n+++ /dev/null\n(file deleted)",
                })

                approved = await self._wait_and_consume_diff(call_id)
                if approved:
                    try:
                        os.remove(abs_path)
                        self._edit_history.append({"file_path": abs_path, "old_content": old_content, "new_content": ""})
                    except Exception as e:
                        yield _sse("error", {"message": f"Failed to delete {file_path}: {e}"})

                yield _sse("plan_step_done", {"step_index": i, "step_id": step_id, "status": "approved" if approved else "rejected"})
                if approved:
                    completed += 1
                continue

            # For modify/create: generate new content
            old_content = file_cache.get(file_path, "")

            edit_messages = [
                {"role": "system", "content": EDITOR_SYSTEM_PROMPT},
            ]

            if action == "create":
                edit_messages.append({
                    "role": "user",
                    "content": f"Create a new file: {file_path}\n\nRequirements:\n{description}",
                })
            else:
                edit_messages.append({
                    "role": "user",
                    "content": (
                        f"File: {file_path}\n"
                        f"Edit instruction: {description}\n\n"
                        f"Current content:\n```\n{old_content}\n```\n\n"
                        f"Output the complete updated file content."
                    ),
                })

            # Stream editor generation (show tokens live)
            new_content = ""
            edit_tokens = 0

            try:
                async for chunk in engine_service.generate_stream(
                    self.model_id, edit_messages,
                    temperature=max(self.temperature - 0.1, 0.01),  # slightly lower temp for precision
                    max_tokens=self.max_edit_tokens,
                ):
                    if self._stopped:
                        engine_service.stop_generation()
                        break
                    if "error" in chunk:
                        yield _sse("error", {"message": f"Edit failed for {file_path}: {chunk['error']}"})
                        break
                    if "text" in chunk:
                        new_content += chunk["text"]
                        edit_tokens += 1
                        # Stream progress (every 20 tokens to avoid flooding)
                        if edit_tokens % 20 == 0:
                            yield _sse("plan_step_progress", {
                                "step_index": i,
                                "step_id": step_id,
                                "tokens": edit_tokens,
                            })
            except Exception as e:
                yield _sse("error", {"message": f"Edit generation failed for {file_path}: {e}"})
                yield _sse("plan_step_done", {"step_index": i, "step_id": step_id, "status": "error"})
                continue

            self._total_tokens += edit_tokens

            # Strip markdown fences if the model wrapped the output
            new_content = self._strip_code_fences(new_content)

            # Generate unified diff
            import difflib
            diff_lines = list(difflib.unified_diff(
                old_content.splitlines(keepends=True),
                new_content.splitlines(keepends=True),
                fromfile=f"a/{file_path}",
                tofile=f"b/{file_path}",
            ))
            diff_text = "".join(diff_lines)

            # Yield diff proposal (reuses existing diff approval flow)
            call_id = str(uuid.uuid4())[:8]
            yield _sse("diff_proposal", {
                "call_id": call_id,
                "file_path": abs_path,
                "old": old_content,
                "new": new_content,
                "diff": diff_text,
            })

            approved = await self._wait_and_consume_diff(call_id)
            if approved:
                # Write file
                try:
                    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
                    with open(abs_path, "w", encoding="utf-8") as f:
                        f.write(new_content)
                    self._edit_history.append({
                        "file_path": abs_path,
                        "old_content": old_content,
                        "new_content": new_content,
                    })
                except Exception as e:
                    yield _sse("error", {"message": f"Failed to write {file_path}: {e}"})

            yield _sse("plan_step_done", {
                "step_index": i,
                "step_id": step_id,
                "status": "approved" if approved else "rejected",
                "edit_tokens": edit_tokens,
            })
            if approved:
                completed += 1

        # ── Done ────────────────────────────────────────────────

        yield _sse("plan_status", {
            "phase": "done",
            "message": f"Completed {completed}/{len(steps)} steps",
        })
        yield _sse("done", self._done_data(completed))

    def _build_plan_prompt(self, user_prompt: str) -> str:
        """Build the planner prompt with workspace context."""
        parts = [f"Workspace: {self.workspace_dir}\n"]

        # Include file tree (top-level + 1 depth)
        try:
            tree_lines = []
            root = Path(self.workspace_dir)
            for entry in sorted(root.iterdir()):
                if entry.name.startswith("."):
                    continue
                if entry.is_dir():
                    tree_lines.append(f"  {entry.name}/")
                    try:
                        for child in sorted(entry.iterdir())[:20]:
                            if child.name.startswith("."):
                                continue
                            suffix = "/" if child.is_dir() else ""
                            tree_lines.append(f"    {child.name}{suffix}")
                    except PermissionError:
                        pass
                else:
                    tree_lines.append(f"  {entry.name}")
            if tree_lines:
                parts.append("File tree:\n" + "\n".join(tree_lines[:100]) + "\n")
        except Exception:
            pass

        parts.append(f"Task:\n{user_prompt}")
        return "\n".join(parts)

    async def _wait_and_consume_diff(self, call_id: str) -> bool:
        """Wait for diff approval. Returns True if approved."""
        event = asyncio.Event()
        self._pending_diffs[call_id] = {"event": event, "approved": False}

        try:
            while not event.is_set() and not self._stopped:
                try:
                    await asyncio.wait_for(event.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    continue
        except Exception:
            pass

        pending = self._pending_diffs.pop(call_id, {})
        return pending.get("approved", False)

    def _done_data(self, edits: int) -> dict:
        elapsed = (time.time() - self._start_time) * 1000
        return {
            "total_tokens": self._total_tokens,
            "total_time_ms": int(elapsed),
            "edits": edits,
            "mode": "plan",
        }

    @staticmethod
    def _strip_code_fences(text: str) -> str:
        """Remove markdown code fences wrapping the output."""
        text = text.strip()
        if text.startswith("```"):
            # Remove opening fence (with optional language tag)
            text = re.sub(r'^```\w*\n?', '', text)
        if text.endswith("```"):
            text = text[:-3]
        return text.strip()
