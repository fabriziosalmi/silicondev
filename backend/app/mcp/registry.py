import json
import logging
import os
import tempfile
import time
from pathlib import Path
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)


class MCPServerRegistry:
    """Manages configured MCP server definitions stored in ~/.silicon-studio/mcp_servers.json."""

    def __init__(self):
        self.config_path = Path.home() / ".silicon-studio" / "mcp_servers.json"
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        self.servers: List[Dict[str, Any]] = self._load()

    def _load(self) -> List[Dict[str, Any]]:
        if self.config_path.exists():
            try:
                with open(self.config_path) as f:
                    data = json.load(f)
                    # Back-fill `enabled` flag for servers created before this version
                    for s in data:
                        s.setdefault("enabled", True)
                    return data
            except Exception as e:
                logger.error(f"Failed to load MCP servers config: {e}")
        return []

    def _save(self):
        """Atomic save to prevent corruption on crash."""
        fd, tmp = tempfile.mkstemp(
            dir=str(self.config_path.parent), suffix=".tmp"
        )
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(self.servers, f, indent=2)
            os.replace(tmp, self.config_path)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    def list_servers(self) -> List[Dict[str, Any]]:
        return self.servers

    def list_enabled_servers(self) -> List[Dict[str, Any]]:
        return [s for s in self.servers if s.get("enabled", True)]

    def add_server(
        self,
        name: str,
        command: str,
        args: List[str] | None = None,
        env: Dict[str, str] | None = None,
        transport: str = "stdio",
        enabled: bool = True,
    ) -> Dict[str, Any]:
        server = {
            "id": name.lower().replace(" ", "-"),
            "name": name,
            "command": command,
            "args": args or [],
            "env": env or {},
            "transport": transport,
            "enabled": enabled,
            "added_at": time.time(),
        }
        # Replace existing server with same id
        self.servers = [s for s in self.servers if s["id"] != server["id"]]
        self.servers.append(server)
        self._save()
        return server

    def remove_server(self, server_id: str) -> bool:
        before = len(self.servers)
        self.servers = [s for s in self.servers if s["id"] != server_id]
        if len(self.servers) < before:
            self._save()
            return True
        return False

    def set_enabled(self, server_id: str, enabled: bool) -> Optional[Dict[str, Any]]:
        """Enable or disable a server by ID. Returns updated server or None if not found."""
        for s in self.servers:
            if s["id"] == server_id:
                s["enabled"] = enabled
                self._save()
                return s
        return None

    def get_server(self, server_id: str) -> Optional[Dict[str, Any]]:
        for s in self.servers:
            if s["id"] == server_id:
                return s
        return None
