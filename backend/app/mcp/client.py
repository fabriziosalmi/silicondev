import asyncio
import logging
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

MCP_TIMEOUT = 30  # seconds per attempt
MCP_MAX_RETRIES = 3
MCP_RETRY_BASE_DELAY = 1.0  # seconds (exponential: 1, 2, 4)


class MCPError(Exception):
    """Raised when an MCP call fails after all retries."""
    def __init__(self, message: str, attempts: int):
        super().__init__(message)
        self.attempts = attempts


class MCPClient:
    """Connects to MCP servers via stdio transport, discovers tools, and executes them.

    All calls include retry logic with exponential backoff and explicit timeout per attempt.
    """

    async def connect_and_list_tools(
        self, command: str, args: List[str], env: Dict[str, str] | None = None
    ) -> List[Dict[str, Any]]:
        """Connect to an MCP server and return its available tools."""
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        server_params = StdioServerParameters(
            command=command,
            args=args,
            env=env if env else None,
        )

        last_exc: Exception | None = None
        for attempt in range(1, MCP_MAX_RETRIES + 1):
            try:
                async with stdio_client(server_params) as (read, write):
                    async with ClientSession(read, write) as session:
                        await asyncio.wait_for(session.initialize(), timeout=MCP_TIMEOUT)
                        tools_result = await asyncio.wait_for(
                            session.list_tools(), timeout=MCP_TIMEOUT
                        )
                        return [
                            {
                                "name": tool.name,
                                "description": getattr(tool, "description", "") or "",
                                "inputSchema": getattr(tool, "inputSchema", {}) or {},
                            }
                            for tool in tools_result.tools
                        ]
            except asyncio.TimeoutError as e:
                last_exc = e
                logger.warning("MCP list_tools timeout (attempt %d/%d)", attempt, MCP_MAX_RETRIES)
            except Exception as e:
                last_exc = e
                logger.warning("MCP list_tools error (attempt %d/%d): %s", attempt, MCP_MAX_RETRIES, e)

            if attempt < MCP_MAX_RETRIES:
                await asyncio.sleep(MCP_RETRY_BASE_DELAY * (2 ** (attempt - 1)))

        raise MCPError(
            f"Failed to list tools after {MCP_MAX_RETRIES} attempts: {last_exc}",
            attempts=MCP_MAX_RETRIES,
        )

    async def execute_tool(
        self,
        command: str,
        args: List[str],
        env: Dict[str, str] | None,
        tool_name: str,
        tool_args: Dict[str, Any],
    ) -> Any:
        """Connect to an MCP server and execute a specific tool with retry logic."""
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        server_params = StdioServerParameters(
            command=command,
            args=args,
            env=env if env else None,
        )

        last_exc: Exception | None = None
        for attempt in range(1, MCP_MAX_RETRIES + 1):
            try:
                async with stdio_client(server_params) as (read, write):
                    async with ClientSession(read, write) as session:
                        await asyncio.wait_for(session.initialize(), timeout=MCP_TIMEOUT)
                        result = await asyncio.wait_for(
                            session.call_tool(tool_name, tool_args), timeout=MCP_TIMEOUT
                        )
                        return result
            except asyncio.TimeoutError as e:
                last_exc = e
                logger.warning(
                    "MCP tool '%s' timeout (attempt %d/%d)", tool_name, attempt, MCP_MAX_RETRIES
                )
            except Exception as e:
                last_exc = e
                logger.warning(
                    "MCP tool '%s' error (attempt %d/%d): %s", tool_name, attempt, MCP_MAX_RETRIES, e
                )

            if attempt < MCP_MAX_RETRIES:
                await asyncio.sleep(MCP_RETRY_BASE_DELAY * (2 ** (attempt - 1)))

        raise MCPError(
            f"Tool '{tool_name}' failed after {MCP_MAX_RETRIES} attempts: {last_exc}",
            attempts=MCP_MAX_RETRIES,
        )
