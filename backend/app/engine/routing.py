"""Model routing: map agent roles to different model_ids.

Allows the supervisor to use a large model for planning and a small fast
model for tool parsing, or different expert models in the swarm.

Config lives in ~/.silicon-studio/routing.json:

    {
        "enabled": true,
        "routes": {
            "planner": "qwen/qwen3-32b-4bit",
            "coder": "deepseek-coder-7b-4bit",
            "reviewer": "llama-8b-4bit",
            "default": "qwen/qwen3-32b-4bit"
        }
    }

If the file doesn't exist or enabled=false, all roles resolve to the
caller's model_id (single-model mode, fully backward compatible).
"""

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional

logger = logging.getLogger(__name__)

_DEFAULT_CONFIG_PATH = Path.home() / ".silicon-studio" / "routing.json"


@dataclass
class RoutingConfig:
    enabled: bool = False
    routes: Dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {"enabled": self.enabled, "routes": dict(self.routes)}


class ModelRouter:
    """Resolves agent roles to model_ids based on a routing config.

    Thread-safe: config is loaded once and replaced atomically on reload.
    """

    def __init__(self, config_path: Optional[Path] = None):
        self._config_path = config_path or _DEFAULT_CONFIG_PATH
        self._config = RoutingConfig()
        self.reload()

    @property
    def enabled(self) -> bool:
        return self._config.enabled

    @property
    def routes(self) -> Dict[str, str]:
        return dict(self._config.routes)

    def resolve(self, role: str, fallback: str) -> str:
        """Return the model_id for a given role.

        If routing is disabled or the role isn't configured, returns fallback.
        The fallback is typically the caller's self.model_id.
        """
        if not self._config.enabled:
            return fallback
        model_id = self._config.routes.get(role)
        if model_id:
            return model_id
        # Try "default" route
        default = self._config.routes.get("default")
        if default:
            return default
        return fallback

    def reload(self) -> RoutingConfig:
        """(Re)load config from disk.  Returns the loaded config."""
        if not self._config_path.exists():
            self._config = RoutingConfig()
            return self._config

        try:
            raw = json.loads(self._config_path.read_text())
            self._config = RoutingConfig(
                enabled=bool(raw.get("enabled", False)),
                routes=dict(raw.get("routes", {})),
            )
            if self._config.enabled:
                logger.info("Model routing enabled: %s", self._config.routes)
            else:
                logger.info("Model routing config loaded but disabled")
        except Exception as e:
            logger.warning("Failed to load routing config from %s: %s", self._config_path, e)
            self._config = RoutingConfig()

        return self._config

    def save(self, config: RoutingConfig) -> None:
        """Write config to disk and apply it."""
        self._config_path.parent.mkdir(parents=True, exist_ok=True)
        self._config_path.write_text(json.dumps(config.to_dict(), indent=2))
        self._config = config
        logger.info("Routing config saved: %s", config.to_dict())

    def update_routes(self, routes: Dict[str, str], enabled: Optional[bool] = None) -> RoutingConfig:
        """Update routes (partial merge) and optionally toggle enabled."""
        new_routes = dict(self._config.routes)
        new_routes.update(routes)
        new_enabled = enabled if enabled is not None else self._config.enabled
        new_config = RoutingConfig(enabled=new_enabled, routes=new_routes)
        self.save(new_config)
        return new_config

    def get_config(self) -> dict:
        """Return current config as a plain dict."""
        return self._config.to_dict()


# Roles recognized by the system
KNOWN_ROLES = ("planner", "coder", "reviewer", "inspector", "default")
