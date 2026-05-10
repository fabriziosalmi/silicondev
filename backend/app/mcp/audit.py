"""MCP Audit Log — append-only JSONL record of every MCP tool execution."""
import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_AUDIT_FILE = Path.home() / ".silicon-studio" / "mcp_audit.jsonl"
_MAX_AUDIT_BYTES = 10 * 1024 * 1024  # rotate at 10 MB
_lock = threading.Lock()


def record(
    *,
    server_id: str,
    tool_name: str,
    tool_args: Dict[str, Any],
    status: str,          # "ok" | "error" | "timeout"
    duration_ms: float,
    result_preview: str = "",
    error: Optional[str] = None,
    attempts: int = 1,
):
    """Append one audit entry to the JSONL log. Non-blocking best-effort write."""
    entry = {
        "ts": time.time(),
        "server_id": server_id,
        "tool": tool_name,
        "args": _safe_truncate(tool_args),
        "status": status,
        "duration_ms": round(duration_ms, 1),
        "attempts": attempts,
    }
    if result_preview:
        entry["result_preview"] = result_preview[:300]
    if error:
        entry["error"] = error[:500]

    line = json.dumps(entry, default=str)
    with _lock:
        try:
            _AUDIT_FILE.parent.mkdir(parents=True, exist_ok=True)
            # Simple rotation: rename to .1 when too large
            if _AUDIT_FILE.exists() and _AUDIT_FILE.stat().st_size > _MAX_AUDIT_BYTES:
                rotated = _AUDIT_FILE.with_suffix(".jsonl.1")
                os.replace(_AUDIT_FILE, rotated)
            with open(_AUDIT_FILE, "a") as f:
                f.write(line + "\n")
        except Exception as exc:
            logger.warning("MCP audit write failed: %s", exc)


def get_recent(limit: int = 100) -> List[Dict[str, Any]]:
    """Return the last `limit` audit entries, newest first."""
    if not _AUDIT_FILE.exists():
        return []
    try:
        with open(_AUDIT_FILE, "r") as f:
            lines = f.readlines()
        entries = []
        for line in reversed(lines):
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue
            if len(entries) >= limit:
                break
        return entries
    except Exception as exc:
        logger.warning("MCP audit read failed: %s", exc)
        return []


def _safe_truncate(args: Dict[str, Any], max_len: int = 512) -> Dict[str, Any]:
    """Truncate large string arg values to keep audit entries readable."""
    out = {}
    for k, v in args.items():
        if isinstance(v, str) and len(v) > max_len:
            out[k] = v[:max_len] + "…"
        else:
            out[k] = v
    return out
