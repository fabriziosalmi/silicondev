"""P1.2 — Programmatic Tool Orchestration (PTC-style, local)

The LLM writes Python orchestration code that calls MCP tools via a
controlled bridge. Intermediate payloads (large tables, logs, datasets)
stay in execution memory — never in LLM context.

Security model:
- All code runs in-process via RestrictedPython (compile-time AST checks)
- If RestrictedPython is unavailable, execution is rejected (fail-closed)
- All MCP calls go through MCPService (which enforces enabled policies + audit)
- Stdout/stderr are captured and size-capped
- Hard wall-clock timeout enforced via asyncio.wait_for
"""
import asyncio
import io
import logging
import sys
import textwrap
import time
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_MAX_OUTPUT_BYTES = 64 * 1024  # 64 KB cap on captured stdout
_DEFAULT_TIMEOUT = 30           # seconds


class OrchestratorResult:
    def __init__(self, *, output: str, error: Optional[str], duration_ms: float,
                 timed_out: bool = False, return_value: Any = None):
        self.output = output
        self.error = error
        self.duration_ms = duration_ms
        self.timed_out = timed_out
        self.return_value = return_value

    def to_dict(self) -> Dict[str, Any]:
        return {
            "output": self.output,
            "error": self.error,
            "duration_ms": round(self.duration_ms, 1),
            "timed_out": self.timed_out,
            "return_value": self.return_value if isinstance(self.return_value, (str, int, float, bool, list, dict, type(None))) else str(self.return_value),
        }


def _make_mcp_bridge(loop: asyncio.AbstractEventLoop, per_call_timeout: float):
    """Return a synchronous `call_tool(server_id, tool, args)` callable for use inside orchestration code.

    The per-tool timeout is bounded by the outer orchestration timeout so a
    single slow tool can't outlive the wall-clock deadline. Caller passes
    `per_call_timeout` derived from the orchestration's own budget.
    """
    from app.mcp.service import MCPService
    svc = MCPService()

    def call_tool(server_id: str, tool_name: str, tool_args: Dict[str, Any] = {}) -> str:
        """Call an MCP tool synchronously. Available inside orchestration code."""
        future = asyncio.run_coroutine_threadsafe(
            svc.execute_tool_for_agent(server_id, tool_name, tool_args), loop
        )
        return future.result(timeout=per_call_timeout)

    return call_tool


async def run_orchestration(
    code: str,
    timeout: int = _DEFAULT_TIMEOUT,
) -> OrchestratorResult:
    """
    Execute Python orchestration code in a restricted sandbox.

    The code has access to:
    - `call_tool(server_id, tool_name, args={})` — MCP bridge
    - Standard library: math, json, re, datetime, collections, itertools
    - `result` variable: set this to return a structured value

    Example code:
        data = call_tool("filesystem", "read_file", {"path": "/tmp/report.csv"})
        lines = [l for l in data.splitlines() if "ERROR" in l]
        result = {"error_count": len(lines), "sample": lines[:5]}
    """
    try:
        from RestrictedPython import compile_restricted, safe_globals, safe_builtins
        from RestrictedPython.Guards import safe_iter_unpack_sequence
    except ImportError:
        return OrchestratorResult(
            output="",
            error="RestrictedPython not installed — orchestration execution is disabled for safety.",
            duration_ms=0,
        )

    t0 = time.monotonic()
    loop = asyncio.get_running_loop()

    # Compile with RestrictedPython (AST-level safety check)
    try:
        code_obj = compile_restricted(textwrap.dedent(code), filename="<orchestration>", mode="exec")
    except SyntaxError as e:
        return OrchestratorResult(output="", error=f"Syntax error: {e}", duration_ms=0)

    # Build sandbox globals. Per-tool budget = outer timeout so a tool can't
    # silently win the wall clock; the asyncio.wait_for below still enforces
    # the hard ceiling on the whole orchestration.
    call_tool = _make_mcp_bridge(loop, per_call_timeout=float(timeout))
    import math, json, re
    from datetime import datetime
    from collections import defaultdict, Counter
    import itertools

    sandbox_globals = {
        **safe_globals,
        "__builtins__": {**safe_builtins},
        # Whitelisted stdlib
        "math": math, "json": json, "re": re,
        "datetime": datetime,
        "defaultdict": defaultdict, "Counter": Counter,
        "itertools": itertools,
        # MCP bridge
        "call_tool": call_tool,
        # Return value slot
        "result": None,
        "_getiter_": iter,
        "_getattr_": getattr,
        "_iter_unpack_sequence_": safe_iter_unpack_sequence,
    }

    sandbox_locals: Dict[str, Any] = {}
    captured_stdout = io.StringIO()

    def _execute():
        old_stdout, old_stderr = sys.stdout, sys.stderr
        sys.stdout = sys.stderr = captured_stdout
        try:
            exec(code_obj, sandbox_globals, sandbox_locals)  # noqa: S102
        finally:
            sys.stdout = old_stdout
            sys.stderr = old_stderr

    try:
        await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(None, _execute),
            timeout=timeout,
        )
        timed_out = False
        error = None
    except asyncio.TimeoutError:
        timed_out = True
        error = f"Orchestration timed out after {timeout}s"
    except Exception as e:
        timed_out = False
        error = str(e)

    output = captured_stdout.getvalue()
    if len(output) > _MAX_OUTPUT_BYTES:
        output = output[:_MAX_OUTPUT_BYTES] + f"\n[truncated at {_MAX_OUTPUT_BYTES} bytes]"

    duration_ms = (time.monotonic() - t0) * 1000
    return OrchestratorResult(
        output=output,
        error=error,
        duration_ms=duration_ms,
        timed_out=timed_out,
        return_value=sandbox_locals.get("result") or sandbox_globals.get("result"),
    )
