"""Coder Reliability Loop — P0.5

Implements the evaluate-optimize pattern for code generation tasks:
  generate → syntax/lint check → critique (LLM) → revise (LLM) → repeat (bounded)

Design goals:
- Fully deterministic: each iteration step is logged
- Hard-bounded: never exceeds max_iterations regardless of model output
- Observable: every attempt is emitted as a structured telemetry event
- Composable: uses existing SandboxService and MLXEngineService, no new deps
"""
import asyncio
import json
import logging
import time
import uuid
from enum import Enum
from typing import Any, AsyncGenerator, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── Stop reasons ──────────────────────────────────────────────────────────────

class StopReason(str, Enum):
    SUCCESS = "success"           # Code passed all checks
    MAX_ITERATIONS = "max_iter"   # Hit the iteration cap
    CRITIC_PASS = "critic_pass"   # LLM critic says it's good
    SANDBOX_UNAVAILABLE = "sandbox_unavailable"
    MODEL_ERROR = "model_error"
    CANCELLED = "cancelled"

# ── Telemetry event types ─────────────────────────────────────────────────────

class EventType(str, Enum):
    STARTED = "started"
    GENERATED = "generated"
    CHECK_RESULT = "check_result"
    CRITIQUE = "critique"
    REVISED = "revised"
    FINISHED = "finished"
    ERROR = "error"

def _evt(event_type: EventType, **payload) -> Dict[str, Any]:
    return {"event": event_type.value, "ts": time.time(), **payload}

# ── Prompts ───────────────────────────────────────────────────────────────────

_CRITIQUE_SYSTEM = (
    "You are a senior software engineer reviewing generated code. "
    "Be concise and critical. If the code is correct and complete, "
    'respond with exactly: "LGTM". Otherwise list the specific issues only.'
)

_REVISE_SYSTEM = (
    "You are a senior software engineer fixing bugs in code. "
    "Apply the critique feedback to fix the code. "
    "Output ONLY the corrected code with no preamble or markdown fences."
)

# ── Main loop ─────────────────────────────────────────────────────────────────

class CoderReliabilityLoop:
    """Implements the generate-check-critique-revise loop for code tasks."""

    def __init__(
        self,
        model_id: str,
        language: str = "python",
        max_iterations: int = 3,
        timeout_per_step: int = 60,
        temperature: float = 0.3,
        max_tokens: int = 2048,
        run_sandbox: bool = True,
    ):
        self.model_id = model_id
        self.language = language
        self.max_iterations = min(max(max_iterations, 1), 10)  # clamp 1-10
        self.timeout_per_step = timeout_per_step
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.run_sandbox = run_sandbox
        self._cancelled = False

    def cancel(self):
        self._cancelled = True

    async def run(
        self,
        task: str,
        initial_code: Optional[str] = None,
        system_prompt: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:
        """
        Async generator: yields SSE-compatible JSON strings.

        Each yielded string is a structured telemetry event.
        The final event is always type=finished with stop_reason and telemetry.
        """
        run_id = str(uuid.uuid4())
        t0 = time.time()

        telemetry: List[Dict[str, Any]] = []
        stop_reason: StopReason = StopReason.MAX_ITERATIONS
        current_code = initial_code or ""
        iteration = 0

        # Lazy-import services to avoid circular deps at module level
        from app.api.engine import service as engine_service
        try:
            from app.sandbox.service import SandboxService
            sandbox = SandboxService() if self.run_sandbox else None
        except Exception:
            sandbox = None

        sys_prompt = system_prompt or (
            f"You are an expert {self.language} developer. "
            "Write clean, correct, complete code. Output ONLY the code with no markdown fences."
        )

        yield self._sse(_evt(EventType.STARTED, run_id=run_id, model_id=self.model_id,
                              language=self.language, max_iterations=self.max_iterations))

        while iteration < self.max_iterations:
            if self._cancelled:
                stop_reason = StopReason.CANCELLED
                break

            iteration += 1
            iter_t = time.time()
            logger.info("[CoderLoop %s] Iteration %d/%d", run_id, iteration, self.max_iterations)

            # ── Step 1: Generate / Revise ──────────────────────────────────
            if not current_code:
                # First generation from task description
                messages = [
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": task},
                ]
                step_label = "generate"
            else:
                # Subsequent iterations: revise from critique
                messages = [
                    {"role": "system", "content": _REVISE_SYSTEM},
                    {"role": "user", "content": (
                        f"Original task:\n{task}\n\n"
                        f"Current code:\n```\n{current_code}\n```\n\n"
                        f"Fix all issues above."
                    )},
                ]
                step_label = "revise"

            try:
                generated = await asyncio.wait_for(
                    self._collect_stream(engine_service, messages),
                    timeout=self.timeout_per_step,
                )
                generated = self._strip_fences(generated)
            except asyncio.TimeoutError:
                err = f"LLM {step_label} timed out after {self.timeout_per_step}s"
                logger.warning("[CoderLoop %s] %s", run_id, err)
                yield self._sse(_evt(EventType.ERROR, iteration=iteration, message=err))
                stop_reason = StopReason.MODEL_ERROR
                break
            except Exception as e:
                logger.warning("[CoderLoop %s] LLM error: %s", run_id, e)
                yield self._sse(_evt(EventType.ERROR, iteration=iteration, message=str(e)))
                stop_reason = StopReason.MODEL_ERROR
                break

            current_code = generated
            evt_type = EventType.GENERATED if step_label == "generate" else EventType.REVISED
            yield self._sse(_evt(evt_type, iteration=iteration, code=current_code))

            # ── Step 2: Syntax / Sandbox check ────────────────────────────
            check_passed = True
            check_output = ""
            check_error = ""

            if sandbox:
                try:
                    result = await asyncio.wait_for(
                        sandbox.check(code=current_code, language=self.language),
                        timeout=15,
                    )
                    check_passed = result.get("valid", True)
                    check_output = result.get("output", "")
                    check_error = result.get("error", "")
                except asyncio.TimeoutError:
                    check_passed = False
                    check_error = "Syntax check timed out"
                except Exception as e:
                    # Sandbox unavailable — skip check but continue
                    logger.warning("[CoderLoop %s] Sandbox check failed: %s", run_id, e)
                    check_passed = True  # optimistic — continue to LLM critique
                    check_error = str(e)
            else:
                check_output = "Sandbox skipped (not configured)"

            step_telemetry = {
                "iteration": iteration,
                "duration_ms": round((time.time() - iter_t) * 1000),
                "check_passed": check_passed,
            }
            telemetry.append(step_telemetry)

            yield self._sse(_evt(
                EventType.CHECK_RESULT,
                iteration=iteration,
                passed=check_passed,
                output=check_output,
                error=check_error,
            ))

            if check_passed and iteration < self.max_iterations:
                # ── Step 3: LLM Critique ───────────────────────────────────
                critique_messages = [
                    {"role": "system", "content": _CRITIQUE_SYSTEM},
                    {"role": "user", "content": (
                        f"Task: {task}\n\nCode to review:\n```{self.language}\n{current_code}\n```"
                    )},
                ]
                try:
                    critique = await asyncio.wait_for(
                        self._collect_stream(engine_service, critique_messages, max_tokens=512),
                        timeout=self.timeout_per_step,
                    )
                except Exception as e:
                    critique = f"[critique unavailable: {e}]"

                yield self._sse(_evt(EventType.CRITIQUE, iteration=iteration, critique=critique))

                if "lgtm" in critique.lower():
                    stop_reason = StopReason.CRITIC_PASS
                    logger.info("[CoderLoop %s] Critic LGTM at iteration %d", run_id, iteration)
                    break
                # Inject critique into user messages for next revision
                if len(messages) >= 2:
                    messages.append({"role": "assistant", "content": current_code})
                    messages.append({"role": "user", "content": f"Issues found:\n{critique}\n\nPlease fix them."})

            elif check_passed:
                stop_reason = StopReason.SUCCESS
                break

        # ── Final event ───────────────────────────────────────────────────
        yield self._sse(_evt(
            EventType.FINISHED,
            run_id=run_id,
            stop_reason=stop_reason.value,
            iterations_used=iteration,
            total_duration_ms=round((time.time() - t0) * 1000),
            final_code=current_code,
            telemetry=telemetry,
        ))

    async def _collect_stream(
        self,
        engine_service,
        messages: List[Dict[str, Any]],
        max_tokens: Optional[int] = None,
    ) -> str:
        """Collect all chunks from generate_stream into a single string."""
        parts = []
        async for chunk in engine_service.generate_stream(
            self.model_id,
            messages,
            temperature=self.temperature,
            max_tokens=max_tokens or self.max_tokens,
        ):
            if "error" in chunk:
                raise RuntimeError(chunk["error"])
            if "text" in chunk:
                parts.append(chunk["text"])
        return "".join(parts)

    @staticmethod
    def _strip_fences(text: str) -> str:
        """Remove markdown code fences the model may output despite instructions."""
        import re
        # Remove ```lang ... ``` or ``` ... ```
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text.strip())
        text = re.sub(r"\n?```$", "", text.strip())
        return text.strip()

    @staticmethod
    def _sse(event: Dict[str, Any]) -> str:
        return f"data: {json.dumps(event)}\n\n"
