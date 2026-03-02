from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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

except Exception as e:
    logger.critical(f"Import error: {e}", exc_info=True)
    sys.exit(1)

app = FastAPI(
    title="SiliconDev Backend",
    description="Local-first LLM fine-tuning engine",
    version="0.4.2"
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
