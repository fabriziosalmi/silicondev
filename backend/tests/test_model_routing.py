"""Tests for Feature 2: Model Routing."""

import json
import shutil
import tempfile
from pathlib import Path

import pytest

from app.engine.routing import ModelRouter, RoutingConfig, KNOWN_ROLES


class TestRoutingConfig:
    def test_default_config(self):
        cfg = RoutingConfig()
        assert cfg.enabled is False
        assert cfg.routes == {}

    def test_to_dict(self):
        cfg = RoutingConfig(enabled=True, routes={"coder": "model-a", "planner": "model-b"})
        d = cfg.to_dict()
        assert d["enabled"] is True
        assert d["routes"]["coder"] == "model-a"


class TestModelRouter:
    def setup_method(self):
        self.tmpdir = tempfile.mkdtemp()
        self.config_path = Path(self.tmpdir) / "routing.json"

    def teardown_method(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_resolve_disabled(self):
        """When routing is disabled, always return fallback."""
        router = ModelRouter(config_path=self.config_path)
        assert router.resolve("planner", "default-model") == "default-model"
        assert router.resolve("coder", "default-model") == "default-model"
        assert router.resolve("reviewer", "default-model") == "default-model"

    def test_resolve_enabled_with_routes(self):
        self.config_path.write_text(json.dumps({
            "enabled": True,
            "routes": {
                "planner": "big-model",
                "coder": "small-model",
                "default": "medium-model",
            }
        }))
        router = ModelRouter(config_path=self.config_path)

        assert router.resolve("planner", "fallback") == "big-model"
        assert router.resolve("coder", "fallback") == "small-model"
        assert router.resolve("reviewer", "fallback") == "medium-model"  # falls to default
        assert router.resolve("unknown_role", "fallback") == "medium-model"  # falls to default

    def test_resolve_enabled_no_default(self):
        self.config_path.write_text(json.dumps({
            "enabled": True,
            "routes": {"planner": "big-model"}
        }))
        router = ModelRouter(config_path=self.config_path)

        assert router.resolve("planner", "fallback") == "big-model"
        assert router.resolve("coder", "fallback") == "fallback"  # no default route

    def test_save_and_reload(self):
        router = ModelRouter(config_path=self.config_path)
        new_config = RoutingConfig(enabled=True, routes={"coder": "new-model"})
        router.save(new_config)

        # Reload from disk
        router2 = ModelRouter(config_path=self.config_path)
        assert router2.enabled is True
        assert router2.resolve("coder", "x") == "new-model"

    def test_update_routes_partial(self):
        self.config_path.write_text(json.dumps({
            "enabled": True,
            "routes": {"planner": "big", "coder": "small"}
        }))
        router = ModelRouter(config_path=self.config_path)
        router.update_routes({"reviewer": "review-model"})

        assert router.resolve("planner", "x") == "big"
        assert router.resolve("coder", "x") == "small"
        assert router.resolve("reviewer", "x") == "review-model"

    def test_update_routes_with_enable_toggle(self):
        router = ModelRouter(config_path=self.config_path)
        assert router.enabled is False
        router.update_routes({"coder": "model-a"}, enabled=True)
        assert router.enabled is True
        assert router.resolve("coder", "x") == "model-a"

    def test_missing_config_file(self):
        """Should gracefully handle missing config file."""
        router = ModelRouter(config_path=Path(self.tmpdir) / "nonexistent.json")
        assert router.enabled is False
        assert router.resolve("any", "fallback") == "fallback"

    def test_corrupted_config_file(self):
        """Should gracefully handle corrupted JSON."""
        self.config_path.write_text("not valid json {{{")
        router = ModelRouter(config_path=self.config_path)
        assert router.enabled is False

    def test_get_config(self):
        self.config_path.write_text(json.dumps({
            "enabled": True,
            "routes": {"coder": "a", "planner": "b"}
        }))
        router = ModelRouter(config_path=self.config_path)
        cfg = router.get_config()
        assert cfg["enabled"] is True
        assert "coder" in cfg["routes"]

    def test_known_roles(self):
        assert "planner" in KNOWN_ROLES
        assert "coder" in KNOWN_ROLES
        assert "reviewer" in KNOWN_ROLES
        assert "default" in KNOWN_ROLES


class TestPrelayerModelRole:
    def test_role_suggestion(self):
        from app.agents.nanocore.prelayer import analyze_prompt, PromptProfile
        # Complex prompt should suggest "planner"
        profile = analyze_prompt(
            "Refactor the entire authentication system to use JWT tokens with refresh rotation and implement rate limiting",
            "/tmp"
        )
        assert profile.suggested_model_role == "planner"

    def test_review_role(self):
        from app.agents.nanocore.prelayer import analyze_prompt
        profile = analyze_prompt("review this code for bugs", "/tmp")
        assert profile.suggested_model_role == "reviewer"

    def test_simple_edit_role(self):
        from app.agents.nanocore.prelayer import analyze_prompt
        profile = analyze_prompt("fix the typo", "/tmp")
        assert profile.suggested_model_role == "coder"
