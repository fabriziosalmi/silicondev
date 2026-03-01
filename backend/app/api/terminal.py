"""API endpoints for the NanoCore agent terminal."""

import asyncio
import json
import uuid
import logging
import time

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.agents.nanocore.types import TerminalRequest, DiffDecision
from app.agents.nanocore.supervisor import SupervisorAgent
from app.agents.nanocore.tools import run_bash

logger = logging.getLogger(__name__)

router = APIRouter()

# Active sessions keyed by session_id
_active_sessions: dict[str, SupervisorAgent] = {}
_sessions_lock = asyncio.Lock()


class ExecRequest(BaseModel):
    command: str = Field(min_length=1, max_length=4096)
    timeout: int = Field(default=60, ge=1, le=300)


@router.post("/exec")
async def exec_command(request: ExecRequest):
    """Execute a shell command directly via PTY. Returns SSE stream."""
    call_id = str(uuid.uuid4())[:8]
    t0 = time.time()

    async def event_generator():
        yield f"data: {json.dumps({'event': 'tool_start', 'data': {'tool': 'run_bash', 'args': {'command': request.command}, 'call_id': call_id}})}\n\n"

        exit_code = 0
        try:
            async for stream, text in run_bash(request.command, timeout=request.timeout):
                yield f"data: {json.dumps({'event': 'tool_log', 'data': {'call_id': call_id, 'stream': stream, 'text': text}})}\n\n"
                if stream == "stderr" and "Blocked:" in text:
                    exit_code = 1
        except Exception as e:
            yield f"data: {json.dumps({'event': 'error', 'data': {'message': str(e)}})}\n\n"
            exit_code = 1

        elapsed = int((time.time() - t0) * 1000)
        yield f"data: {json.dumps({'event': 'tool_done', 'data': {'call_id': call_id, 'exit_code': exit_code}})}\n\n"
        yield f"data: {json.dumps({'event': 'done', 'data': {'total_tokens': 0, 'total_time_ms': elapsed}})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/run")
async def run_terminal(request: TerminalRequest):
    """Start an agent session. Returns an SSE stream of events."""
    session_id = str(uuid.uuid4())

    agent = SupervisorAgent(
        session_id=session_id,
        model_id=request.model_id,
        max_iterations=request.max_iterations,
        temperature=request.temperature,
    )
    async with _sessions_lock:
        _active_sessions[session_id] = agent

    async def event_generator():
        try:
            async for event in agent.run(request.prompt):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            logger.error(f"Terminal session error: {e}")
            yield f"data: {json.dumps({'event': 'error', 'data': {'message': str(e)}})}\n\n"
        finally:
            agent.stop()
            async with _sessions_lock:
                _active_sessions.pop(session_id, None)
            logger.info(f"Terminal session {session_id} cleaned up")

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/diff/decide")
async def decide_diff(decision: DiffDecision):
    """Approve or reject a pending diff proposal."""
    async with _sessions_lock:
        agent = _active_sessions.get(decision.session_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Session not found")

    ok = agent.resolve_diff(decision.call_id, decision.approved, decision.reason)
    if not ok:
        raise HTTPException(status_code=404, detail="Diff not found or already resolved")

    return {"status": "resolved", "approved": decision.approved}


@router.post("/stop")
async def stop_terminal(body: dict = {}):
    """Stop a running agent session."""
    session_id = body.get("session_id", "")
    async with _sessions_lock:
        agent = _active_sessions.get(session_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Session not found")

    agent.stop()
    return {"status": "stopping"}
