"""Map-Reduce Mixture of Agents (MoA) Orchestrator for NanoCore."""

import asyncio
import logging
from typing import Any, Callable, Coroutine, Dict, List, Optional

logger = logging.getLogger(__name__)

# Default personas for the Map phase
EXPERTS = {
    "security": {
        "role": "Security & Edge-Case Expert",
        "description": "You are a cyber-security and edge-case specialist. Analyze the task and code for vulnerabilities, unhandled exceptions, race conditions, memory leaks, and weak types. Do NOT write the final code, just provide a rigorous checklist of what must be handled.",
    },
    "performance": {
        "role": "Performance & Architecture Expert",
        "description": "You are a performance optimization and architecture specialist. Analyze the task for algorithmic complexity (Big-O), memory allocation patterns, and best practices. Do NOT write the final code, just provide the most optimal architectural approach and performance tips.",
    },
    "syntax": {
        "role": "Syntax & Clean Code Expert",
        "description": "You are a clean code and syntax specialist. Analyze the task for readability, modularity, DRY principles, and idiomatic conventions. Do NOT write the final code, just provide structuring rules and naming conventions.",
    }
}

REDUCER_PROMPT = """\
You are the Lead Developer Synthesizer. You have received reports from your 3 experts (Security, Performance, and Syntax).
Your job is to read their analyses and write the final, perfect code that satisfies ALL their requirements.

Here is the original task:
<task>
{topic}
</task>

Here are the expert reports:
{reports}

Now, execute the final implementation. Write only the necessary code and a brief explanation.
"""

# Type for optional progress callback: (phase, expert_id, status) -> awaitable
ProgressCallback = Callable[[str, str, str], Coroutine[Any, Any, None]]


class MapReduceSwarm:
    def __init__(self, model_id: str, max_tokens_per_expert: int = 400, temperature: float = 0.2,
                 on_progress: Optional[ProgressCallback] = None,
                 router=None):
        self.model_id = model_id
        self.max_tokens = max_tokens_per_expert
        self.temperature = temperature
        self._on_progress = on_progress
        self._router = router  # ModelRouter for per-expert model selection

    def _expert_model(self, expert_id: str) -> str:
        """Resolve model_id for a given expert via router.

        Maps expert_id to a role name, then asks the router.
        E.g. "security" expert -> "reviewer" role, "syntax" -> "reviewer",
        "performance" -> "reviewer".  The reducer uses "coder".
        """
        if self._router is None:
            return self.model_id
        # All experts are reviewers; the caller can override via routing config
        role = "reviewer"
        return self._router.resolve(role, self.model_id)

    async def _run_expert(self, expert_id: str, expert_cfg: dict, topic: str, context: str) -> str:
        """Runs a single expert prompt."""
        from app.api.engine import service as engine_service
        
        system_content = expert_cfg["description"]
        if context:
            system_content += f"\n\nContext files:\n{context}"
            
        messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": f"Task:\n{topic}\n\nPlease provide your specialized analysis."}
        ]
        
        logger.info(f"[Swarm] Starting expert: {expert_id}")
        if self._on_progress:
            await self._on_progress("map", expert_id, "started")

        expert_model = self._expert_model(expert_id)
        response = await engine_service.generate_response(
            expert_model,
            messages,
            temperature=self.temperature,
            max_tokens=self.max_tokens
        )
        logger.info(f"[Swarm] Finished expert: {expert_id} (model: {expert_model})")
        if self._on_progress:
            await self._on_progress("map", expert_id, "done")
        return response.get("content", "")

    async def run_swarm(self, topic: str, context: str = "") -> str:
        """Executes the Map-Reduce flow and returns the synthesized output."""
        # 1. Map Phase: Gather expert opinions
        tasks = []
        expert_ids = list(EXPERTS.keys())
        for exp_id in expert_ids:
            tasks.append(self._run_expert(exp_id, EXPERTS[exp_id], topic, context))
            
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        reports_text = ""
        for exp_id, result in zip(expert_ids, results):
            if isinstance(result, Exception):
                logger.error(f"[Swarm] Expert {exp_id} failed: {result}")
                result_text = f"Error generating report: {result}"
            else:
                result_text = str(result)
            reports_text += f"\n### {EXPERTS[exp_id]['role']} says:\n{result_text}\n"
            
        # 2. Reduce Phase: Synthesize
        from app.api.engine import service as engine_service
        
        logger.info("[Swarm] Starting Reducer synthesis...")
        if self._on_progress:
            await self._on_progress("reduce", "synthesizer", "started")
        reducer_sys = REDUCER_PROMPT.format(topic=topic, reports=reports_text)
        
        messages = [
            {"role": "system", "content": reducer_sys},
            {"role": "user", "content": "Begin final synthesis."}
        ]
        
        # Give the reducer more tokens and slightly higher temp to write the actual code
        reducer_model = self._router.resolve("coder", self.model_id) if self._router else self.model_id
        final_response = await engine_service.generate_response(
            reducer_model,
            messages,
            temperature=0.3,
            max_tokens=1500
        )
        
        logger.info("[Swarm] Swarm finished.")
        if self._on_progress:
            await self._on_progress("reduce", "synthesizer", "done")
        
        # Package the result showing the inner monologue of the swarm
        output = "<swarm_reports>\n" + reports_text + "\n</swarm_reports>\n\n### Swarm Final Consensus:\n" 
        output += final_response.get("content", "")
        
        return output
