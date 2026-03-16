import uuid
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from app.sandbox.service import SandboxService
from app.sandbox.debugger import start_debugger_session
import asyncio
import json
from fastapi.responses import StreamingResponse

router = APIRouter()
service = SandboxService()

_active_debuggers: dict = {}


class RunRequest(BaseModel):
    code: str = Field(min_length=1, max_length=50000)
    language: str = ""
    timeout: Optional[int] = Field(default=None, ge=1, le=60)


class CheckRequest(BaseModel):
    code: str = Field(min_length=1, max_length=50000)
    language: str = ""


class KillRequest(BaseModel):
    run_id: str


@router.post("/check")
async def check_syntax(req: CheckRequest):
    return await service.check(code=req.code, language=req.language)


@router.post("/run")
async def run_code(req: RunRequest):
    run_id = str(uuid.uuid4())
    result = await service.run(
        code=req.code,
        language=req.language,
        timeout=req.timeout,
        run_id=run_id,
    )
    result["run_id"] = run_id
    return result


@router.post("/kill")
async def kill_run(req: KillRequest):
    killed = await service.kill(req.run_id)
    return {"killed": killed}


class DebugStartRequest(BaseModel):
    code: str = Field(min_length=1, max_length=50000)
    filename: str = Field(default="<string>", max_length=512)
    breakpoints: list[int] = Field(default_factory=list)


class DebugCommandRequest(BaseModel):
    command: str = Field(pattern=r"^(continue|next|step|stop|eval:.+)$")


@router.post("/debug/start")
async def debug_start(req: DebugStartRequest):
    """Start a new debugger session. Returns a debug_id for subsequent commands."""
    debug_id = str(uuid.uuid4())[:8]
    dbg = start_debugger_session(req.code, req.filename)
    # Set breakpoints before execution begins
    for lineno in req.breakpoints:
        dbg.set_break(req.filename, lineno)
    _active_debuggers[debug_id] = dbg
    return {"debug_id": debug_id}


@router.post("/debug/{debug_id}/command")
async def debug_command(debug_id: str, req: DebugCommandRequest):
    """Send a command (continue/next/step/stop/eval:<expr>) to a running debugger."""
    dbg = _active_debuggers.get(debug_id)
    if not dbg:
        raise HTTPException(status_code=404, detail=f"No active debug session: {debug_id}")
    dbg.cmd_queue.put(req.command)
    return {"sent": req.command}


@router.get("/debug/{debug_id}/events")
async def debug_events(debug_id: str):
    """SSE stream of debugger state events (line stops, eval results, errors, finish)."""
    dbg = _active_debuggers.get(debug_id)
    if not dbg:
        raise HTTPException(status_code=404, detail=f"No active debug session: {debug_id}")

    async def event_stream():
        loop = asyncio.get_running_loop()
        try:
            while True:
                state = await loop.run_in_executor(None, dbg.state_queue.get)
                yield f"data: {json.dumps(state)}\n\n"
                if state.get("status") == "finished" or state.get("error"):
                    _active_debuggers.pop(debug_id, None)
                    break
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            _active_debuggers.pop(debug_id, None)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
