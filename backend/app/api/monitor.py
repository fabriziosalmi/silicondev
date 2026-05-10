import shutil
import logging
from collections import deque
from pathlib import Path
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from app.monitor.system import SystemMonitor
from app.monitor import traces as trace_store

logger = logging.getLogger(__name__)
router = APIRouter()

_DATA_DIR = Path.home() / ".silicon-studio"
_LOG_FILE = _DATA_DIR / "logs" / "app.log"


@router.get("/stats")
async def get_system_stats():
    """
    Get real-time system statistics (RAM, CPU, Disk).
    Used for the 'Memory Tetris' visualization.
    """
    return SystemMonitor.get_system_stats()


def _dir_size_bytes(path: Path) -> int:
    """Total bytes used by a directory tree."""
    if not path.exists():
        return 0
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


@router.get("/storage")
async def get_storage_info():
    """Report disk usage per category inside ~/.silicon-studio/."""
    categories = {
        "models": _DATA_DIR / "models",
        "adapters": _DATA_DIR / "adapters",
        "conversations": _DATA_DIR / "conversations",
        "notes": _DATA_DIR / "notes",
        "rag": _DATA_DIR / "rag",
        "logs": _DATA_DIR / "logs",
    }
    breakdown = {}
    total = 0
    for name, path in categories.items():
        size = _dir_size_bytes(path)
        breakdown[name] = size
        total += size
    return {"total_bytes": total, "breakdown": breakdown, "path": str(_DATA_DIR)}


class CleanupRequest(BaseModel):
    targets: list[str]  # e.g. ["logs", "conversations", "notes"]


@router.post("/storage/cleanup")
async def cleanup_storage(request: CleanupRequest):
    """Delete data in the specified categories. Models/adapters require explicit deletion."""
    safe_targets = {"logs", "conversations", "notes"}
    freed = 0
    cleaned = []

    for target in request.targets:
        if target not in safe_targets:
            continue
        target_dir = _DATA_DIR / target
        if not target_dir.exists():
            continue
        size_before = _dir_size_bytes(target_dir)
        try:
            shutil.rmtree(target_dir)
            target_dir.mkdir(parents=True, exist_ok=True)
            freed += size_before
            cleaned.append(target)
            logger.info(f"Cleaned {target}: freed {size_before / (1024*1024):.1f} MB")
        except OSError as e:
            logger.error(f"Failed to clean {target}: {e}")

    return {"freed_bytes": freed, "cleaned": cleaned}


@router.get("/logs")
async def get_logs(lines: int = Query(200, ge=1, le=2000)):
    """Return the last N lines of the backend log file."""
    if not _LOG_FILE.exists():
        return {"lines": []}
    try:
        with open(_LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
            tail = deque(f, maxlen=lines)
        return {"lines": [line.rstrip("\n") for line in tail]}
    except OSError as e:
        logger.error(f"Failed to read log file: {e}")
        return {"lines": [f"Error reading log: {e}"]}


# ── P1.5 Observability Endpoints ───────────────────────────────────────────────────

@router.get("/traces")
async def get_traces(
    limit: int = Query(100, ge=1, le=1000),
    operation: str = Query(default=None),
):
    """Return recent request/tool traces (newest first)."""
    return {"traces": trace_store.get_recent_traces(limit=limit, operation=operation)}


@router.get("/tokens")
async def get_token_usage():
    """Return cumulative token usage broken down by model."""
    return {"usage": trace_store.get_token_usage()}


@router.get("/health")
async def get_health_dashboard():
    """
    Unified health dashboard: system stats + observability summary.

    Combines:
    - Real-time system metrics (RAM, CPU, GPU, disk)
    - Request trace summary (error rate, latency p95, token totals)
    - MCP audit log stats
    - Active coder loop sessions
    """
    system = SystemMonitor.get_system_stats()
    obs = trace_store.get_summary()

    # MCP audit recent error rate
    try:
        from app.mcp.audit import get_recent as mcp_recent
        recent_mcp = mcp_recent(50)
        mcp_errors = sum(1 for e in recent_mcp if e.get("status") != "ok")
        mcp_stats = {"recent_calls": len(recent_mcp), "recent_errors": mcp_errors}
    except Exception:
        mcp_stats = {}

    # Active coder loop sessions
    try:
        from app.api.coder_loop import _active_loops
        coder_sessions = len(_active_loops)
    except Exception:
        coder_sessions = 0

    return {
        "system": system,
        "observability": obs,
        "mcp": mcp_stats,
        "coder_loop_active_sessions": coder_sessions,
    }
