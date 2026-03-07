"""API endpoints for the NanoCore agent terminal."""

import asyncio
import json
import uuid
import logging
import time

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.agents.nanocore.types import TerminalRequest, DiffDecision, EscalationResponse, UndoRequest
from app.agents.nanocore.supervisor import SupervisorAgent
from app.agents.nanocore.tools import run_bash
from app.agents.nanocore.prompts import FILE_CONTEXT_INSTRUCTION
from app.agents.nanocore.scout import ScoutAgent

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
    logger.info(f"Agent session created: {session_id} model={request.model_id} mode={request.mode or 'edit'}")

    agent = SupervisorAgent(
        session_id=session_id,
        model_id=request.model_id,
        max_iterations=request.max_iterations,
        temperature=request.temperature,
        max_total_tokens=request.max_total_tokens,
        mode=request.mode,
        workspace_dir=request.workspace_dir,
        enable_moa=request.enable_moa,
        air_gapped_mode=request.air_gapped_mode,
        enable_python_sandbox=request.enable_python_sandbox,
    )
    async with _sessions_lock:
        _active_sessions[session_id] = agent

    # Build prompt with active file context if provided
    prompt = request.prompt
    if request.active_file:
        ctx_parts = [f"[Currently open file: {request.active_file.path}]"]
        if request.active_file.language:
            ctx_parts.append(f"[Language: {request.active_file.language}]")
        if request.active_file.content is not None:
            ctx_parts.append(f"[File content]\n```\n{request.active_file.content}\n```")
        ctx_parts.append(FILE_CONTEXT_INSTRUCTION)
        prompt = "\n".join(ctx_parts) + "\n\n" + prompt

    # Build conversation history from prior turns
    history = []
    if request.history:
        for turn in request.history[-10:]:  # keep last 10 turns max
            history.append({"role": turn.role, "content": turn.content})

    async def event_generator():
        # Queue to merge events from supervisor and scout
        queue = asyncio.Queue()
        
        async def put_agent_events():
            try:
                active_file_path = request.active_file.path if request.active_file else None
                async for event in agent.run(prompt, history=history, active_file_path=active_file_path):
                    await queue.put(event)
            except Exception as e:
                logger.error(f"Supervisor error: {e}")
                await queue.put({"event": "error", "data": {"message": str(e)}})
            finally:
                await queue.put({"event": "done_internal", "data": {}})

        # Scout agent: background monitor
        scout = ScoutAgent(request.workspace_dir)
        async def scout_emitter(event):
            await queue.put(event)
        
        agent_task = asyncio.create_task(put_agent_events())
        await scout.start(scout_emitter)

        try:
            while True:
                event = await queue.get()
                if event.get("event") == "done_internal":
                    break
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            logger.error(f"Terminal stream error: {e}")
            yield f"data: {json.dumps({'event': 'error', 'data': {'message': str(e)}})}\n\n"
        finally:
            agent_task.cancel()
            await scout.stop()
            agent.stop()
            await agent.process_manager.cleanup_all()
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


@router.post("/escalation/respond")
async def respond_to_escalation(response: EscalationResponse):
    """Provide user guidance for a stuck agent."""
    async with _sessions_lock:
        agent = _active_sessions.get(response.session_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Session not found")

    ok = agent.resolve_escalation(response.escalation_id, response.user_message)
    if not ok:
        raise HTTPException(status_code=404, detail="Escalation not found or already resolved")

    return {"status": "resolved"}


@router.post("/undo")
async def undo_last_edit(request: UndoRequest):
    """Undo the last approved edit in the given session."""
    async with _sessions_lock:
        agent = _active_sessions.get(request.session_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Session not found")

    result = await agent.undo_last()
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["error"])

    return {"status": "undone", "file_path": result["file_path"]}


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
