import asyncio
import logging
import time
from typing import List, Dict, Any
from app.memory.service import memory_graph

logger = logging.getLogger(__name__)

class ScoutAgent:
    """Background worker that proactively monitors the Knowledge Graph for project risks and opportunities."""
    
    def __init__(self, workspace_path: str):
        self.workspace_path = workspace_path
        self._stop_event = asyncio.Event()
        self.interval = 300  # Scan every 5 minutes

    async def start(self, on_event=None):
        """Starts the background monitoring loop in a background task."""
        self.on_event = on_event
        self._task = asyncio.create_task(self._run_loop())
        logger.info("Scout Agent active: Monitoring project health...")

    async def _run_loop(self):
        while not self._stop_event.is_set():
            try:
                await self.perform_reconnaissance()
            except Exception as e:
                logger.error(f"Scout Agent error during reconnaissance: {e}")
            
            try:
                # Use wait for stop event or timeout
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.interval)
            except asyncio.TimeoutError:
                continue

    async def stop(self):
        self._stop_event.set()
        if hasattr(self, '_task') and self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass

    async def perform_reconnaissance(self):
        """Analyzes the graph to find 'Hot-Spots' or 'Code Smells'."""
        nodes = memory_graph.get_all_nodes()
        edges = memory_graph.get_all_edges()

        # 1. Identify "Hot-Spots": Files modified across many conversations
        file_activity = {}
        for edge in edges:
            if edge["relation"] == "contains":
                # Find the target node (which should be a file/node extracted from conversation)
                target_id = edge["target"]
                file_activity[target_id] = file_activity.get(target_id, 0) + 1

        # 2. Flag nodes with high activity (e.g., > 5 mentions in different contexts)
        for node_id, count in file_activity.items():
            if count > 5:
                # Add a "Risk/Recommendation" node to the graph
                recommendation = f"File '{node_id}' is a high-activity hotspot (>5 mentions). Suggest refactoring to decouple logic."
                memory_graph.add_node(
                    node_id=f"scout_rec_{int(time.time())}_{node_id}",
                    node_type="recommendation",
                    label="Refactoring Opportunity",
                    content=recommendation,
                    metadata={"target_node": node_id, "activity_count": count}
                )
                if self.on_event:
                    await self.on_event({
                        "event": "scout_recommendation",
                        "data": {
                            "type": "hotspot",
                            "target": node_id,
                            "message": recommendation
                        }
                    })
                logger.info(f"Scout Agent: Flagged {node_id} as refactoring candidate.")

        # 3. Handle specific project rules or known bug patterns
        # (This can be expanded with real AST scanning in the future)
        pass

# The ScoutAgent is typically started by the main engine service or supervisor
