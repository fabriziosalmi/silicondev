"""End-to-end integration test for the NanoCore coder agent.

Tests the full SSE flow: session → thinking → tool_start → diff_proposal → done
with real MLX models. Requires the backend to be running on localhost:8420.

Usage:
    # Start backend first:
    cd backend && uvicorn app.main:app --port 8420

    # Then run tests:
    python tests/test_coder_e2e.py

    # Or with pytest:
    pytest tests/test_coder_e2e.py -v -s
"""

import asyncio
import json
import os
import sys
import tempfile
import time
from pathlib import Path

import httpx
import pytest

API_BASE = os.environ.get("SILICON_API", "http://localhost:8420")

# Models to test with (smallest first for speed)
TEST_MODELS = [
    "/Users/fab/.lmstudio/models/mlx-community/Qwen3-0.6B-4bit",
    "/Users/fab/.lmstudio/models/lmstudio-community/Qwen3-1.7B-MLX-8bit",
    "/Users/fab/.lmstudio/models/lmstudio-community/Qwen3-4B-MLX-4bit",
]

# Test file content — simple Python script the agent can edit
TEST_FILE_CONTENT = '''\
# Calculator script
import sys

def add(a, b):
    return a + b

def subtract(a, b):
    return a - b

def main():
    print("Calculator ready")
    x = add(2, 3)
    print(f"2 + 3 = {x}")

if __name__ == "__main__":
    main()
'''

# Prompts that should trigger patch_file usage
TEST_PROMPTS = [
    "Add a multiply function and call it in main with 4 * 5",
    "Add input validation to the add function - raise TypeError if args aren't numbers",
    "Add a divide function that handles division by zero gracefully",
]


async def check_backend():
    """Verify backend is running."""
    async with httpx.AsyncClient() as client:
        try:
            r = await client.get(f"{API_BASE}/health", timeout=3)
            return r.status_code == 200
        except Exception:
            return False


async def load_model(model_id: str) -> bool:
    """Load a model via the engine API. Returns True if loaded."""
    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(
                f"{API_BASE}/api/engine/models/load",
                json={"model_id": model_id},
                timeout=120,
            )
            if r.status_code != 200:
                print(f"  Load response {r.status_code}: {r.text[:200]}")
            return r.status_code == 200
        except Exception as e:
            print(f"  Failed to load model: {e}")
            return False


async def unload_model() -> bool:
    """Unload current model."""
    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(f"{API_BASE}/api/engine/models/unload", timeout=30)
            return r.status_code == 200
        except Exception:
            return False


async def run_agent_session(
    prompt: str,
    model_id: str,
    workspace_dir: str,
    active_file: dict | None = None,
    timeout: float = 120,
) -> dict:
    """Run a full agent session and collect all SSE events.

    Returns:
        {
            "events": [...],          # all SSE events
            "session_id": str,
            "diff_proposals": [...],  # diff_proposal events
            "errors": [...],
            "done": bool,
            "total_tokens": int,
            "elapsed_ms": float,
        }
    """
    body = {
        "prompt": prompt,
        "model_id": model_id,
        "max_iterations": 5,
        "temperature": 0.3,
        "max_total_tokens": 10000,
        "mode": "edit",
        "workspace_dir": workspace_dir,
    }
    if active_file:
        body["active_file"] = active_file

    events = []
    session_id = ""
    diff_proposals = []
    errors = []
    done = False
    total_tokens = 0
    elapsed_ms = 0

    async with httpx.AsyncClient() as client:
        async with client.stream(
            "POST",
            f"{API_BASE}/api/terminal/run",
            json=body,
            timeout=timeout,
        ) as response:
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                try:
                    event = json.loads(line[6:])
                except json.JSONDecodeError:
                    continue

                events.append(event)
                evt_type = event.get("event", "")

                if evt_type == "session_start":
                    session_id = event.get("data", {}).get("session_id", "")

                elif evt_type == "diff_proposal":
                    diff_proposals.append(event)
                    # Auto-approve diffs
                    call_id = event.get("data", {}).get("call_id", "")
                    if call_id and session_id:
                        await client.post(
                            f"{API_BASE}/api/terminal/diff/decide",
                            json={
                                "session_id": session_id,
                                "call_id": call_id,
                                "approved": True,
                                "reason": "",
                            },
                            timeout=10,
                        )

                elif evt_type == "error":
                    errors.append(event.get("data", {}).get("message", "unknown"))

                elif evt_type == "done":
                    done = True
                    total_tokens = event.get("data", {}).get("total_tokens", 0)
                    elapsed_ms = event.get("data", {}).get("total_time_ms", 0)

    return {
        "events": events,
        "session_id": session_id,
        "diff_proposals": diff_proposals,
        "errors": errors,
        "done": done,
        "total_tokens": total_tokens,
        "elapsed_ms": elapsed_ms,
    }


async def _fetch_checkpoints(session_id: str):
    """Test checkpoint listing for a session."""
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{API_BASE}/api/terminal/checkpoints/{session_id}",
            timeout=10,
        )
        if r.status_code == 200:
            data = r.json()
            return data.get("checkpoints", [])
        return None


async def _try_undo(session_id: str):
    """Test undo for a session."""
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{API_BASE}/api/terminal/undo",
            json={"session_id": session_id},
            timeout=10,
        )
        return r.status_code == 200, r.json() if r.status_code < 500 else {}


def print_result(label: str, result: dict):
    """Pretty-print a test result."""
    event_types = [e.get("event") for e in result["events"]]
    type_counts = {}
    for t in event_types:
        type_counts[t] = type_counts.get(t, 0) + 1

    status = "PASS" if result["done"] and not result["errors"] else "FAIL"
    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"  Status: {status}")
    print(f"  Session: {result['session_id']}")
    print(f"  Events: {len(result['events'])} total")
    print(f"  Types: {type_counts}")
    print(f"  Diffs: {len(result['diff_proposals'])}")
    print(f"  Errors: {result['errors'] or 'none'}")
    print(f"  Tokens: {result['total_tokens']}")
    print(f"  Time: {result['elapsed_ms']}ms")

    # Check for literal \n in diff proposals (the bug we fixed)
    for dp in result["diff_proposals"]:
        new_content = dp.get("data", {}).get("new_content", "")
        if "\\n" in new_content and "\n" not in new_content:
            print(f"  BUG: Literal \\n found in diff new_content!")

    print(f"{'='*60}")
    return status == "PASS"


# ── Pytest fixtures ──────────────────────────────────────────

@pytest.fixture(scope="session")
def workspace_dir():
    """Create a workspace with a test file.
    Uses a real path (not /tmp) to avoid macOS /private protection."""
    d = Path.home() / ".silicon-studio" / "test_workspace"
    d.mkdir(parents=True, exist_ok=True)
    test_file = d / "calculator.py"
    test_file.write_text(TEST_FILE_CONTENT)
    yield str(d)


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# ── Tests ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_backend_health():
    """Backend must be running."""
    ok = await check_backend()
    assert ok, f"Backend not running at {API_BASE}. Start it first."


@pytest.mark.asyncio
@pytest.mark.parametrize("model_idx", [0, 1, 2], ids=["qwen3-0.6b", "qwen3-1.7b", "qwen3-4b"])
async def test_coder_session(model_idx, workspace_dir):
    """Test a full coder session with each model."""
    model_id = TEST_MODELS[model_idx]
    prompt = TEST_PROMPTS[model_idx]

    # Reset test file
    test_file = Path(workspace_dir) / "calculator.py"
    test_file.write_text(TEST_FILE_CONTENT)

    print(f"\n--- Loading model: {model_id} ---")
    loaded = await load_model(model_id)
    assert loaded, f"Failed to load {model_id}"

    print(f"--- Running: '{prompt}' ---")
    result = await run_agent_session(
        prompt=prompt,
        model_id=model_id,
        workspace_dir=workspace_dir,
        active_file={
            "path": str(test_file),
            "content": TEST_FILE_CONTENT,
            "language": "python",
        },
        timeout=180,
    )

    ok = print_result(f"Model: {model_id.split('/')[-1]} | Prompt: {prompt[:40]}...", result)

    # Assertions
    assert result["done"], "Session did not complete"
    assert result["session_id"], "No session_id received"

    # Check event flow has expected types
    event_types = {e.get("event") for e in result["events"]}
    assert "session_start" in event_types, "Missing session_start event"
    assert "done" in event_types, "Missing done event"

    # Check for literal \n bug in any diffs
    for dp in result["diff_proposals"]:
        new_content = dp.get("data", {}).get("new_content", "")
        diff_text = dp.get("data", {}).get("diff", "")
        assert not ("\\n" in new_content and "\n" not in new_content), \
            "Literal \\n found in diff content — unescape bug"
        assert not ("\\n" in diff_text and "\n" not in diff_text), \
            "Literal \\n found in diff text — unescape bug"

    # Test checkpoints if edits were made (auto-approved diffs create checkpoints)
    if result["diff_proposals"]:
        checkpoints = await _fetch_checkpoints(result["session_id"])
        assert checkpoints is not None, "Failed to fetch checkpoints"
        print(f"  Checkpoints: {len(checkpoints)}")

        # Test undo only if there are checkpoints (small models may produce
        # diff proposals that fail to apply, resulting in no checkpoints)
        if len(checkpoints) > 0:
            file_before_undo = test_file.read_text()
            undo_ok, undo_data = await _try_undo(result["session_id"])
            if undo_ok:
                file_after_undo = test_file.read_text()
                assert file_after_undo != file_before_undo, \
                    "Undo did not change the file"
                print(f"  Undo: OK (restored {undo_data.get('file_path', '?')})")
            else:
                print(f"  Undo: {undo_data}")

    await unload_model()


@pytest.mark.asyncio
async def test_parser_unescape():
    """Verify the parser unescapes literal \\n from small models."""
    # This test doesn't need the backend — it tests the parser directly
    sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
    from app.agents.nanocore.parser import extract_tool_calls

    # Model outputs literal \n
    xml = (
        '<tool name="patch_file">'
        '<arg name="path">test.py</arg>'
        '<arg name="search">print("hello")</arg>'
        '<arg name="replace">print("hello")\\nprint("world")</arg>'
        '</tool>'
    )
    calls = extract_tool_calls(xml)
    assert len(calls) == 1
    assert "\n" in calls[0].args["replace"], "Literal \\n was not unescaped"
    assert "\\n" not in calls[0].args["replace"], "Literal \\n still present after unescape"

    # Normal multi-line arg stays unchanged
    xml2 = (
        '<tool name="patch_file">'
        '<arg name="search">line1\nline2</arg>'
        '<arg name="replace">line1\nline2\nline3</arg>'
        '</tool>'
    )
    calls2 = extract_tool_calls(xml2)
    assert calls2[0].args["replace"] == "line1\nline2\nline3"


# ── Standalone runner ────────────────────────────────────────

async def main():
    """Run tests without pytest."""
    print("NanoCore Coder E2E Test")
    print(f"Backend: {API_BASE}")

    if not await check_backend():
        print(f"\nBackend not running at {API_BASE}.")
        print("Start it with: cd backend && uvicorn app.main:app --port 8420")
        sys.exit(1)

    # Create workspace (avoid /tmp on macOS — resolves to /private which is protected)
    workspace = str(Path.home() / ".silicon-studio" / "test_workspace")
    Path(workspace).mkdir(parents=True, exist_ok=True)

    if True:
        test_file = Path(workspace) / "calculator.py"
        results = []

        for i, (model_id, prompt) in enumerate(zip(TEST_MODELS, TEST_PROMPTS)):
            # Reset file for each test
            test_file.write_text(TEST_FILE_CONTENT)

            print(f"\n{'#'*60}")
            print(f"# Test {i+1}/3: {model_id.split('/')[-1]}")
            print(f"# Prompt: {prompt}")
            print(f"{'#'*60}")

            # Load model
            print("Loading model...")
            if not await load_model(model_id):
                print(f"SKIP: Could not load {model_id}")
                results.append(("SKIP", model_id))
                continue

            # Run session
            print("Running agent session...")
            t0 = time.time()
            result = await run_agent_session(
                prompt=prompt,
                model_id=model_id,
                workspace_dir=workspace,
                active_file={
                    "path": str(test_file),
                    "content": TEST_FILE_CONTENT,
                    "language": "python",
                },
            )
            wall_time = time.time() - t0

            ok = print_result(
                f"Test {i+1}: {model_id.split('/')[-1]}",
                result,
            )
            print(f"  Wall time: {wall_time:.1f}s")

            # Test checkpoints
            if result["diff_proposals"] and result["session_id"]:
                cps = await _fetch_checkpoints(result["session_id"])
                if cps:
                    print(f"  Checkpoints: {len(cps)} entries")
                    for cp in cps:
                        print(f"    [{cp['index']}] {cp['tool']} → {cp['file_path'].split('/')[-1]} @ {cp['timestamp']:.0f}")

                    # Test undo
                    undo_ok, undo_data = await _try_undo(result["session_id"])
                    print(f"  Undo: {'OK' if undo_ok else 'FAIL'} {undo_data}")

            # Show modified file
            if test_file.exists():
                content = test_file.read_text()
                if content != TEST_FILE_CONTENT:
                    print(f"\n  Modified file ({len(content)} chars):")
                    for line in content.split("\n")[:20]:
                        print(f"    {line}")
                else:
                    print("  File unchanged (agent made no edits)")

            results.append(("PASS" if ok else "FAIL", model_id))

            # Unload for next test
            await unload_model()
            await asyncio.sleep(1)

        # Summary
        print(f"\n{'='*60}")
        print("SUMMARY")
        print(f"{'='*60}")
        for status, model in results:
            icon = {"PASS": "+", "FAIL": "x", "SKIP": "-"}[status]
            print(f"  [{icon}] {status}: {model.split('/')[-1]}")

        failures = sum(1 for s, _ in results if s == "FAIL")
        print(f"\n{len(results)} tests, {failures} failures")
        sys.exit(1 if failures else 0)


if __name__ == "__main__":
    asyncio.run(main())
