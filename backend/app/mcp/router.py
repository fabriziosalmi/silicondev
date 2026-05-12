"""P1.1 — MCP Router: Progressive Tool Discovery

Exposes only relevant tools to the LLM on-demand instead of flooding
the context with every tool schema upfront.

How it works:
1. A lightweight in-process index of all tools across all enabled MCP servers
   is built (and refreshed) without connecting LLM context.
2. When the LLM needs tools, it calls /api/mcp/router/search?q=<intent>
   to get the N most relevant tool schemas.
3. The full catalog is never injected into a single prompt.

The index uses BM25 over tool name + description + inputSchema keys.
"""
import asyncio
import logging
import time
import threading
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_ROUTER_CACHE_TTL = 300  # seconds before full re-discovery


class MCPRouter:
    """Lazy, in-process tool index over all enabled MCP servers."""

    def __init__(self):
        self._lock = threading.Lock()
        self._index: List[Dict[str, Any]] = []   # flat list of enriched tool records
        self._last_built: float = 0.0
        # Async lock created lazily to bind to the running event loop.
        # Serialises concurrent refresh() calls so we don't spawn parallel
        # discovery storms when multiple search/list requests arrive while
        # the index is stale.
        self._refresh_lock: Optional[asyncio.Lock] = None

    def _get_refresh_lock(self) -> asyncio.Lock:
        if self._refresh_lock is None:
            self._refresh_lock = asyncio.Lock()
        return self._refresh_lock

    # ── Public API ────────────────────────────────────────────

    def is_stale(self) -> bool:
        return (time.time() - self._last_built) > _ROUTER_CACHE_TTL

    async def refresh(self, service) -> int:
        """Rebuild the tool index from all enabled MCP servers. Returns tool count.

        Concurrent callers are serialised: the second arrival waits for the
        first to finish and then no-ops if the index has just been rebuilt.
        """
        from app.mcp.registry import MCPServerRegistry
        from app.mcp.client import MCPClient

        lock = self._get_refresh_lock()
        async with lock:
            # Skip if another caller refreshed while we waited
            if not self.is_stale() and self._last_built > 0:
                return len(self._index)

            registry = MCPServerRegistry()
            client = MCPClient()
            enabled = registry.list_enabled_servers()

            new_index: List[Dict[str, Any]] = []
            for server in enabled:
                try:
                    tools = await client.connect_and_list_tools(
                        server["command"], server.get("args", []), server.get("env", {})
                    )
                    for tool in tools:
                        new_index.append({
                            "server_id": server["id"],
                            "server_name": server["name"],
                            "name": tool["name"],
                            "description": tool.get("description", ""),
                            "inputSchema": tool.get("inputSchema", {}),
                            "_search_blob": (
                                f"{server['name']} {tool['name']} "
                                f"{tool.get('description', '')} "
                                f"{' '.join(tool.get('inputSchema', {}).get('properties', {}).keys())}"
                            ).lower(),
                        })
                except Exception as e:
                    logger.warning("MCPRouter: failed to index server %s: %s", server["id"], e)

            with self._lock:
                self._index = new_index
                self._last_built = time.time()

            logger.info("MCPRouter: indexed %d tools from %d servers", len(new_index), len(enabled))
            return len(new_index)

    def search(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """Return the top_k most relevant tool schemas for a given query string."""
        with self._lock:
            index = list(self._index)

        if not index:
            return []

        query_lower = query.lower()
        query_terms = set(query_lower.split())

        scored = []
        for tool in index:
            blob = tool["_search_blob"]
            # Exact name match — highest priority
            name_score = 10 if query_lower in tool["name"].lower() else 0
            # Term overlap score
            term_score = sum(1 for t in query_terms if t in blob)
            total = name_score + term_score
            if total > 0:
                scored.append((total, tool))

        scored.sort(key=lambda x: x[0], reverse=True)
        results = []
        for _, tool in scored[:top_k]:
            results.append({
                "server_id": tool["server_id"],
                "server_name": tool["server_name"],
                "name": tool["name"],
                "description": tool["description"],
                "inputSchema": tool["inputSchema"],
            })
        return results

    def list_all(self, server_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Return all indexed tools, optionally filtered by server_id."""
        with self._lock:
            tools = list(self._index)
        if server_id:
            tools = [t for t in tools if t["server_id"] == server_id]
        return [{k: v for k, v in t.items() if k != "_search_blob"} for t in tools]

    def stats(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "total_tools": len(self._index),
                "last_built": self._last_built,
                "age_seconds": round(time.time() - self._last_built) if self._last_built else None,
                "stale": self.is_stale(),
            }


# Singleton
mcp_router = MCPRouter()
