"""API endpoints for the NanoCore agent terminal."""

import asyncio
import json
import uuid
import logging
import time

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.agents.nanocore.types import TerminalRequest, DiffDecision, EscalationResponse, UndoRequest, PlanRequest, PlanDecision
from app.agents.nanocore.supervisor import SupervisorAgent
from app.agents.nanocore.planner import PlannerEditor
from app.agents.nanocore.tools import run_bash, interrupt_call
from app.agents.nanocore.prompts import FILE_CONTEXT_INSTRUCTION
from app.agents.nanocore.scout import ScoutAgent

logger = logging.getLogger(__name__)

router = APIRouter()

# Active sessions keyed by session_id (SupervisorAgent or PlannerEditor)
_active_sessions: dict[str, SupervisorAgent | PlannerEditor] = {}
# Finished sessions kept for undo — maps session_id to (agent, finish_time)
_finished_sessions: dict[str, tuple[SupervisorAgent | PlannerEditor, float]] = {}
_sessions_lock = asyncio.Lock()

SESSION_TTL = 600  # 10 minutes
MAX_FINISHED_SESSIONS = 50


async def _cleanup_expired_sessions():
    """Remove finished sessions older than SESSION_TTL or exceeding cap."""
    now = time.time()
    expired = [sid for sid, (_, t) in _finished_sessions.items() if now - t > SESSION_TTL]
    for sid in expired:
        _finished_sessions.pop(sid, None)
    # Hard cap: drop oldest if still over limit
    if len(_finished_sessions) > MAX_FINISHED_SESSIONS:
        by_age = sorted(_finished_sessions.items(), key=lambda x: x[1][1])
        for sid, _ in by_age[: len(_finished_sessions) - MAX_FINISHED_SESSIONS]:
            _finished_sessions.pop(sid, None)


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
            async for stream, text in run_bash(request.command, timeout=request.timeout, call_id=call_id):
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

    # Pass the engine service's router so the supervisor can use
    # role-based model selection (planner, coder, reviewer, etc.)
    from app.api.engine import service as engine_service
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
        router=engine_service.router,
    )
    async with _sessions_lock:
        _active_sessions[session_id] = agent
        await _cleanup_expired_sessions()

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
                _finished_sessions[session_id] = (agent, time.time())
                await _cleanup_expired_sessions()
            logger.info(f"Terminal session {session_id} moved to finished (undo available for {SESSION_TTL}s)")

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


async def _find_agent(session_id: str) -> SupervisorAgent | PlannerEditor | None:
    """Find agent in active or finished sessions."""
    async with _sessions_lock:
        agent = _active_sessions.get(session_id)
        if not agent:
            finished = _finished_sessions.get(session_id)
            agent = finished[0] if finished else None
    return agent


@router.post("/undo")
async def undo_last_edit(request: UndoRequest):
    """Undo the last approved edit in the given session."""
    agent = await _find_agent(request.session_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Session not found")

    result = await agent.undo_last()
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["error"])

    return {"status": "undone", "file_path": result["file_path"]}


@router.get("/checkpoints/{session_id}")
async def get_checkpoints(session_id: str):
    """List edit checkpoints for a session."""
    agent = await _find_agent(session_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Session not found")

    if not hasattr(agent, "get_checkpoints"):
        return {"checkpoints": []}

    return {"checkpoints": agent.get_checkpoints()}


class RollbackRequest(BaseModel):
    session_id: str = Field(min_length=1)
    index: int = Field(ge=-1)


@router.post("/rollback")
async def rollback_to_checkpoint(request: RollbackRequest):
    """Rollback all edits after the given checkpoint index. Index -1 = undo everything."""
    agent = await _find_agent(request.session_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Session not found")

    if not hasattr(agent, "rollback_to"):
        raise HTTPException(status_code=400, detail="Rollback not supported for this session type")

    result = await agent.rollback_to(request.index)
    if not result["ok"]:
        raise HTTPException(status_code=400, detail="; ".join(result.get("errors", ["Unknown error"])))

    return {"status": "rolled_back", "files": result["rolled_back"]}


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


class InterruptRequest(BaseModel):
    call_id: str = Field(min_length=1, max_length=64)


@router.post("/interrupt")
async def interrupt_exec(request: InterruptRequest):
    """Send SIGINT to a running /exec call (Ctrl+C equivalent)."""
    ok = await interrupt_call(request.call_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Call not running or already finished")
    return {"status": "interrupted", "call_id": request.call_id}


# ── Planner/Editor endpoints ───────────────────────────────────

@router.post("/plan")
async def run_plan(request: PlanRequest):
    """Start a planner/editor session. Returns an SSE stream."""
    session_id = str(uuid.uuid4())
    logger.info(f"Plan session created: {session_id} model={request.model_id}")

    planner = PlannerEditor(
        session_id=session_id,
        model_id=request.model_id,
        workspace_dir=request.workspace_dir,
        temperature=request.temperature,
        max_edit_tokens=request.max_edit_tokens,
    )
    async with _sessions_lock:
        _active_sessions[session_id] = planner
        await _cleanup_expired_sessions()

    async def event_generator():
        try:
            async for event in planner.run(request.prompt):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            logger.error(f"Plan session error: {e}")
            yield f"data: {json.dumps({'event': 'error', 'data': {'message': str(e)}})}\n\n"
        finally:
            async with _sessions_lock:
                _active_sessions.pop(session_id, None)
                _finished_sessions[session_id] = (planner, time.time())
                await _cleanup_expired_sessions()
            logger.info(f"Plan session {session_id} moved to finished")

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/plan/decide")
async def decide_plan(decision: PlanDecision):
    """Approve, modify, or reject a pending plan."""
    async with _sessions_lock:
        session = _active_sessions.get(decision.session_id)
    if not session or not isinstance(session, PlannerEditor):
        raise HTTPException(status_code=404, detail="Plan session not found")

    ok = session.resolve_plan(decision.approved, decision.modifications)
    if not ok:
        raise HTTPException(status_code=400, detail="Failed to resolve plan")

    return {"status": "resolved", "approved": decision.approved}


# ---------------------------------------------------------------------------
# DatasetEngine endpoints — autonomous interaction capture for fine-tuning
# ---------------------------------------------------------------------------

from app.agents.nanocore.dataset_engine import dataset_engine


@router.get("/dataset/status")
async def dataset_status():
    """Return the current state of the captured interaction dataset."""
    pkg = dataset_engine.prepare_training_package(min_samples=1)
    return {
        "count": pkg.get("count", 0),
        "ready": pkg.get("ready", False),
        "threshold": pkg.get("threshold", 50),
        "path": pkg.get("path"),
    }


@router.post("/dataset/export")
async def dataset_export():
    """Consolidate all session JSONL files into dataset_latest.jsonl."""
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(None, dataset_engine.export_for_training)
    return {"message": result}


@router.post("/dataset/prepare")
async def dataset_prepare(min_samples: int = 50):
    """Prepare a training-ready package if enough samples exist."""
    loop = asyncio.get_running_loop()
    pkg = await loop.run_in_executor(
        None, lambda: dataset_engine.prepare_training_package(min_samples)
    )
    if not pkg.get("ready"):
        raise HTTPException(
            status_code=422,
            detail=f"Not enough samples: {pkg.get('count', 0)} / {pkg.get('threshold', min_samples)} required",
        )
    return pkg


# ---------------------------------------------------------------------------
# DPO preference data endpoints
# ---------------------------------------------------------------------------

@router.get("/dataset/dpo-status")
async def dpo_status():
    """Return the count of DPO preference pairs collected."""
    dpo_file = dataset_engine.storage_dir / "dpo_pairs.jsonl"
    count = 0
    if dpo_file.exists():
        with open(dpo_file, "r", encoding="utf-8") as f:
            count = sum(1 for _ in f)
    return {"count": count, "path": str(dpo_file)}
