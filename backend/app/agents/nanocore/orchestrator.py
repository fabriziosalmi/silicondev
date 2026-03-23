"""Orchestrator for spawning and managing SubagentWorkers.

Provides three execution patterns:
- spawn_worker: single worker, async
- spawn_parallel: multiple workers via asyncio.gather()
- spawn_pipeline: sequential, output of one feeds into the next
"""

import asyncio
import logging
import uuid
from typing import Any, Callable, Coroutine, Dict, List, Optional

from app.agents.nanocore.subagent import SubagentWorker, WORKER_ROLES

logger = logging.getLogger(__name__)

# Callback type: (worker_id, role, status, data) -> awaitable
WorkerCallback = Callable[[str, str, str, dict], Coroutine[Any, Any, None]]


class SubagentOrchestrator:
    """Spawn and manage subagent workers."""

    def __init__(
        self,
        default_model_id: str,
        workspace_dir: str,
        router=None,
        on_worker_event: Optional[WorkerCallback] = None,
    ):
        self.default_model_id = default_model_id
        self.workspace_dir = workspace_dir
        self._router = router
        self._on_event = on_worker_event
        self._active_workers: Dict[str, SubagentWorker] = {}
        self._completed_workers: Dict[str, SubagentWorker] = {}

    def _resolve_model(self, role: str) -> str:
        """Resolve model_id for a worker role via the router."""
        if self._router is not None:
            # Map worker roles to routing roles
            role_mapping = {
                "code_reviewer": "reviewer",
                "test_writer": "coder",
                "docs_generator": "coder",
                "bug_fixer": "coder",
            }
            routing_role = role_mapping.get(role, "coder")
            return self._router.resolve(routing_role, self.default_model_id)
        return self.default_model_id

    async def _notify(self, worker_id: str, role: str, status: str, data: dict = None):
        """Send a worker event notification."""
        if self._on_event:
            try:
                await self._on_event(worker_id, role, status, data or {})
            except Exception as e:
                logger.debug("Worker event callback error: %s", e)

    async def spawn_worker(
        self,
        role: str,
        task: str,
        context_files: Optional[List[str]] = None,
        model_id: Optional[str] = None,
        max_iterations: int = 5,
    ) -> Dict[str, Any]:
        """Spawn a single worker, run it, return its result.

        Returns dict with: worker_id, role, result, summary.
        """
        worker_id = f"w-{uuid.uuid4().hex[:8]}"
        resolved_model = model_id or self._resolve_model(role)

        worker = SubagentWorker(
            worker_id=worker_id,
            role=role,
            model_id=resolved_model,
            workspace_dir=self.workspace_dir,
            max_iterations=max_iterations,
        )
        self._active_workers[worker_id] = worker

        await self._notify(worker_id, role, "started", {"task": task[:200]})

        try:
            result = await worker.run(task, context_files=context_files)
            self._completed_workers[worker_id] = worker
            await self._notify(worker_id, role, "done", worker.summary())
            return {
                "worker_id": worker_id,
                "role": role,
                "result": result,
                "summary": worker.summary(),
            }
        except Exception as e:
            logger.error("Worker %s (%s) failed: %s", worker_id, role, e)
            await self._notify(worker_id, role, "failed", {"error": str(e)})
            return {
                "worker_id": worker_id,
                "role": role,
                "result": f"Worker failed: {e}",
                "summary": worker.summary(),
            }
        finally:
            self._active_workers.pop(worker_id, None)

    async def spawn_parallel(
        self,
        tasks: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """Run multiple workers in parallel.

        Each task dict should have: role, task, and optionally context_files, model_id.
        Returns list of results in the same order.
        """
        coros = []
        for t in tasks:
            coros.append(self.spawn_worker(
                role=t["role"],
                task=t["task"],
                context_files=t.get("context_files"),
                model_id=t.get("model_id"),
                max_iterations=t.get("max_iterations", 5),
            ))

        results = await asyncio.gather(*coros, return_exceptions=True)

        # Convert exceptions to error results
        final = []
        for i, r in enumerate(results):
            if isinstance(r, Exception):
                final.append({
                    "worker_id": f"w-err-{i}",
                    "role": tasks[i]["role"],
                    "result": f"Worker failed: {r}",
                    "summary": {},
                })
            else:
                final.append(r)
        return final

    async def spawn_pipeline(
        self,
        tasks: List[Dict[str, Any]],
    ) -> str:
        """Run workers sequentially, piping output of one as context for the next.

        Each task dict should have: role, task, and optionally context_files.
        The result of each worker is prepended to the next worker's task.
        Returns the final worker's result.
        """
        prev_result = ""
        for t in tasks:
            task_text = t["task"]
            if prev_result:
                task_text = f"Previous worker output:\n{prev_result}\n\n{task_text}"
            r = await self.spawn_worker(
                role=t["role"],
                task=task_text,
                context_files=t.get("context_files"),
                model_id=t.get("model_id"),
            )
            prev_result = r["result"]
        return prev_result

    def list_workers(self) -> Dict[str, Any]:
        """Return status of active and completed workers."""
        return {
            "active": [w.summary() for w in self._active_workers.values()],
            "completed": [w.summary() for w in list(self._completed_workers.values())[-10:]],
        }

    @staticmethod
    def available_roles() -> Dict[str, str]:
        """Return dict of role_id -> label for all known worker roles."""
        return {k: v["label"] for k, v in WORKER_ROLES.items()}
