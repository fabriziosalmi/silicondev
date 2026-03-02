import shutil
import logging
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.monitor.system import SystemMonitor

logger = logging.getLogger(__name__)
router = APIRouter()

_DATA_DIR = Path.home() / ".silicon-studio"


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
