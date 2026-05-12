import json
import os
import tempfile
import uuid
import logging
import asyncio
from pathlib import Path
from typing import List, Dict, Any, Optional
import time

from app.agents.nanocore.tools import _is_blocked
from app.security import safe_id

logger = logging.getLogger(__name__)

# Hard cap on nodes per agent execution to prevent infinite loops
MAX_AGENT_NODES = 50

class AgentService:
    def __init__(self):
        self.workspace_dir = Path.home() / ".silicon-studio"
        self.agents_file = self.workspace_dir / "agents" / "agents.json"
        self.runs_dir = self.workspace_dir / "agents" / "runs"
        
        self.agents_file.parent.mkdir(parents=True, exist_ok=True)
        self.runs_dir.mkdir(parents=True, exist_ok=True)

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

    def _load_run(self, run_id: str) -> Dict[str, Any]:
        safe_id(run_id)
        run_file = self.runs_dir / f"{run_id}.json"
        if not run_file.exists():
            raise ValueError(f"Run {run_id} not found")
        with open(run_file, "r") as f:
            return json.load(f)

    def _save_run(self, run_state: Dict[str, Any]):
        run_id = safe_id(run_state["run_id"])
        run_file = self.runs_dir / f"{run_id}.json"
        fd, tmp_path = tempfile.mkstemp(dir=str(self.runs_dir), suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(run_state, f, indent=2)
            os.replace(tmp_path, run_file)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    def get_runs(self, agent_id: str) -> List[Dict[str, Any]]:
        runs = []
        for f in self.runs_dir.glob("*.json"):
            try:
                with open(f, "r") as fh:
                    run = json.load(fh)
                    if run.get("agent_id") == agent_id:
                        runs.append(run)
            except Exception as e:
                logger.warning("Failed to read run file %s: %s", f, e)
        return sorted(runs, key=lambda r: r.get("start_time", 0), reverse=True)

    async def execute_agent(self, agent_id: str, input_data: str, run_id: Optional[str] = None) -> Dict[str, Any]:
        """Execute a directed graph of agent nodes with retries and persistence."""
        agents = self.get_agents()
        agent = next((a for a in agents if a["id"] == agent_id), None)
        if not agent:
            raise ValueError("Agent not found")

        nodes = agent.get("nodes", [])
        edges = agent.get("edges", [])
        # Use `or {}` to handle JSON null (when config was serialized as null)
        config = agent.get("config") or {}

        if len(nodes) > MAX_AGENT_NODES:
            raise ValueError(f"Agent has {len(nodes)} nodes (max {MAX_AGENT_NODES})")

        nodes_by_id = {n.get("id"): n for n in nodes if n.get("id")}

        # Determine starting nodes if new run
        if not run_id:
            run_id = str(uuid.uuid4())
            
            # Find nodes with no incoming edges
            incoming_edges = {e.get("target") for e in edges}
            start_node_ids = [n_id for n_id in nodes_by_id if n_id not in incoming_edges]
            
            # Fallback to first node if graph is cyclic or standalone
            if not start_node_ids and nodes:
                start_node_ids = [nodes[0].get("id")]
                
            run_state = {
                "run_id": run_id,
                "agent_id": agent_id,
                "status": "running",
                "start_time": time.time(),
                "node_states": {},
                "active_nodes": [{"node_id": nid, "input_data": input_data} for nid in start_node_ids],
                "execution_time": 0
            }
            self._save_run(run_state)
        else:
            run_state = self._load_run(run_id)
            if run_state["status"] == "completed":
                return self._format_run_response(run_state)
            run_state["status"] = "running"
            self._save_run(run_state)

        start = time.time()
        max_retries = config.get("max_retries", 3)
        timeout_sec = config.get("timeout_sec", 60)

        # BFS Execution Graph
        iteration_count = 0
        while run_state["active_nodes"] and iteration_count < MAX_AGENT_NODES * 2:
            iteration_count += 1
            current_active = list(run_state["active_nodes"])
            run_state["active_nodes"] = []
            
            for active in current_active:
                node_id = active["node_id"]
                current_input = active["input_data"]
                node = nodes_by_id.get(node_id)
                if not node:
                    continue

                node_type = node.get("type", "generic")
                node_data = node.get("data", {})
                node_label = node_data.get("label") or node.get("name", node_type)

                state = run_state["node_states"].get(node_id, {"retries": 0, "status": "pending"})
                if state.get("status") == "completed":
                    # Skip already completed node in resume scenario
                    output = state.get("output", current_input)
                    route_key = state.get("route_key", None)
                    success = True
                else:
                    # Execute node with retry logic
                    success = False
                    output = ""
                    route_key = None
                    error_msg = ""
                    
                    while state["retries"] <= max_retries and not success:
                        try:
                            output, route_key = await asyncio.wait_for(
                                self._execute_node(node_type, node_data, current_input),
                                timeout=timeout_sec
                            )
                            success = True
                        except asyncio.TimeoutError:
                            state["retries"] += 1
                            error_msg = f"Timeout after {timeout_sec}s"
                            logger.warning(f"Node {node_label} timeout. Retry {state['retries']}/{max_retries}")
                        except Exception as e:
                            state["retries"] += 1
                            error_msg = str(e)
                            logger.warning(f"Node {node_label} error: {e}. Retry {state['retries']}/{max_retries}")
                            
                        if not success and state["retries"] <= max_retries:
                            await asyncio.sleep(2 ** state["retries"]) # Exponential backoff

                if success:
                    state["status"] = "completed"
                    state["output"] = output
                    state["route_key"] = route_key
                    state["timestamp"] = time.time()
                    state["node_name"] = node_label
                    run_state["node_states"][node_id] = state
                    self._save_run(run_state)
                    
                    # Compute next nodes based on edges
                    if route_key:
                        outgoing_edges = [e for e in edges if e.get("source") == node_id and e.get("sourceHandle") == route_key]
                        if not outgoing_edges:
                            # Fallback if UI didn't configure sourceHandle correctly
                            outgoing_edges = [e for e in edges if e.get("source") == node_id]
                    else:
                        outgoing_edges = [e for e in edges if e.get("source") == node_id]

                    for edge in outgoing_edges:
                        target_id = edge.get("target")
                        if target_id and target_id in nodes_by_id:
                            run_state["active_nodes"].append({
                                "node_id": target_id,
                                "input_data": output
                            })
                else:
                    state["status"] = "failed"
                    state["output"] = f"Error: {error_msg}"
                    state["timestamp"] = time.time()
                    state["node_name"] = node_label
                    run_state["node_states"][node_id] = state
                    run_state["status"] = "failed"
                    self._save_run(run_state)
                    break # Stop execution on first unrecoverable failure
                    
            if run_state["status"] == "failed":
                break

        if not run_state["active_nodes"] and run_state["status"] != "failed":
            run_state["status"] = "completed"
            
        run_state["execution_time"] += round(time.time() - start, 3)
        self._save_run(run_state)
        
        return self._format_run_response(run_state)

    def _format_run_response(self, run_state: Dict[str, Any]) -> Dict[str, Any]:
        """Convert run state into the response format expected by the client."""
        steps = []
        for nid, nstate in run_state.get("node_states", {}).items():
            steps.append({
                "node_id": nid,
                "node_name": nstate.get("node_name", nid),
                "status": nstate.get("status"),
                "timestamp": nstate.get("timestamp", time.time()),
                "output": nstate.get("output", "")
            })

        # Normalise internal 'completed' to the public 'success' status
        raw_status = run_state["status"]
        public_status = "success" if raw_status == "completed" else raw_status

        return {
            "agent_id": run_state.get("agent_id"),
            "run_id": run_state.get("run_id"),
            "status": public_status,
            "execution_time": run_state.get("execution_time", 0),
            "steps": sorted(steps, key=lambda x: x["timestamp"])
        }


    async def _execute_node(self, node_type: str, node_data: Dict[str, Any], input_text: str) -> tuple[str, Optional[str]]:
        """Dispatch to the correct handler based on node type. Returns (output_string, route_key)."""
        if node_type == "input":
            return input_text, None

        elif node_type == "output":
            return input_text, None

        elif node_type == "llm":
            return await self._run_llm_node(node_data, input_text), None

        elif node_type == "tool":
            return await self._run_tool_node(node_data, input_text), None

        elif node_type == "condition":
            return self._run_condition_node(node_data, input_text)

        elif node_type == "mcp":
            return await self._run_mcp_node(node_data, input_text), None

        else:
            return input_text, None

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

    async def _run_mcp_node(self, node_data: Dict[str, Any], input_text: str) -> str:
        """Execute an MCP tool call as an agent node.

        node_data expected keys:
          - server_id  (str): registered MCP server ID
          - tool_name  (str): tool to call on that server
          - tool_args  (dict, optional): static args; {{input}} is replaced with input_text
        """
        server_id = node_data.get("server_id", "")
        tool_name = node_data.get("tool_name", "")
        if not server_id or not tool_name:
            return f"[MCP node misconfigured — missing server_id or tool_name] {input_text}"

        # Allow static args with {{input}} template substitution
        raw_args: Dict[str, Any] = node_data.get("tool_args") or {}
        tool_args: Dict[str, Any] = {}
        for k, v in raw_args.items():
            if isinstance(v, str):
                tool_args[k] = v.replace("{{input}}", input_text)
            else:
                tool_args[k] = v

        # If no args defined, pass input as the first positional-style arg
        if not tool_args:
            tool_args = {"input": input_text}

        try:
            from app.mcp.service import MCPService
            mcp_service = MCPService()
            return await mcp_service.execute_tool_for_agent(server_id, tool_name, tool_args)
        except PermissionError as e:
            return f"[MCP disabled] {e}"
        except Exception as e:
            return f"[MCP error: {e}]"

    async def _run_tool_node(self, node_data: Dict[str, Any], input_text: str) -> str:
        """Execute a shell command defined in the node, passing input as env var."""
        import asyncio

        command = node_data.get("command", "")
        if not command:
            return input_text

        # Safety: apply the same blocklist as nanocore agent shell
        blocked = _is_blocked(command)
        if blocked:
            return f"[Blocked] {blocked}"

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
    def _run_condition_node(node_data: Dict[str, Any], input_text: str) -> tuple[str, str]:
        """Evaluate a simple condition against the input text. Returns (payload, route_key)."""
        keyword = node_data.get("keyword", "")
        is_true = bool(keyword and keyword.lower() in input_text.lower())
        out_text = node_data.get("ifTrue", input_text) if is_true else node_data.get("ifFalse", input_text)
        return out_text, "true" if is_true else "false"
