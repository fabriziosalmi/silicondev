import logging
import re
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

from app.mcp.service import MCPService
from app.mcp.router import mcp_router
from app.mcp.examples import tool_examples

logger = logging.getLogger(__name__)
router = APIRouter()
service = MCPService()

# Allowed MCP server commands (executables, not arbitrary shell commands)
_MCP_ALLOWED_COMMANDS = {
    "npx", "uvx", "node", "python", "python3", "deno", "bun",
    "docker", "podman",
}

# Patterns that must never appear in MCP command or args
_MCP_BLOCKED_PATTERNS = [
    "rm ", "rm\t", "rmdir", "mkfs", "dd ", "chmod", "chown",
    "curl ", "wget ", "nc ", "ncat",
    "> /dev/", "| sh", "| bash", "| zsh",
    "eval ", "exec ", "sudo ",
    ":(){ :|:& };:",
]


def _validate_mcp_command(command: str, args: list[str]) -> str | None:
    """Validate an MCP server command. Returns error string or None if safe."""
    cmd_base = command.strip().split("/")[-1]  # basename
    if cmd_base not in _MCP_ALLOWED_COMMANDS:
        return (
            f"Command '{command}' is not allowed. "
            f"Allowed commands: {', '.join(sorted(_MCP_ALLOWED_COMMANDS))}"
        )
    full = f"{command} {' '.join(args)}".lower()
    for pat in _MCP_BLOCKED_PATTERNS:
        if pat in full:
            return f"Blocked: MCP command contains dangerous pattern '{pat.strip()}'"
    return None


class AddServerRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    command: str = Field(min_length=1, max_length=1024)
    args: List[str] = Field(default=[], max_length=50)
    env: Dict[str, str] = {}
    transport: str = Field(default="stdio", max_length=20)
    enabled: bool = True


class SetEnabledRequest(BaseModel):
    enabled: bool


class ExecuteToolRequest(BaseModel):
    server_id: str = Field(min_length=1, max_length=255)
    tool_name: str = Field(min_length=1, max_length=255)
    tool_args: Dict[str, Any] = {}


@router.get("/servers")
async def list_servers():
    """List all configured MCP servers."""
    return service.list_servers()


@router.post("/servers")
async def add_server(request: AddServerRequest):
    """Add or update an MCP server configuration."""
    error = _validate_mcp_command(request.command, request.args)
    if error:
        raise HTTPException(status_code=400, detail=error)
    return service.add_server(
        name=request.name,
        command=request.command,
        args=request.args,
        env=request.env,
        transport=request.transport,
        enabled=request.enabled,
    )


@router.delete("/servers/{server_id}")
async def remove_server(server_id: str):
    """Remove an MCP server configuration."""
    if not service.remove_server(server_id):
        raise HTTPException(404, "Server not found")
    return {"status": "removed"}


@router.patch("/servers/{server_id}/enabled")
async def set_server_enabled(server_id: str, request: SetEnabledRequest):
    """Enable or disable an MCP server without removing it."""
    updated = service.set_enabled(server_id, request.enabled)
    if not updated:
        raise HTTPException(404, "Server not found")
    return updated


@router.get("/servers/{server_id}/tools")
async def list_tools(server_id: str):
    """Discover available tools on an MCP server."""
    try:
        tools = await service.list_tools(server_id)
        return {"tools": tools}
    except ValueError as e:
        raise HTTPException(404, str(e))
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except Exception as e:
        logger.error(f"Failed to list tools for {server_id}: {e}")
        raise HTTPException(500, f"Failed to connect to MCP server: {e}")


@router.post("/execute")
async def execute_tool(request: ExecuteToolRequest):
    """Execute a tool on an MCP server."""
    try:
        result = await service.execute_tool(
            request.server_id, request.tool_name, request.tool_args
        )
        # Convert MCP result to a serializable format
        content = ""
        if hasattr(result, "content"):
            for item in result.content:
                if hasattr(item, "text"):
                    content += item.text
                else:
                    content += str(item)
        else:
            content = str(result)
        return {"result": content}
    except ValueError as e:
        raise HTTPException(404, str(e))
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except Exception as e:
        logger.error(f"Failed to execute tool {request.tool_name}: {e}")
        raise HTTPException(500, f"Tool execution failed: {e}")


@router.get("/audit")
async def get_audit_log(limit: int = 100):
    """Return recent MCP tool execution audit log entries."""
    if limit < 1 or limit > 500:
        raise HTTPException(400, "limit must be between 1 and 500")
    return {"entries": service.get_audit_log(limit)}


# ── P1.1 MCP Router: Progressive Tool Discovery ───────────────────────────────

@router.get("/router/stats")
async def router_stats():
    """Return current state of the MCP tool index."""
    return mcp_router.stats()


@router.post("/router/refresh")
async def router_refresh():
    """Force a full re-discovery of all tools across enabled MCP servers."""
    count = await mcp_router.refresh(service)
    return {"indexed_tools": count, **mcp_router.stats()}


@router.get("/router/search")
async def router_search(
    q: str = Query(..., min_length=1, max_length=500),
    top_k: int = Query(default=5, ge=1, le=20),
):
    """Search for tools matching an intent query. Auto-refreshes stale index."""
    if mcp_router.is_stale():
        await mcp_router.refresh(service)
    tools = mcp_router.search(q, top_k=top_k)
    return {"query": q, "tools": tools, "total": len(tools)}


@router.get("/router/tools")
async def router_list_tools(
    server_id: Optional[str] = Query(default=None),
):
    """List all indexed tools, optionally filtered by server_id."""
    if mcp_router.is_stale():
        await mcp_router.refresh(service)
    return {"tools": mcp_router.list_all(server_id=server_id)}


# ── P1.2 Programmatic Tool Orchestration ─────────────────────────────────────

class OrchestrateRequest(BaseModel):
    code: str = Field(min_length=1, max_length=32768,
                      description="Python orchestration code. Has access to call_tool(server_id, tool, args).")
    timeout: int = Field(default=30, ge=5, le=120)


@router.post("/orchestrate")
async def orchestrate(request: OrchestrateRequest):
    """Execute Python orchestration code in a restricted sandbox with MCP tool access."""
    from app.mcp.orchestrator import run_orchestration
    result = await run_orchestration(request.code, timeout=request.timeout)
    return result.to_dict()


# ── P1.3 Tool Use Examples Registry ──────────────────────────────────────────

class AddExampleRequest(BaseModel):
    server_id: str = Field(min_length=1, max_length=255)
    tool_name: str = Field(min_length=1, max_length=255)
    description: str = Field(min_length=1, max_length=2048)
    input_example: Dict[str, Any] = {}
    expected_output_pattern: str = Field(default="", max_length=1024)
    edge_cases: List[str] = Field(default=[])
    tags: List[str] = Field(default=[])


@router.get("/examples")
async def list_examples(
    server_id: Optional[str] = Query(default=None),
    tool_name: Optional[str] = Query(default=None),
    tag: Optional[str] = Query(default=None),
):
    """List tool usage examples, optionally filtered."""
    return {"examples": tool_examples.get_examples(server_id=server_id, tool_name=tool_name, tag=tag)}


@router.post("/examples")
async def add_example(request: AddExampleRequest):
    """Add a new usage example for an MCP tool."""
    return tool_examples.add_example(
        server_id=request.server_id,
        tool_name=request.tool_name,
        description=request.description,
        input_example=request.input_example,
        expected_output_pattern=request.expected_output_pattern,
        edge_cases=request.edge_cases,
        tags=request.tags,
    )


@router.delete("/examples/{example_id}")
async def delete_example(example_id: str):
    """Delete a usage example by ID."""
    if not tool_examples.delete_example(example_id):
        raise HTTPException(404, "Example not found")
    return {"status": "deleted"}


@router.get("/examples/stats")
async def examples_stats():
    """Return tool examples registry statistics."""
    return tool_examples.stats()


@router.get("/examples/{server_id}/{tool_name}/prompt")
async def example_prompt(server_id: str, tool_name: str, max_examples: int = Query(default=3, ge=1, le=10)):
    """Return a prompt-ready usage example block for a specific tool."""
    text = tool_examples.format_for_prompt(server_id, tool_name, max_examples=max_examples)
    return {"prompt_block": text}
