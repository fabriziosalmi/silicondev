"""P1.5 — Observability: Structured Request/Tool Trace Collector

Provides:
- Per-request trace recording (latency, model, token usage, tool calls)
- Token usage accounting aggregated by model
- In-memory ring buffer (last 1000 requests) + optional JSONL flush to disk
- Thread-safe, non-blocking (best-effort append)
"""
import json
import logging
import os
import tempfile
import threading
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_TRACE_FILE = Path.home() / ".silicon-studio" / "traces.jsonl"
_MAX_IN_MEMORY = 1000
_MAX_TRACE_FILE_BYTES = 20 * 1024 * 1024  # rotate at 20 MB
_lock = threading.Lock()

# In-memory ring buffer
_traces: deque = deque(maxlen=_MAX_IN_MEMORY)

# Token accounting: {model_id: {input: int, output: int, calls: int}}
_token_usage: Dict[str, Dict[str, int]] = {}


# ── Trace Recording ───────────────────────────────────────────────────────────

def start_trace(
    operation: str,          # "chat", "coder_loop", "agent", "mcp_tool", "rag"
    model_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> str:
    """Begin a new trace. Returns trace_id to pass to finish_trace."""
    return json.dumps({  # pack into a compact string for fast storage
        "trace_id": str(uuid.uuid4()),
        "operation": operation,
        "model_id": model_id,
        "started_at": time.time(),
        "metadata": metadata or {},
    })


def finish_trace(
    trace_ctx: str,
    *,
    status: str = "ok",          # "ok" | "error" | "timeout"
    input_tokens: int = 0,
    output_tokens: int = 0,
    tool_calls: int = 0,
    error: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
):
    """Complete a trace and persist it."""
    try:
        ctx = json.loads(trace_ctx)
    except Exception:
        return

    now = time.time()
    trace = {
        **ctx,
        "status": status,
        "finished_at": now,
        "duration_ms": round((now - ctx["started_at"]) * 1000, 1),
        "tokens": {"input": input_tokens, "output": output_tokens},
        "tool_calls": tool_calls,
    }
    if error:
        trace["error"] = error[:500]
    if extra:
        trace["extra"] = extra

    model_id = ctx.get("model_id")
    with _lock:
        _traces.append(trace)
        # Token accounting
        if model_id and (input_tokens or output_tokens):
            acc = _token_usage.setdefault(model_id, {"input": 0, "output": 0, "calls": 0})
            acc["input"] += input_tokens
            acc["output"] += output_tokens
            acc["calls"] += 1

    # Async-ish disk append (best-effort)
    _append_to_disk(trace)


def _append_to_disk(trace: Dict[str, Any]):
    """Non-blocking disk append; silently swallows IO errors."""
    line = json.dumps(trace, default=str)
    with _lock:
        try:
            _TRACE_FILE.parent.mkdir(parents=True, exist_ok=True)
            # Simple rotation
            if _TRACE_FILE.exists() and _TRACE_FILE.stat().st_size > _MAX_TRACE_FILE_BYTES:
                rotated = _TRACE_FILE.with_suffix(".jsonl.1")
                os.replace(_TRACE_FILE, rotated)
            with open(_TRACE_FILE, "a") as f:
                f.write(line + "\n")
        except Exception as exc:
            logger.debug("Trace disk write failed: %s", exc)


# ── Querying ──────────────────────────────────────────────────────────────────

def get_recent_traces(limit: int = 100, operation: Optional[str] = None) -> List[Dict]:
    with _lock:
        traces = list(_traces)
    if operation:
        traces = [t for t in traces if t.get("operation") == operation]
    return list(reversed(traces))[:limit]


def get_token_usage() -> Dict[str, Dict[str, int]]:
    with _lock:
        return {k: dict(v) for k, v in _token_usage.items()}


def get_summary() -> Dict[str, Any]:
    with _lock:
        traces = list(_traces)
        usage = {k: dict(v) for k, v in _token_usage.items()}

    total = len(traces)
    errors = sum(1 for t in traces if t.get("status") == "error")
    timeouts = sum(1 for t in traces if t.get("status") == "timeout")
    durations = [t["duration_ms"] for t in traces if "duration_ms" in t]

    total_tokens = sum(
        acc["input"] + acc["output"] for acc in usage.values()
    )

    return {
        "total_requests": total,
        "errors": errors,
        "timeouts": timeouts,
        "error_rate": round(errors / total, 4) if total else 0,
        "avg_duration_ms": round(sum(durations) / len(durations), 1) if durations else None,
        "p95_duration_ms": round(sorted(durations)[int(len(durations) * 0.95)], 1) if len(durations) >= 20 else None,
        "total_tokens_used": total_tokens,
        "token_usage_by_model": usage,
        "operations": _count_by(traces, "operation"),
    }


def _count_by(traces: List[Dict], key: str) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for t in traces:
        v = t.get(key, "unknown")
        out[v] = out.get(v, 0) + 1
    return out
