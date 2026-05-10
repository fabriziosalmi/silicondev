from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import time
import logging
import threading
from collections import deque
from app.api.engine import service

logger = logging.getLogger(__name__)

router = APIRouter()

# Global state to keep track of the native server
native_server_start_time = None
server_logs: deque = deque(maxlen=500)
_log_lock = threading.Lock()
_proc_lock = threading.Lock()

def _add_log(label: str, message: str):
    with _log_lock:
        server_logs.append({
            "timestamp": time.time(),
            "source": label,
            "message": message,
        })

class StartRequest(BaseModel):
    model_path: str = Field(min_length=1, max_length=1024, pattern=r'\S')
    host: str = Field(default="127.0.0.1", max_length=255)
    port: int = Field(default=8080, ge=1024, le=65535)

@router.post("/start")
async def start_server(req: StartRequest):
    global native_server_start_time
    with _proc_lock:
        try:
            # We are using native routing, so we just load the model.
            _add_log("system", f"Loading model {req.model_path} into native API runtime...")
            # Fire and forget load, or await it. We can await it since it's an async endpoint.
            # But await service.load_active_model requires loop
        except Exception as e:
             raise HTTPException(status_code=500, detail=str(e))
             
    try:
        await service.load_active_model(req.model_path)
    except Exception as e:
        logger.error(f"Failed to start deployment server natively: {e}")
        _add_log("error", f"Failed to load model natively: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    with _proc_lock:
        server_logs.clear()
        native_server_start_time = time.time()
        _add_log("system", f"Native Deployment server started for {req.model_path}.")
        _add_log("stdout", f"Native /v1/chat/completions available on main backend port.")
        
        logger.info(f"Deployment server started natively")
        # We tell the frontend we succeeded. 
        # The frontend expects a PID, we can return our own PID or a fake one.
        import os
        return {"status": "success", "message": f"Native API Server loaded {req.model_path}", "pid": os.getpid()}

@router.post("/stop")
async def stop_server():
    global native_server_start_time
    with _proc_lock:
        if native_server_start_time is None:
            return {"status": "success", "message": "Server is not running."}

    try:
        await service.unload_model()
    except Exception as e:
        logger.warning(f"Error unloading model natively: {e}")
        
    with _proc_lock:
        logger.info("Deployment server stopped.")
        native_server_start_time = None
        _add_log("system", "Native server stopped.")
    return {"status": "success", "message": "API Server stopped."}

@router.get("/status")
async def get_status():
    global native_server_start_time
    with _proc_lock:
        # It's running if we have a start time
        is_running = native_server_start_time is not None

        uptime = None
        if is_running and native_server_start_time:
            uptime = round(time.time() - native_server_start_time)

        import os
        return {
            "running": is_running,
            "pid": os.getpid() if is_running else None,
            "uptime_seconds": uptime,
        }

@router.get("/logs")
async def get_logs(since: float = 0):
    """Return log entries newer than `since` (unix timestamp)."""
    with _log_lock:
        entries = [e for e in server_logs if e["timestamp"] > since]
    return {"logs": entries}

