"""P1.3 — Tool Use Examples Registry (ACI quality)

Stores structured usage examples per MCP tool — not just JSON schema, but
real operational examples with description, input, expected output pattern,
and known edge cases.

Why this matters: schema validity ≠ correct operational usage.
Fewer malformed tool calls = fewer retries = lower latency.

Storage: ~/.silicon-studio/tool_examples.json (JSONL-indexed)
"""
import json
import logging
import os
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_EXAMPLES_FILE = Path.home() / ".silicon-studio" / "tool_examples.json"


class ToolExamplesRegistry:
    """Persist and retrieve usage examples for MCP tools."""

    def __init__(self, path: Path = _EXAMPLES_FILE):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self._write([])

    # ── Read / Write ──────────────────────────────────────────

    def _read(self) -> List[Dict[str, Any]]:
        try:
            with open(self.path, "r") as f:
                return json.load(f)
        except Exception:
            return []

    def _write(self, data: List[Dict[str, Any]]):
        fd, tmp = tempfile.mkstemp(dir=str(self.path.parent), suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(data, f, indent=2)
            os.replace(tmp, self.path)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass

    # ── CRUD ─────────────────────────────────────────────────

    def add_example(
        self,
        server_id: str,
        tool_name: str,
        description: str,
        input_example: Dict[str, Any],
        expected_output_pattern: str = "",
        edge_cases: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        data = self._read()
        example = {
            "id": str(uuid.uuid4()),
            "server_id": server_id,
            "tool_name": tool_name,
            "description": description,
            "input_example": input_example,
            "expected_output_pattern": expected_output_pattern,
            "edge_cases": edge_cases or [],
            "tags": tags or [],
            "created_at": time.time(),
        }
        data.append(example)
        self._write(data)
        return example

    def get_examples(
        self,
        server_id: Optional[str] = None,
        tool_name: Optional[str] = None,
        tag: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        data = self._read()
        if server_id:
            data = [e for e in data if e.get("server_id") == server_id]
        if tool_name:
            data = [e for e in data if e.get("tool_name") == tool_name]
        if tag:
            data = [e for e in data if tag in e.get("tags", [])]
        return data

    def delete_example(self, example_id: str) -> bool:
        data = self._read()
        before = len(data)
        data = [e for e in data if e.get("id") != example_id]
        if len(data) < before:
            self._write(data)
            return True
        return False

    def format_for_prompt(self, server_id: str, tool_name: str, max_examples: int = 3) -> str:
        """Return a compact prompt-ready string of usage examples for a tool."""
        examples = self.get_examples(server_id=server_id, tool_name=tool_name)[:max_examples]
        if not examples:
            return ""

        lines = [f"### Usage examples for `{tool_name}` on `{server_id}`:"]
        for i, ex in enumerate(examples, 1):
            lines.append(f"\n**Example {i}**: {ex['description']}")
            lines.append(f"Input: `{json.dumps(ex['input_example'])}`")
            if ex.get("expected_output_pattern"):
                lines.append(f"Expected output: {ex['expected_output_pattern']}")
            if ex.get("edge_cases"):
                lines.append(f"Edge cases: {'; '.join(ex['edge_cases'])}")
        return "\n".join(lines)

    def stats(self) -> Dict[str, Any]:
        data = self._read()
        by_tool: Dict[str, int] = {}
        for e in data:
            key = f"{e.get('server_id','?')}/{e.get('tool_name','?')}"
            by_tool[key] = by_tool.get(key, 0) + 1
        return {"total_examples": len(data), "by_tool": by_tool}


# Singleton
tool_examples = ToolExamplesRegistry()
