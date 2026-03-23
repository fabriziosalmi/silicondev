"""Focused single-task workers with independent context.

Each SubagentWorker runs a simplified tool loop: generate → parse → execute → repeat.
Workers have role-specific tool subsets (reviewers can only read, fixers can edit).
"""

import asyncio
import logging
import re
import time
import uuid
from typing import Any, AsyncGenerator, Dict, List, Optional

logger = logging.getLogger(__name__)


# ── Role definitions ────────────────────────────────────────────

WORKER_ROLES = {
    "code_reviewer": {
        "label": "Code Reviewer",
        "system": (
            "You are a code reviewer. Analyze the provided code for bugs, "
            "security issues, performance problems, and style violations. "
            "Use read_file to examine files. Return a structured review with "
            "severity levels (critical/warning/info) for each finding.\n"
            "Do NOT modify any files. Only read and analyze."
        ),
        "tools": ("read_file", "run_bash"),  # bash for grep/find only
        "can_write": False,
    },
    "test_writer": {
        "label": "Test Writer",
        "system": (
            "You are a test writer. Read the source files provided, understand "
            "the functions/classes, and write comprehensive unit tests. "
            "Use read_file to understand the code, then use patch_file to create "
            "test files. Follow the project's existing test conventions."
        ),
        "tools": ("read_file", "run_bash", "patch_file"),
        "can_write": True,
    },
    "docs_generator": {
        "label": "Documentation Generator",
        "system": (
            "You are a documentation writer. Read source files and generate "
            "clear docstrings, type hints, and markdown documentation. "
            "Use read_file to understand the code, then use patch_file to add "
            "or improve documentation inline."
        ),
        "tools": ("read_file", "patch_file"),
        "can_write": True,
    },
    "bug_fixer": {
        "label": "Bug Fixer",
        "system": (
            "You are a targeted bug fixer. Read the error context, examine "
            "the relevant files, and produce a minimal fix. Use read_file to "
            "understand the code, run_bash to reproduce the error, and "
            "patch_file to apply the fix. Change as few lines as possible."
        ),
        "tools": ("read_file", "run_bash", "patch_file"),
        "can_write": True,
    },
}


# ── Tool XML parsing ───────────────────────────────────────────

_TOOL_RE = re.compile(
    r'<tool\s+name="(\w+)">(.*?)</tool>',
    re.DOTALL,
)
_ARG_RE = re.compile(
    r'<arg\s+name="(\w+)">(.*?)</arg>',
    re.DOTALL,
)


def parse_tool_calls(text: str) -> List[Dict[str, Any]]:
    """Extract tool calls from model output (same XML format as supervisor)."""
    calls = []
    for match in _TOOL_RE.finditer(text):
        name = match.group(1)
        body = match.group(2)
        args = {}
        for arg_match in _ARG_RE.finditer(body):
            args[arg_match.group(1)] = arg_match.group(2).strip()
        calls.append({"name": name, "args": args})
    return calls


# ── Tool executor ───────────────────────────────────────────────

async def execute_tool(name: str, args: dict, workspace_dir: str, allowed_tools: tuple) -> str:
    """Execute a single tool call.  Returns the result as a string."""
    if name not in allowed_tools:
        return f"[Error] Tool '{name}' is not available for this worker role."

    from app.agents.nanocore.tools import read_file, run_bash, apply_patch_content

    try:
        if name == "read_file":
            path = args.get("path", "")
            # Resolve relative paths
            if not path.startswith("/"):
                path = f"{workspace_dir}/{path}"
            result = await read_file(path)
            return result.get("content", result.get("error", ""))

        elif name == "run_bash":
            cmd = args.get("command", "")
            output_parts = []
            async for stream_type, data in run_bash(cmd, timeout=30):
                if stream_type in ("stdout", "stderr"):
                    output_parts.append(data)
            return "".join(output_parts)[:5000]  # Truncate

        elif name == "patch_file":
            path = args.get("path", "")
            if not path.startswith("/"):
                path = f"{workspace_dir}/{path}"
            search = args.get("search", "")
            replace = args.get("replace", "")
            if search and replace:
                result = await apply_patch_content(path, search, replace)
                return str(result)
            else:
                return "[Error] patch_file requires 'search' and 'replace' args"

        else:
            return f"[Error] Tool '{name}' not implemented in subagent."

    except Exception as e:
        return f"[Error] {name} failed: {e}"


# ── Worker ──────────────────────────────────────────────────────

class SubagentWorker:
    """A focused, single-task worker with its own conversation history.

    Runs a simplified agent loop: generate → parse tools → execute → repeat.
    """

    def __init__(
        self,
        worker_id: str,
        role: str,
        model_id: str,
        workspace_dir: str,
        max_iterations: int = 5,
        max_tokens: int = 2000,
        temperature: float = 0.2,
    ):
        if role not in WORKER_ROLES:
            raise ValueError(f"Unknown worker role: {role}. Known: {list(WORKER_ROLES.keys())}")

        self.worker_id = worker_id
        self.role = role
        self.model_id = model_id
        self.workspace_dir = workspace_dir
        self.max_iterations = max_iterations
        self.max_tokens = max_tokens
        self.temperature = temperature

        role_cfg = WORKER_ROLES[role]
        self.label = role_cfg["label"]
        self.allowed_tools = role_cfg["tools"]
        self.can_write = role_cfg["can_write"]

        # Build system prompt with available tools
        tools_desc = ", ".join(self.allowed_tools)
        self._system_prompt = (
            f"{role_cfg['system']}\n\n"
            f"Available tools: {tools_desc}\n"
            f"Use XML format: <tool name=\"...\"><arg name=\"...\">value</arg></tool>\n"
            f"Working directory: {workspace_dir}"
        )
        self._history: List[Dict[str, str]] = [
            {"role": "system", "content": self._system_prompt}
        ]
        self.result: str = ""
        self.iterations_used: int = 0
        self.start_time: float = 0
        self.end_time: float = 0

    async def run(
        self,
        task: str,
        context_files: Optional[List[str]] = None,
    ) -> str:
        """Execute the task.  Returns the final output text."""
        self.start_time = time.time()

        # Inject file context if provided
        context_parts = [task]
        if context_files:
            from app.agents.nanocore.tools import read_file
            for fpath in context_files[:5]:  # Max 5 files
                abs_path = fpath if fpath.startswith("/") else f"{self.workspace_dir}/{fpath}"
                try:
                    result = await read_file(abs_path, max_lines=200)
                    if "content" in result:
                        context_parts.append(f"\n--- {fpath} ---\n{result['content']}")
                except Exception:
                    pass

        self._history.append({"role": "user", "content": "\n".join(context_parts)})

        # Agent loop
        for i in range(self.max_iterations):
            self.iterations_used = i + 1

            # Generate
            from app.api.engine import service as engine_service
            response = await engine_service.generate_response(
                self.model_id,
                self._history,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            )
            assistant_text = response.get("content", "")
            self._history.append({"role": "assistant", "content": assistant_text})

            # Parse tool calls
            tool_calls = parse_tool_calls(assistant_text)
            if not tool_calls:
                # No tools → the model is done, this is the final answer
                self.result = assistant_text
                break

            # Execute tools and collect results
            tool_results = []
            for tc in tool_calls:
                result = await execute_tool(
                    tc["name"], tc["args"], self.workspace_dir, self.allowed_tools
                )
                tool_results.append(f"[{tc['name']}]: {result}")
                logger.debug("Worker %s tool %s: %s", self.worker_id, tc["name"], result[:200])

            # Inject tool results into conversation
            self._history.append({
                "role": "user",
                "content": "Tool results:\n" + "\n\n".join(tool_results)
            })
        else:
            # Max iterations reached — use last assistant response
            self.result = assistant_text if 'assistant_text' in dir() else "Worker reached max iterations without a final answer."

        self.end_time = time.time()
        return self.result

    def summary(self) -> Dict[str, Any]:
        """Return a summary dict for SSE events."""
        return {
            "worker_id": self.worker_id,
            "role": self.role,
            "label": self.label,
            "model_id": self.model_id,
            "iterations": self.iterations_used,
            "duration_ms": round((self.end_time - self.start_time) * 1000) if self.end_time else 0,
            "result_length": len(self.result),
        }
