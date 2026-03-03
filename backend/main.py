from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
import uvicorn
import os
import sys
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

# Log directory: ~/.silicon-studio/logs/
_LOG_DIR = Path.home() / ".silicon-studio" / "logs"
_LOG_DIR.mkdir(parents=True, exist_ok=True)

# Configure logging — stdout + rotating file
_log_format = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
_handlers: list[logging.Handler] = [logging.StreamHandler(sys.stdout)]
try:
    _file_handler = RotatingFileHandler(
        str(_LOG_DIR / "app.log"),
        maxBytes=5 * 1024 * 1024,  # 5 MB per file
        backupCount=3,
        encoding="utf-8",
    )
    _file_handler.setFormatter(logging.Formatter(_log_format))
    _handlers.append(_file_handler)
except OSError:
    pass  # fall back to stdout-only if disk is read-only

logging.basicConfig(
    level=logging.INFO,
    format=_log_format,
    handlers=_handlers,
)
logger = logging.getLogger(__name__)

logger.info("Starting main.py imports...")

try:
    from app.api.monitor import router as monitor_router
    logger.info("Imported monitor router")
    from app.api.preparation import router as preparation_router
    logger.info("Imported preparation router")
    from app.api.engine import router as engine_router
    logger.info("Imported engine router")
    from app.api.deployment import router as deployment_router
    logger.info("Imported deployment router")
    from app.api.rag import router as rag_router
    logger.info("Imported rag router")
    from app.api.agents import router as agents_router
    logger.info("Imported agents router")
    from app.api.conversations import router as conversations_router
    logger.info("Imported conversations router")
    from app.api.sandbox import router as sandbox_router
    logger.info("Imported sandbox router")
    from app.api.notes import router as notes_router
    logger.info("Imported notes router")
    from app.api.search import router as search_router
    logger.info("Imported search router")
    from app.api.mcp import router as mcp_router
    logger.info("Imported mcp router")
    from app.api.indexer import router as indexer_router
    logger.info("Imported indexer router")
    from app.api.terminal import router as terminal_router
    logger.info("Imported terminal router")
    from app.api.codebase import router as codebase_router
    logger.info("Imported codebase router")
    from app.api.workspace import router as workspace_router
    logger.info("Imported workspace router")

except Exception as e:
    logger.critical(f"Import error: {e}", exc_info=True)
    sys.exit(1)

def _start_parent_watchdog():
    """If launched by Electron, poll the parent PID every 5s.

    When the parent dies (segfault, SIGKILL), we get no SIGTERM, so
    the backend stays alive as an orphan. This watchdog catches that
    and exits cleanly.
    """
    parent_pid_str = os.environ.get("SILICON_PARENT_PID")
    if not parent_pid_str:
        return  # not launched by Electron — skip
    parent_pid = int(parent_pid_str)
    import threading, signal

    def _watch():
        while True:
            import time
            time.sleep(5)
            try:
                os.kill(parent_pid, 0)  # signal 0 = existence check
            except OSError:
                logger.warning(f"Parent process {parent_pid} gone — exiting")
                os.kill(os.getpid(), signal.SIGTERM)
                return

    t = threading.Thread(target=_watch, daemon=True)
    t.start()
    logger.info(f"Parent watchdog started (parent PID={parent_pid})")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown hooks.

    On shutdown: unload models, stop indexer, kill NanoCore background
    processes so macOS releases the port immediately.
    """
    logger.info("SiliconDev backend starting up")
    _start_parent_watchdog()
    yield
    logger.info("SiliconDev backend shutting down — cleaning up resources")

    # 1. Stop background indexer
    try:
        from app.search.indexer import indexer_service
        if hasattr(indexer_service, 'stop_background'):
            indexer_service.stop_background()
            logger.info("Stopped background indexer")
    except Exception as e:
        logger.debug(f"Indexer shutdown: {e}")

    # 2. Unload MLX model and stop any active jobs
    try:
        from app.api.engine import service as engine_service
        engine_service.stop_generation()
        if engine_service.active_model is not None:
            await engine_service.unload_model()
            logger.info("Unloaded MLX model")
    except Exception as e:
        logger.debug(f"Engine shutdown: {e}")

    # 3. Kill any NanoCore terminal sessions
    try:
        from app.api.terminal import _active_sessions, _sessions_lock
        async with _sessions_lock:
            for sid, agent in list(_active_sessions.items()):
                agent.stop()
                await agent.process_manager.cleanup_all()
            _active_sessions.clear()
        logger.info("Cleaned up terminal sessions")
    except Exception as e:
        logger.debug(f"Terminal shutdown: {e}")

    logger.info("Shutdown complete")


app = FastAPI(
    title="SiliconDev Backend",
    description="Local-first LLM fine-tuning engine",
    version="0.6.1",
    lifespan=lifespan,
)

# Configure CORS for local development securely
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "app://."
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Return validation errors in a readable format instead of raw 422."""
    errors = []
    for err in exc.errors():
        loc = " -> ".join(str(l) for l in err.get("loc", []))
        errors.append(f"{loc}: {err.get('msg', 'invalid')}")
    return JSONResponse(
        status_code=422,
        content={
            "detail": "Validation error",
            "errors": errors,
        },
    )


app.include_router(monitor_router, prefix="/api/monitor", tags=["monitor"])
app.include_router(preparation_router, prefix="/api/preparation", tags=["preparation"])
app.include_router(engine_router, prefix="/api/engine", tags=["engine"])
app.include_router(deployment_router, prefix="/api/deployment", tags=["deployment"])
app.include_router(rag_router, prefix="/api/rag", tags=["rag"])
app.include_router(agents_router, prefix="/api/agents", tags=["agents"])
app.include_router(conversations_router, prefix="/api/conversations", tags=["conversations"])
app.include_router(sandbox_router, prefix="/api/sandbox", tags=["sandbox"])
app.include_router(notes_router, prefix="/api/notes", tags=["notes"])
app.include_router(search_router, prefix="/api/search", tags=["search"])
app.include_router(mcp_router, prefix="/api/mcp", tags=["mcp"])
app.include_router(indexer_router, prefix="/api/indexer", tags=["indexer"])
app.include_router(terminal_router, prefix="/api/terminal", tags=["terminal"])
app.include_router(codebase_router, prefix="/api/codebase", tags=["codebase"])
app.include_router(workspace_router, prefix="/api/workspace", tags=["workspace"])


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "silicondev-engine"}

if __name__ == "__main__":
    import multiprocessing
    import socket
    multiprocessing.freeze_support()

    preferred = int(os.getenv("PORT", 8000))
    port = preferred

    for candidate in [preferred] + list(range(8001, 8100)):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.bind(("127.0.0.1", candidate))
            sock.close()
            port = candidate
            break
        except OSError:
            continue
    else:
        logger.critical("No free port found in range 8000-8099")
        sys.exit(1)

    # Signal chosen port to Electron parent process
    print(f"SILICON_PORT={port}", flush=True)
    logger.info(f"Uvicorn starting on port {port}")
    uvicorn.run(app, host="127.0.0.1", port=port, reload=False)
