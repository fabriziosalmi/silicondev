import json
import os
import tempfile
import uuid
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional
import time

logger = logging.getLogger(__name__)

# Hard cap on nodes per agent execution to prevent infinite loops
MAX_AGENT_NODES = 50


class AgentService:
    def __init__(self):
        self.workspace_dir = Path.home() / ".silicon-studio"
        self.agents_file = self.workspace_dir / "agents" / "agents.json"
        self.agents_file.parent.mkdir(parents=True, exist_ok=True)

        if not self.agents_file.exists():
            with open(self.agents_file, "w") as f:
                json.dump([], f)

    def get_agents(self) -> List[Dict[str, Any]]:
        try:
            with open(self.agents_file, "r") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load agents: {e}")
            return []

    def save_agent(self, agent_data: Dict[str, Any]) -> Dict[str, Any]:
        agents = self.get_agents()
        if "id" not in agent_data or not agent_data["id"]:
            agent_data["id"] = str(uuid.uuid4())
            agents.append(agent_data)
        else:
            # Update existing
            for i, a in enumerate(agents):
                if a["id"] == agent_data["id"]:
                    agents[i] = agent_data
                    break
            else:
                agents.append(agent_data)
        
        self._save(agents)
        return agent_data

    def delete_agent(self, agent_id: str) -> bool:
        agents = self.get_agents()
        initial_len = len(agents)
        agents = [a for a in agents if a["id"] != agent_id]
        if len(agents) < initial_len:
            self._save(agents)
            return True
        return False

    def _save(self, agents: List[Dict[str, Any]]):
        """Atomic write: temp file + os.replace to prevent corruption on crash."""
        fd, tmp_path = tempfile.mkstemp(
            dir=str(self.agents_file.parent), suffix=".tmp"
        )
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(agents, f, indent=2)
            os.replace(tmp_path, self.agents_file)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    async def execute_agent(self, agent_id: str, input_data: str) -> Dict[str, Any]:
        """Execute an agent pipeline sequentially through its nodes."""
        agents = self.get_agents()
        agent = next((a for a in agents if a["id"] == agent_id), None)
        if not agent:
            raise ValueError("Agent not found")

        results: List[Dict[str, Any]] = []
        start = time.time()
        current_input = input_data

        nodes = agent.get("nodes", [])
        if len(nodes) > MAX_AGENT_NODES:
            raise ValueError(f"Agent has {len(nodes)} nodes (max {MAX_AGENT_NODES})")

        visited_ids: set = set()
        for node in nodes:
            node_id = node.get("id")
            if node_id and node_id in visited_ids:
                raise ValueError(f"Duplicate node ID detected: {node_id} — possible cycle")
            if node_id:
                visited_ids.add(node_id)

            node_type = node.get("type", "generic")
            node_data = node.get("data", {})
            node_label = node_data.get("label") or node.get("name", node_type)

            try:
                output = await self._execute_node(node_type, node_data, current_input)
                results.append({
                    "node_id": node.get("id"),
                    "node_name": node_label,
                    "status": "completed",
                    "timestamp": time.time(),
                    "output": output,
                })
                # Feed output as input to next node
                current_input = output
            except Exception as e:
                logger.error(f"Node {node_label} failed: {e}")
                results.append({
                    "node_id": node.get("id"),
                    "node_name": node_label,
                    "status": "failed",
                    "timestamp": time.time(),
                    "output": f"Error: {e}",
                })
                break

        status = "success" if all(r["status"] == "completed" for r in results) else "failed"
        return {
            "agent_id": agent_id,
            "status": status,
            "execution_time": round(time.time() - start, 3),
            "steps": results,
        }

    async def _execute_node(self, node_type: str, node_data: Dict[str, Any], input_text: str) -> str:
        """Dispatch to the correct handler based on node type."""
        if node_type == "input":
            return input_text

        elif node_type == "output":
            return input_text

        elif node_type == "llm":
            return await self._run_llm_node(node_data, input_text)

        elif node_type == "tool":
            return await self._run_tool_node(node_data, input_text)

        elif node_type == "condition":
            return self._run_condition_node(node_data, input_text)

        else:
            return input_text

    async def _run_llm_node(self, node_data: Dict[str, Any], input_text: str) -> str:
        """Run input through the MLX engine for inference."""
        try:
            from app.api.engine import service as engine_service
        except ImportError:
            return f"[LLM unavailable] {input_text}"

        model_id = engine_service.active_model_id
        if not model_id:
            return "[No model loaded] " + input_text

        system_prompt = node_data.get("systemPrompt", "You are a helpful assistant.")
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": input_text},
        ]

        full_text = ""
        async for chunk in engine_service.generate_stream(model_id, messages, temperature=0.7, max_tokens=512):
            if "text" in chunk:
                full_text += chunk["text"]
            elif "error" in chunk:
                return f"[LLM error] {chunk['error']}"
        return full_text

    async def _run_tool_node(self, node_data: Dict[str, Any], input_text: str) -> str:
        """Execute a shell command defined in the node, passing input as env var."""
        import asyncio

        command = node_data.get("command", "")
        if not command:
            return input_text

        try:
            import shlex
            env = {**os.environ, "NODE_INPUT": input_text}
            cmd_parts = shlex.split(command)
            proc = await asyncio.create_subprocess_exec(
                *cmd_parts,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
            output = stdout.decode("utf-8", errors="replace").strip()
            if proc.returncode != 0:
                err = stderr.decode("utf-8", errors="replace").strip()
                return f"[exit {proc.returncode}] {err or output}"
            return output or input_text
        except asyncio.TimeoutError:
            return "[Tool timed out after 30s]"
        except Exception as e:
            return f"[Tool error] {e}"

    @staticmethod
    def _run_condition_node(node_data: Dict[str, Any], input_text: str) -> str:
        """Evaluate a simple condition against the input text."""
        keyword = node_data.get("keyword", "")
        if keyword and keyword.lower() in input_text.lower():
            return node_data.get("ifTrue", input_text)
        return node_data.get("ifFalse", input_text)
