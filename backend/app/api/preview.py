"""Live preview server management.

Starts/stops a dev server (Vite, Next.js, Flask, static, etc.) for the
user's workspace and exposes it via a localhost port.  The frontend
renders it in an iframe.
"""

import os
import signal
import socket
import subprocess
import threading
import time
import logging
from collections import deque
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.engine.project_detector import detect_project, ProjectType

logger = logging.getLogger(__name__)

router = APIRouter()

# ── State ───────────────────────────────────────────────────────

_preview_process: Optional[subprocess.Popen] = None
_preview_port: Optional[int] = None
_preview_type: Optional[str] = None
_preview_start_time: Optional[float] = None
_preview_workspace: Optional[str] = None
_preview_logs: deque = deque(maxlen=300)
_lock = threading.Lock()


def _read_pipe(pipe, label: str):
    """Stream subprocess output into the ring buffer."""
    try:
        for raw in iter(pipe.readline, b""):
            line = raw.decode("utf-8", errors="replace").rstrip()
            if line:
                _preview_logs.append({
                    "timestamp": time.time(),
                    "source": label,
                    "message": line,
                })
    except Exception as e:
        logger.warning("Preview pipe read failed (%s): %s", label, e)
    finally:
        pipe.close()


def _find_free_port(start: int = 3100, end: int = 3199) -> int:
    """Find a free TCP port in the given range."""
    for port in range(start, end + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise OSError(f"No free port in range {start}-{end}")


def _wait_for_port(port: int, timeout: float = 15.0) -> bool:
    """Poll until the port is reachable or timeout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return True
        time.sleep(0.3)
    return False


# ── Endpoints ───────────────────────────────────────────────────

class PreviewStartRequest(BaseModel):
    workspace_dir: str = Field(min_length=1, max_length=2048)
    command: Optional[str] = Field(default=None, max_length=1024)
    port: Optional[int] = Field(default=None, ge=1024, le=65535)


@router.post("/start")
async def start_preview(req: PreviewStartRequest):
    """Start a dev server for the workspace.

    Auto-detects project type if no command is given.
    Picks a free port if none is specified.
    """
    global _preview_process, _preview_port, _preview_type
    global _preview_start_time, _preview_workspace

    with _lock:
        if _preview_process is not None and _preview_process.poll() is None:
            # Already running — return current state
            return {
                "status": "already_running",
                "port": _preview_port,
                "type": _preview_type,
                "pid": _preview_process.pid,
            }

        # Detect project type
        proj_type, default_cmd, default_port = detect_project(req.workspace_dir)
        command = req.command or default_cmd
        if not command:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot auto-detect dev server for this project ({proj_type}). Pass a command manually.",
            )

        # Pick port
        port = req.port or default_port or _find_free_port()

        # Inject port into command if it has a placeholder or known pattern
        if "{port}" in command:
            command = command.replace("{port}", str(port))
        elif "--port" not in command and "-p" not in command:
            # For npm/pnpm/yarn dev, set PORT env var (works with Vite, CRA, Next)
            pass  # We'll use PORT env var below

        _preview_logs.clear()

        env = {**os.environ, "PORT": str(port), "BROWSER": "none"}

        try:
            _preview_process = subprocess.Popen(
                command,
                shell=True,
                cwd=req.workspace_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
                preexec_fn=os.setsid if os.name == "posix" else None,
            )
            _preview_port = port
            _preview_type = proj_type.value
            _preview_start_time = time.time()
            _preview_workspace = req.workspace_dir

            # Stream output to ring buffer
            for pipe, label in [
                (_preview_process.stdout, "stdout"),
                (_preview_process.stderr, "stderr"),
            ]:
                threading.Thread(target=_read_pipe, args=(pipe, label), daemon=True).start()

            logger.info("Preview started: %s on port %d (PID %d)", command, port, _preview_process.pid)

            # Wait for port to become reachable (non-blocking for the caller
            # since we return immediately — the frontend polls /status)
            threading.Thread(
                target=lambda: _wait_for_port(port, timeout=20),
                daemon=True,
            ).start()

            return {
                "status": "started",
                "port": port,
                "type": proj_type.value,
                "pid": _preview_process.pid,
                "command": command,
            }
        except Exception as e:
            logger.error("Preview start failed: %s", e)
            _preview_process = None
            _preview_port = None
            raise HTTPException(status_code=500, detail=str(e))


@router.post("/stop")
async def stop_preview():
    """Stop the running preview server."""
    global _preview_process, _preview_port, _preview_type
    global _preview_start_time, _preview_workspace

    with _lock:
        if _preview_process is None or _preview_process.poll() is not None:
            _preview_process = None
            _preview_port = None
            _preview_type = None
            _preview_start_time = None
            return {"status": "not_running"}

        try:
            if os.name == "posix":
                os.killpg(os.getpgid(_preview_process.pid), signal.SIGTERM)
            else:
                _preview_process.terminate()
            _preview_process.wait(timeout=5)
        except Exception as e:
            logger.warning("Graceful preview stop failed, force-killing: %s", e)
            if _preview_process:
                _preview_process.kill()

        logger.info("Preview stopped (was on port %d)", _preview_port or 0)
        _preview_process = None
        _preview_port = None
        _preview_type = None
        _preview_start_time = None
        _preview_workspace = None

    return {"status": "stopped"}


@router.get("/status")
async def preview_status():
    """Return current preview server status."""
    with _lock:
        running = _preview_process is not None and _preview_process.poll() is None

        # Clean up if crashed
        if _preview_process is not None and not running:
            _preview_process = None

        # Check if port is actually reachable
        ready = False
        if running and _preview_port:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.3)
                ready = s.connect_ex(("127.0.0.1", _preview_port)) == 0

        return {
            "running": running,
            "ready": ready,
            "port": _preview_port if running else None,
            "type": _preview_type if running else None,
            "pid": _preview_process.pid if running else None,
            "uptime_seconds": round(time.time() - _preview_start_time) if running and _preview_start_time else None,
            "workspace": _preview_workspace if running else None,
        }


@router.get("/detect")
async def detect_project_type(workspace_dir: str):
    """Detect the project type for a workspace without starting a server."""
    proj_type, command, port = detect_project(workspace_dir)
    return {
        "type": proj_type.value,
        "command": command,
        "port": port,
    }


@router.get("/logs")
async def preview_logs(since: float = 0, limit: int = 100):
    """Return recent log entries."""
    entries = [e for e in _preview_logs if e["timestamp"] > since]
    return {"logs": entries[-limit:]}
