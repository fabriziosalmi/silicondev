"""Coder Reliability Loop API — P0.5

Exposes the generate-check-critique-revise loop as an SSE streaming endpoint.
Active sessions can be cancelled via DELETE.
"""
import logging
import threading
from typing import Dict, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.engine.coder_loop import CoderReliabilityLoop

logger = logging.getLogger(__name__)
router = APIRouter()

# Active loop sessions (session_id → loop instance)
_active_loops: Dict[str, CoderReliabilityLoop] = {}
_loops_lock = threading.Lock()


class CoderLoopRequest(BaseModel):
    model_id: str = Field(min_length=1, max_length=255)
    task: str = Field(min_length=1, max_length=32768,
                      description="Natural language description of the coding task.")
    language: str = Field(default="python", max_length=64)
    initial_code: Optional[str] = Field(default=None, max_length=100000,
                                        description="Optional seed code to revise instead of generating from scratch.")
    system_prompt: Optional[str] = Field(default=None, max_length=4096)
    max_iterations: int = Field(default=3, ge=1, le=10,
                                description="Hard cap on generate-critique-revise cycles.")
    timeout_per_step: int = Field(default=60, ge=10, le=300,
                                  description="Per-step LLM timeout in seconds.")
    temperature: float = Field(default=0.3, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2048, ge=64, le=32768)
    run_sandbox: bool = Field(default=True,
                              description="Run syntax/execution checks between iterations.")


@router.post("/run")
async def run_coder_loop(request: CoderLoopRequest):
    """
    Start a Coder Reliability Loop session.

    Returns an SSE stream of structured telemetry events:
    - started: loop initialised
    - generated / revised: code produced by LLM
    - check_result: sandbox syntax/execution outcome
    - critique: LLM review of the code
    - finished: final result with stop_reason and telemetry summary
    """
    loop = CoderReliabilityLoop(
        model_id=request.model_id,
        language=request.language,
        max_iterations=request.max_iterations,
        timeout_per_step=request.timeout_per_step,
        temperature=request.temperature,
        max_tokens=request.max_tokens,
        run_sandbox=request.run_sandbox,
    )

    # Register session for cancellation
    import uuid
    session_id = str(uuid.uuid4())
    with _loops_lock:
        _active_loops[session_id] = loop

    async def stream_and_cleanup():
        try:
            async for chunk in loop.run(
                task=request.task,
                initial_code=request.initial_code,
                system_prompt=request.system_prompt,
            ):
                yield chunk
        except Exception as e:
            import json
            yield f"data: {json.dumps({'event': 'error', 'message': str(e)})}\n\n"
        finally:
            with _loops_lock:
                _active_loops.pop(session_id, None)
        yield "data: [DONE]\n\n"

    # Add session_id as response header so the client can cancel
    headers = {"X-Session-Id": session_id}
    return StreamingResponse(
        stream_and_cleanup(),
        media_type="text/event-stream",
        headers=headers,
    )


@router.delete("/run/{session_id}")
async def cancel_coder_loop(session_id: str):
    """Cancel an in-progress Coder Reliability Loop session."""
    with _loops_lock:
        loop = _active_loops.get(session_id)
    if not loop:
        raise HTTPException(status_code=404, detail="Session not found or already finished.")
    loop.cancel()
    return {"status": "cancellation_requested", "session_id": session_id}


@router.get("/sessions")
async def list_active_sessions():
    """List currently running Coder Reliability Loop sessions."""
    with _loops_lock:
        return {"active_sessions": list(_active_loops.keys())}
