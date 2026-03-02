"""Stress tests for the sandbox subprocess timeout.

Verifies that fork bombs, infinite loops, and memory hogs
are killed by the timeout without hanging the pytest process.
"""

import pytest
from app.sandbox.service import SandboxService


@pytest.fixture
def sandbox():
    return SandboxService(default_timeout=3)


@pytest.mark.asyncio
async def test_infinite_loop_killed(sandbox):
    """A while-true loop should be killed by the timeout."""
    result = await sandbox.run("while True: pass", "python", timeout=2)
    assert result["timed_out"] is True
    assert result["exit_code"] != 0
    assert "timeout" in result["stderr"].lower()


@pytest.mark.asyncio
async def test_bash_infinite_loop_killed(sandbox):
    """Bash while-true should be killed by the timeout."""
    result = await sandbox.run("while true; do :; done", "bash", timeout=2)
    assert result["timed_out"] is True


@pytest.mark.asyncio
async def test_fork_bomb_killed(sandbox):
    """A Python fork bomb (os.fork loop) should be killed by the timeout.

    We use a controlled version that won't actually destroy the system
    because the sandbox subprocess is killed after the timeout.
    """
    code = """
import os, sys
# Controlled fork: create child processes in a loop
# The timeout will kill the parent, which orphans children,
# but process.kill() sends SIGKILL to the process group.
for _ in range(100):
    try:
        pid = os.fork()
        if pid == 0:
            # Child: spin forever
            while True:
                pass
    except OSError:
        break
# Parent also spins
while True:
    pass
"""
    result = await sandbox.run(code, "python", timeout=2)
    assert result["timed_out"] is True


@pytest.mark.asyncio
async def test_sleep_longer_than_timeout(sandbox):
    """A sleep longer than timeout should trigger timed_out."""
    result = await sandbox.run("import time; time.sleep(60)", "python", timeout=1)
    assert result["timed_out"] is True
    assert "timeout" in result["stderr"].lower()


@pytest.mark.asyncio
async def test_bash_sleep_killed(sandbox):
    """Bash sleep should be killed by timeout."""
    result = await sandbox.run("sleep 60", "bash", timeout=1)
    assert result["timed_out"] is True


@pytest.mark.asyncio
async def test_output_capped_at_max_bytes(sandbox):
    """Output exceeding MAX_OUTPUT_BYTES should be truncated."""
    # Generate ~500KB of output (MAX_OUTPUT_BYTES is 256KB)
    code = "print('A' * 300_000)"
    result = await sandbox.run(code, "python", timeout=5)
    assert result["exit_code"] == 0
    # Output should be truncated (exact limit depends on MAX_OUTPUT_BYTES)
    assert len(result["stdout"]) <= 300_000


@pytest.mark.asyncio
async def test_concurrent_sandbox_runs(sandbox):
    """Multiple sandbox runs should not interfere with each other."""
    import asyncio

    async def run_code(code, lang):
        return await sandbox.run(code, lang, timeout=5)

    results = await asyncio.gather(
        run_code("print('a')", "python"),
        run_code("print('b')", "python"),
        run_code("echo c", "bash"),
    )
    assert all(r["exit_code"] == 0 for r in results)
    assert "a" in results[0]["stdout"]
    assert "b" in results[1]["stdout"]
    assert "c" in results[2]["stdout"]


@pytest.mark.asyncio
async def test_kill_running_process(sandbox):
    """The kill() method should terminate a running process."""
    import asyncio

    # Start a long-running task
    task = asyncio.create_task(
        sandbox.run("import time; time.sleep(30)", "python", timeout=30, run_id="kill-test")
    )
    # Give it a moment to start
    await asyncio.sleep(0.5)

    # Kill it
    killed = await sandbox.kill("kill-test")
    assert killed is True

    # The task should complete (with non-zero exit)
    result = await task
    assert result["exit_code"] != 0
