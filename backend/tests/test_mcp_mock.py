"""MCP tool tests with mocked stdio subprocess.

Tests MCP client tool discovery and execution without
requiring Node.js or any real MCP server in CI.
"""

import pytest
import asyncio
from unittest.mock import patch, AsyncMock, MagicMock
from app.mcp.client import MCPClient, MCP_TIMEOUT


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

    with patch("app.mcp.client.stdio_client", return_value=mock_stdio), \
         patch("app.mcp.client.ClientSession", return_value=mock_session):
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

    with patch("app.mcp.client.stdio_client", return_value=mock_stdio), \
         patch("app.mcp.client.ClientSession", return_value=mock_session):
        result = await mcp_client.execute_tool(
            "node", ["server.js"], None,
            "read_file", {"path": "/tmp/test.txt"},
        )

    mock_session.call_tool.assert_called_once_with("read_file", {"path": "/tmp/test.txt"})
    assert result is not None


@pytest.mark.asyncio
async def test_timeout_on_initialize(mcp_client):
    """If the MCP server hangs on initialize, asyncio.TimeoutError should propagate."""
    async def slow_init():
        await asyncio.sleep(MCP_TIMEOUT + 5)

    mock_session = AsyncMock()
    mock_session.initialize = slow_init
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    mock_stdio = AsyncMock()
    mock_stdio.__aenter__ = AsyncMock(return_value=(AsyncMock(), AsyncMock()))
    mock_stdio.__aexit__ = AsyncMock(return_value=False)

    with patch("app.mcp.client.stdio_client", return_value=mock_stdio), \
         patch("app.mcp.client.ClientSession", return_value=mock_session), \
         patch("app.mcp.client.MCP_TIMEOUT", 1):  # Override to 1s for fast test
        with pytest.raises(asyncio.TimeoutError):
            await mcp_client.connect_and_list_tools("node", ["slow-server.js"])


@pytest.mark.asyncio
async def test_timeout_on_tool_execution(mcp_client):
    """If a tool call hangs, asyncio.TimeoutError should propagate."""
    async def slow_call(name, args):
        await asyncio.sleep(60)

    mock_session = AsyncMock()
    mock_session.initialize = AsyncMock()
    mock_session.call_tool = slow_call
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    mock_stdio = AsyncMock()
    mock_stdio.__aenter__ = AsyncMock(return_value=(AsyncMock(), AsyncMock()))
    mock_stdio.__aexit__ = AsyncMock(return_value=False)

    with patch("app.mcp.client.stdio_client", return_value=mock_stdio), \
         patch("app.mcp.client.ClientSession", return_value=mock_session), \
         patch("app.mcp.client.MCP_TIMEOUT", 1):
        with pytest.raises(asyncio.TimeoutError):
            await mcp_client.execute_tool(
                "node", ["server.js"], None,
                "slow_tool", {},
            )


@pytest.mark.asyncio
async def test_env_passed_to_server():
    """Custom env vars should be passed to the MCP server subprocess."""
    client = MCPClient()
    captured_params = {}

    def fake_stdio_client(params):
        captured_params["command"] = params.command
        captured_params["args"] = params.args
        captured_params["env"] = params.env
        # Return a mock that will fail (we just want to capture params)
        raise ConnectionError("test capture only")

    with patch("app.mcp.client.stdio_client", side_effect=fake_stdio_client):
        with pytest.raises(ConnectionError):
            await client.connect_and_list_tools(
                "npx", ["-y", "@mcp/server"],
                env={"API_KEY": "test-key-123"},
            )

    assert captured_params["command"] == "npx"
    assert captured_params["args"] == ["-y", "@mcp/server"]
    assert captured_params["env"]["API_KEY"] == "test-key-123"
