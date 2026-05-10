"""MCP tool tests with mocked stdio subprocess.

Tests MCP client tool discovery and execution without
requiring Node.js or any real MCP server in CI.

Updated for retry logic: timeout/error tests now expect MCPError
after all retries are exhausted (not bare asyncio.TimeoutError).
"""

import pytest
import asyncio
from unittest.mock import patch, AsyncMock, MagicMock
from app.mcp.client import MCPClient, MCPError, MCP_TIMEOUT

mcp = pytest.importorskip("mcp", reason="mcp SDK not installed")
pytestmark = pytest.mark.skipif(
    not mcp, reason="mcp SDK required for these tests"
)


@pytest.fixture
def mcp_client():
    return MCPClient()


def _make_mock_tool(name, description, input_schema):
    """Create a mock MCP tool object."""
    tool = MagicMock()
    tool.name = name
    tool.description = description
    tool.inputSchema = input_schema
    return tool


@pytest.mark.asyncio
async def test_list_tools_returns_schema(mcp_client):
    """connect_and_list_tools should return tool name, description, and schema."""
    mock_tools = MagicMock()
    mock_tools.tools = [
        _make_mock_tool("read_file", "Read a file from disk", {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        }),
        _make_mock_tool("write_file", "Write content to a file", {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
            },
            "required": ["path", "content"],
        }),
    ]

    mock_session = AsyncMock()
    mock_session.initialize = AsyncMock()
    mock_session.list_tools = AsyncMock(return_value=mock_tools)
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    mock_stdio = AsyncMock()
    mock_stdio.__aenter__ = AsyncMock(return_value=(AsyncMock(), AsyncMock()))
    mock_stdio.__aexit__ = AsyncMock(return_value=False)

    with patch("mcp.client.stdio.stdio_client", return_value=mock_stdio), \
         patch("mcp.ClientSession", return_value=mock_session):
        tools = await mcp_client.connect_and_list_tools("node", ["server.js"])

    assert len(tools) == 2
    assert tools[0]["name"] == "read_file"
    assert tools[0]["description"] == "Read a file from disk"
    assert "properties" in tools[0]["inputSchema"]
    assert tools[1]["name"] == "write_file"


@pytest.mark.asyncio
async def test_execute_tool_returns_result(mcp_client):
    """execute_tool should call session.call_tool and return the result."""
    mock_result = MagicMock()
    mock_result.content = [MagicMock(text="file contents here")]

    mock_session = AsyncMock()
    mock_session.initialize = AsyncMock()
    mock_session.call_tool = AsyncMock(return_value=mock_result)
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    mock_stdio = AsyncMock()
    mock_stdio.__aenter__ = AsyncMock(return_value=(AsyncMock(), AsyncMock()))
    mock_stdio.__aexit__ = AsyncMock(return_value=False)

    with patch("mcp.client.stdio.stdio_client", return_value=mock_stdio), \
         patch("mcp.ClientSession", return_value=mock_session):
        result = await mcp_client.execute_tool(
            "node", ["server.js"], None,
            "read_file", {"path": "/tmp/test.txt"},
        )

    mock_session.call_tool.assert_called_once_with("read_file", {"path": "/tmp/test.txt"})
    assert result is not None


@pytest.mark.asyncio
async def test_timeout_on_initialize_raises_mcp_error(mcp_client):
    """If the MCP server hangs on initialize, MCPError is raised after all retries."""
    async def slow_init():
        await asyncio.sleep(10)

    mock_session = AsyncMock()
    mock_session.initialize = slow_init
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    mock_stdio = AsyncMock()
    mock_stdio.__aenter__ = AsyncMock(return_value=(AsyncMock(), AsyncMock()))
    mock_stdio.__aexit__ = AsyncMock(return_value=False)

    with patch("mcp.client.stdio.stdio_client", return_value=mock_stdio), \
         patch("mcp.ClientSession", return_value=mock_session), \
         patch("app.mcp.client.MCP_TIMEOUT", 0.05), \
         patch("app.mcp.client.MCP_RETRY_BASE_DELAY", 0.01), \
         patch("app.mcp.client.MCP_MAX_RETRIES", 2):
        with pytest.raises(MCPError) as exc_info:
            await mcp_client.connect_and_list_tools("node", ["slow-server.js"])
    assert exc_info.value.attempts == 2


@pytest.mark.asyncio
async def test_timeout_on_tool_execution_raises_mcp_error(mcp_client):
    """If a tool call hangs, MCPError is raised after all retries."""
    async def slow_call(name, args):
        await asyncio.sleep(10)

    mock_session = AsyncMock()
    mock_session.initialize = AsyncMock()
    mock_session.call_tool = slow_call
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    mock_stdio = AsyncMock()
    mock_stdio.__aenter__ = AsyncMock(return_value=(AsyncMock(), AsyncMock()))
    mock_stdio.__aexit__ = AsyncMock(return_value=False)

    with patch("mcp.client.stdio.stdio_client", return_value=mock_stdio), \
         patch("mcp.ClientSession", return_value=mock_session), \
         patch("app.mcp.client.MCP_TIMEOUT", 0.05), \
         patch("app.mcp.client.MCP_RETRY_BASE_DELAY", 0.01), \
         patch("app.mcp.client.MCP_MAX_RETRIES", 2):
        with pytest.raises(MCPError) as exc_info:
            await mcp_client.execute_tool(
                "node", ["server.js"], None,
                "slow_tool", {},
            )
    assert exc_info.value.attempts == 2


@pytest.mark.asyncio
async def test_env_passed_to_server():
    """Custom env vars should be passed to the MCP server subprocess."""
    client = MCPClient()
    captured_params = {}

    def fake_stdio_client(params):
        captured_params["command"] = params.command
        captured_params["args"] = params.args
        captured_params["env"] = params.env
        raise ConnectionError("test capture only")

    with patch("mcp.client.stdio.stdio_client", side_effect=fake_stdio_client), \
         patch("app.mcp.client.MCP_RETRY_BASE_DELAY", 0.01), \
         patch("app.mcp.client.MCP_MAX_RETRIES", 1):
        with pytest.raises(MCPError):
            await client.connect_and_list_tools(
                "npx", ["-y", "@mcp/server"],
                env={"API_KEY": "test-key-123"},
            )

    assert captured_params["command"] == "npx"
    assert captured_params["args"] == ["-y", "@mcp/server"]
    assert captured_params["env"]["API_KEY"] == "test-key-123"
