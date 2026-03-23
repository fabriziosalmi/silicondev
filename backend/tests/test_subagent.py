"""Tests for Feature 4: Subagent System."""

import pytest

from app.agents.nanocore.subagent import (
    SubagentWorker,
    WORKER_ROLES,
    parse_tool_calls,
    execute_tool,
)
from app.agents.nanocore.orchestrator import SubagentOrchestrator


# ── Tool Parsing ────────────────────────────────────────────────


class TestToolParsing:
    def test_parse_single_tool(self):
        text = '''Let me read the file.
<tool name="read_file">
<arg name="path">src/auth.py</arg>
</tool>'''
        calls = parse_tool_calls(text)
        assert len(calls) == 1
        assert calls[0]["name"] == "read_file"
        assert calls[0]["args"]["path"] == "src/auth.py"

    def test_parse_multiple_tools(self):
        text = '''<tool name="read_file"><arg name="path">a.py</arg></tool>
Some text
<tool name="run_bash"><arg name="command">ls</arg></tool>'''
        calls = parse_tool_calls(text)
        assert len(calls) == 2
        assert calls[0]["name"] == "read_file"
        assert calls[1]["name"] == "run_bash"

    def test_parse_no_tools(self):
        text = "Just a plain response with no tool calls."
        calls = parse_tool_calls(text)
        assert len(calls) == 0

    def test_parse_tool_with_multiple_args(self):
        text = '''<tool name="patch_file">
<arg name="path">test.py</arg>
<arg name="search">old code</arg>
<arg name="replace">new code</arg>
</tool>'''
        calls = parse_tool_calls(text)
        assert len(calls) == 1
        assert calls[0]["args"]["path"] == "test.py"
        assert calls[0]["args"]["search"] == "old code"
        assert calls[0]["args"]["replace"] == "new code"


# ── Worker Roles ────────────────────────────────────────────────


class TestWorkerRoles:
    def test_all_roles_have_required_fields(self):
        for role_id, cfg in WORKER_ROLES.items():
            assert "label" in cfg, f"{role_id} missing label"
            assert "system" in cfg, f"{role_id} missing system"
            assert "tools" in cfg, f"{role_id} missing tools"
            assert "can_write" in cfg, f"{role_id} missing can_write"

    def test_code_reviewer_is_read_only(self):
        cfg = WORKER_ROLES["code_reviewer"]
        assert cfg["can_write"] is False
        assert "patch_file" not in cfg["tools"]
        assert "edit_file" not in cfg["tools"]

    def test_bug_fixer_can_write(self):
        cfg = WORKER_ROLES["bug_fixer"]
        assert cfg["can_write"] is True
        assert "patch_file" in cfg["tools"]

    def test_test_writer_has_bash(self):
        cfg = WORKER_ROLES["test_writer"]
        assert "run_bash" in cfg["tools"]
        assert "patch_file" in cfg["tools"]


# ── Worker Initialization ──────────────────────────────────────


class TestWorkerInit:
    def test_valid_role(self):
        w = SubagentWorker(
            worker_id="w-test",
            role="code_reviewer",
            model_id="test-model",
            workspace_dir="/tmp",
        )
        assert w.role == "code_reviewer"
        assert w.label == "Code Reviewer"
        assert w.can_write is False

    def test_invalid_role_raises(self):
        with pytest.raises(ValueError, match="Unknown worker role"):
            SubagentWorker(
                worker_id="w-test",
                role="nonexistent_role",
                model_id="test-model",
                workspace_dir="/tmp",
            )

    def test_system_prompt_contains_tools(self):
        w = SubagentWorker(
            worker_id="w-test",
            role="bug_fixer",
            model_id="test-model",
            workspace_dir="/tmp",
        )
        assert "read_file" in w._system_prompt
        assert "run_bash" in w._system_prompt
        assert "patch_file" in w._system_prompt

    def test_summary(self):
        w = SubagentWorker(
            worker_id="w-test",
            role="code_reviewer",
            model_id="test-model",
            workspace_dir="/tmp",
        )
        s = w.summary()
        assert s["worker_id"] == "w-test"
        assert s["role"] == "code_reviewer"
        assert s["label"] == "Code Reviewer"
        assert s["model_id"] == "test-model"


# ── Tool Execution (blocked tools) ─────────────────────────────


class TestToolExecution:
    @pytest.mark.asyncio
    async def test_blocked_tool(self):
        result = await execute_tool(
            "patch_file",
            {"path": "test.py", "search": "a", "replace": "b"},
            "/tmp",
            allowed_tools=("read_file",),  # patch_file not allowed
        )
        assert "not available" in result

    @pytest.mark.asyncio
    async def test_unknown_tool(self):
        result = await execute_tool(
            "delete_everything",
            {},
            "/tmp",
            allowed_tools=("read_file", "run_bash"),
        )
        assert "not available" in result


# ── Orchestrator ────────────────────────────────────────────────


class TestOrchestrator:
    def test_available_roles(self):
        roles = SubagentOrchestrator.available_roles()
        assert "code_reviewer" in roles
        assert "test_writer" in roles
        assert "docs_generator" in roles
        assert "bug_fixer" in roles

    def test_list_workers_empty(self):
        orch = SubagentOrchestrator(
            default_model_id="test-model",
            workspace_dir="/tmp",
        )
        status = orch.list_workers()
        assert status["active"] == []
        assert status["completed"] == []

    def test_resolve_model_without_router(self):
        orch = SubagentOrchestrator(
            default_model_id="fallback-model",
            workspace_dir="/tmp",
        )
        assert orch._resolve_model("code_reviewer") == "fallback-model"
        assert orch._resolve_model("bug_fixer") == "fallback-model"

    def test_resolve_model_with_router(self):
        from app.engine.routing import ModelRouter, RoutingConfig
        import tempfile, json
        from pathlib import Path

        tmpdir = tempfile.mkdtemp()
        config_path = Path(tmpdir) / "routing.json"
        config_path.write_text(json.dumps({
            "enabled": True,
            "routes": {"reviewer": "review-model", "coder": "code-model"}
        }))
        router = ModelRouter(config_path=config_path)

        orch = SubagentOrchestrator(
            default_model_id="fallback",
            workspace_dir="/tmp",
            router=router,
        )
        # code_reviewer maps to "reviewer" role
        assert orch._resolve_model("code_reviewer") == "review-model"
        # test_writer maps to "coder" role
        assert orch._resolve_model("test_writer") == "code-model"

        import shutil
        shutil.rmtree(tmpdir)
