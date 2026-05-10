import logging
import time
from typing import Dict, Any, List, Optional

from .registry import MCPServerRegistry
from .client import MCPClient, MCPError
from . import audit

logger = logging.getLogger(__name__)


class MCPService:
    """Orchestrates MCP server management and tool execution.

    Responsibilities:
    - Enforces enabled/disabled policy per server
    - Delegates to MCPClient (which handles retries + timeouts)
    - Writes structured audit log entries for every tool execution
    """

    def __init__(self):
        self.registry = MCPServerRegistry()
        self.client = MCPClient()

    def list_servers(self) -> List[Dict[str, Any]]:
        return self.registry.list_servers()

    def add_server(self, **kwargs) -> Dict[str, Any]:
        return self.registry.add_server(**kwargs)

    def remove_server(self, server_id: str) -> bool:
        return self.registry.remove_server(server_id)

    def set_enabled(self, server_id: str, enabled: bool) -> Optional[Dict[str, Any]]:
        return self.registry.set_enabled(server_id, enabled)

    def get_audit_log(self, limit: int = 100) -> List[Dict[str, Any]]:
        return audit.get_recent(limit)

    def _get_enabled_server(self, server_id: str) -> Dict[str, Any]:
        server = self.registry.get_server(server_id)
        if not server:
            raise ValueError(f"MCP server '{server_id}' not found")
        if not server.get("enabled", True):
            raise PermissionError(f"MCP server '{server_id}' is disabled")
        return server

    async def list_tools(self, server_id: str) -> List[Dict[str, Any]]:
        server = self._get_enabled_server(server_id)
        return await self.client.connect_and_list_tools(
            server["command"], server.get("args", []), server.get("env", {})
        )

    async def execute_tool(
        self, server_id: str, tool_name: str, tool_args: Dict[str, Any]
    ) -> Any:
        server = self._get_enabled_server(server_id)

        t0 = time.monotonic()
        status = "ok"
        result = None
        error_msg: Optional[str] = None
        attempts = 1

        try:
            result = await self.client.execute_tool(
                server["command"],
                server.get("args", []),
                server.get("env", {}),
                tool_name,
                tool_args,
            )
        except MCPError as e:
            status = "error"
            error_msg = str(e)
            attempts = e.attempts
            raise
        except Exception as e:
            status = "error"
            error_msg = str(e)
            raise
        finally:
            duration_ms = (time.monotonic() - t0) * 1000
            result_preview = ""
            if result is not None:
                if hasattr(result, "content"):
                    for item in result.content:
                        result_preview += getattr(item, "text", str(item))
                else:
                    result_preview = str(result)

            audit.record(
                server_id=server_id,
                tool_name=tool_name,
                tool_args=tool_args,
                status=status,
                duration_ms=duration_ms,
                result_preview=result_preview,
                error=error_msg,
                attempts=attempts,
            )

        return result

    async def execute_tool_for_agent(
        self, server_id: str, tool_name: str, tool_args: Dict[str, Any]
    ) -> str:
        """Execute a tool and return a plain-text string suitable for LLM context injection."""
        result = await self.execute_tool(server_id, tool_name, tool_args)

        if hasattr(result, "content"):
            parts = []
            for item in result.content:
                parts.append(getattr(item, "text", str(item)))
            return "\n".join(parts)
        return str(result)
