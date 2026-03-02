"""Tests for NanoCore agent SSE event flow.

Uses httpx.AsyncClient to consume the SSE stream from /api/terminal/run,
with the LLM mocked out so we test the event pipeline without a real model.
"""

import pytest
import json
from unittest.mock import patch, AsyncMock, MagicMock
from httpx import AsyncClient, ASGITransport
from main import app


@pytest.fixture
def mock_model_response():
    """Simulate a model response that triggers a tool call then produces text."""

    async def fake_generate(prompt, **kwargs):
        # First call: model emits a tool call
        return {
            "text": '<tool_call>\n{"name": "run_bash", "arguments": {"command": "echo hello"}}\n</tool_call>',
            "tokens": 20,
        }

    return fake_generate


@pytest.mark.asyncio
async def test_sse_stream_emits_session_start():
    """The first SSE event should always be session_start."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with patch("app.agents.nanocore.supervisor.SupervisorAgent.run") as mock_run:
            # Yield a minimal event sequence
            async def fake_run(prompt):
                yield {"event": "session_start", "data": {"session_id": "test-123"}}
                yield {"event": "done", "data": {"summary": "ok", "total_tokens": 0, "total_time_ms": 10}}

            mock_run.side_effect = fake_run

            resp = await client.post(
                "/api/terminal/run",
                json={"prompt": "say hello", "model_id": "test-model"},
            )
            assert resp.status_code == 200
            assert resp.headers["content-type"].startswith("text/event-stream")

            lines = resp.text.strip().split("\n")
            data_lines = [l for l in lines if l.startswith("data: ")]
            assert len(data_lines) >= 2

            first = json.loads(data_lines[0].removeprefix("data: "))
            assert first["event"] == "session_start"
            assert "session_id" in first["data"]


@pytest.mark.asyncio
async def test_sse_stream_ends_with_done():
    """The last SSE event should always be done."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with patch("app.agents.nanocore.supervisor.SupervisorAgent.run") as mock_run:
            async def fake_run(prompt):
                yield {"event": "session_start", "data": {"session_id": "test-456"}}
                yield {"event": "token_stream", "data": {"agent": "supervisor", "text": "Hello!"}}
                yield {"event": "done", "data": {"summary": "ok", "total_tokens": 10, "total_time_ms": 100}}

            mock_run.side_effect = fake_run

            resp = await client.post(
                "/api/terminal/run",
                json={"prompt": "test", "model_id": "test-model"},
            )
            data_lines = [l for l in resp.text.strip().split("\n") if l.startswith("data: ")]
            last = json.loads(data_lines[-1].removeprefix("data: "))
            assert last["event"] == "done"
            assert "total_tokens" in last["data"]


@pytest.mark.asyncio
async def test_sse_tool_event_sequence():
    """tool_start -> tool_log -> tool_done should be emitted in order."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with patch("app.agents.nanocore.supervisor.SupervisorAgent.run") as mock_run:
            async def fake_run(prompt):
                yield {"event": "session_start", "data": {"session_id": "tool-test"}}
                yield {"event": "tool_start", "data": {"tool": "run_bash", "args": {"command": "echo hi"}, "call_id": "c1"}}
                yield {"event": "tool_log", "data": {"call_id": "c1", "stream": "stdout", "text": "hi\n"}}
                yield {"event": "tool_done", "data": {"call_id": "c1", "exit_code": 0}}
                yield {"event": "done", "data": {"summary": "ran echo", "total_tokens": 5, "total_time_ms": 50}}

            mock_run.side_effect = fake_run

            resp = await client.post(
                "/api/terminal/run",
                json={"prompt": "run echo", "model_id": "test-model"},
            )
            data_lines = [l for l in resp.text.strip().split("\n") if l.startswith("data: ")]
            events = [json.loads(l.removeprefix("data: "))["event"] for l in data_lines]
            assert events == ["session_start", "tool_start", "tool_log", "tool_done", "done"]


@pytest.mark.asyncio
async def test_sse_diff_proposal_event():
    """diff_proposal should include file_path, old, new, and diff fields."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with patch("app.agents.nanocore.supervisor.SupervisorAgent.run") as mock_run:
            async def fake_run(prompt):
                yield {"event": "session_start", "data": {"session_id": "diff-test"}}
                yield {"event": "diff_proposal", "data": {
                    "call_id": "d1",
                    "file_path": "/tmp/test.py",
                    "old": "x = 1",
                    "new": "x = 2",
                    "diff": "- x = 1\n+ x = 2",
                }}
                yield {"event": "done", "data": {"summary": "proposed edit", "total_tokens": 5, "total_time_ms": 50}}

            mock_run.side_effect = fake_run

            resp = await client.post(
                "/api/terminal/run",
                json={"prompt": "edit file", "model_id": "test-model"},
            )
            data_lines = [l for l in resp.text.strip().split("\n") if l.startswith("data: ")]
            events = [json.loads(l.removeprefix("data: ")) for l in data_lines]
            diff_event = next(e for e in events if e["event"] == "diff_proposal")
            assert diff_event["data"]["file_path"] == "/tmp/test.py"
            assert diff_event["data"]["call_id"] == "d1"
            assert "diff" in diff_event["data"]


@pytest.mark.asyncio
async def test_sse_error_in_stream():
    """If the agent raises, an error event should be emitted and the stream should end."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with patch("app.agents.nanocore.supervisor.SupervisorAgent.run") as mock_run:
            async def fake_run(prompt):
                yield {"event": "session_start", "data": {"session_id": "err-test"}}
                raise RuntimeError("model crashed")

            mock_run.side_effect = fake_run

            resp = await client.post(
                "/api/terminal/run",
                json={"prompt": "crash", "model_id": "test-model"},
            )
            data_lines = [l for l in resp.text.strip().split("\n") if l.startswith("data: ")]
            events = [json.loads(l.removeprefix("data: ")) for l in data_lines]
            event_types = [e["event"] for e in events]
            assert "error" in event_types


@pytest.mark.asyncio
async def test_exec_endpoint_sse():
    """/api/terminal/exec should stream tool_start, tool_log, tool_done, done."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/terminal/exec",
            json={"command": "echo integration_test", "timeout": 5},
        )
        assert resp.status_code == 200
        data_lines = [l for l in resp.text.strip().split("\n") if l.startswith("data: ")]
        events = [json.loads(l.removeprefix("data: ")) for l in data_lines]
        event_types = [e["event"] for e in events]
        assert event_types[0] == "tool_start"
        assert "tool_done" in event_types
        assert event_types[-1] == "done"
