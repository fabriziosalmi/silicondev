"""Background process manager for NanoCore.

Spawns, monitors, and cleans up background processes so the agent
can run dev servers, watchers, etc. without blocking the main loop.
"""

import asyncio
import logging
import os
import signal
from collections import deque
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Max lines kept in each process output ring buffer
MAX_OUTPUT_LINES = 500
# Grace period before SIGKILL after SIGTERM
KILL_GRACE_SECS = 5


@dataclass
class ManagedProcess:
    proc_id: str
    command: str
    process: asyncio.subprocess.Process
    pgid: int
    output: deque = field(default_factory=lambda: deque(maxlen=MAX_OUTPUT_LINES))
    reader_task: asyncio.Task | None = None
    finished: bool = False


class ProcessManager:
    """Manage background subprocesses for the agent."""

    def __init__(self):
        self._processes: dict[str, ManagedProcess] = {}
        self._counter = 0

    async def spawn(self, command: str) -> tuple[str, ManagedProcess]:
        """Spawn a background process. Returns (proc_id, ManagedProcess).

        Uses os.setsid() so we can kill the entire process group later.
        """
        self._counter += 1
        proc_id = f"bg-{self._counter}"

        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            preexec_fn=os.setsid,
        )

        try:
            pgid = os.getpgid(proc.pid)
        except OSError:
            pgid = proc.pid

        mp = ManagedProcess(
            proc_id=proc_id,
            command=command,
            process=proc,
            pgid=pgid,
        )

        # Start background reader
        mp.reader_task = asyncio.create_task(self._background_reader(mp))
        self._processes[proc_id] = mp

        logger.info(f"Spawned background process {proc_id}: {command} (pid={proc.pid})")
        return proc_id, mp

    async def _background_reader(self, mp: ManagedProcess) -> None:
        """Read stdout lines into the ring buffer until the process exits."""
        try:
            while mp.process.stdout and not mp.process.stdout.at_eof():
                line = await mp.process.stdout.readline()
                if not line:
                    break
                mp.output.append(line.decode(errors="replace").rstrip("\n"))
        except Exception as e:
            mp.output.append(f"[reader error: {e}]")
        finally:
            mp.finished = True

    def read_output(self, proc_id: str, last_n: int = 50) -> list[str]:
        """Read the last N lines of output from a background process."""
        mp = self._processes.get(proc_id)
        if not mp:
            return [f"Process {proc_id} not found"]
        lines = list(mp.output)
        return lines[-last_n:]

    def list_processes(self) -> list[dict]:
        """List all tracked background processes."""
        result = []
        for pid, mp in self._processes.items():
            alive = mp.process.returncode is None and not mp.finished
            result.append({
                "proc_id": pid,
                "command": mp.command,
                "pid": mp.process.pid,
                "alive": alive,
                "output_lines": len(mp.output),
            })
        return result

    async def kill(self, proc_id: str) -> str:
        """Kill a background process by proc_id. Returns status message."""
        mp = self._processes.get(proc_id)
        if not mp:
            return f"Process {proc_id} not found"

        if mp.process.returncode is not None:
            self._processes.pop(proc_id, None)
            return f"Process {proc_id} already exited (code {mp.process.returncode})"

        # SIGTERM the process group
        try:
            os.killpg(mp.pgid, signal.SIGTERM)
        except OSError:
            try:
                mp.process.terminate()
            except ProcessLookupError:
                pass

        # Wait for graceful exit
        try:
            await asyncio.wait_for(mp.process.wait(), timeout=KILL_GRACE_SECS)
        except asyncio.TimeoutError:
            # Force kill
            try:
                os.killpg(mp.pgid, signal.SIGKILL)
            except OSError:
                try:
                    mp.process.kill()
                except ProcessLookupError:
                    pass

        # Cancel reader task
        if mp.reader_task and not mp.reader_task.done():
            mp.reader_task.cancel()
            try:
                await mp.reader_task
            except (asyncio.CancelledError, Exception):
                pass

        self._processes.pop(proc_id, None)
        return f"Process {proc_id} killed"

    async def cleanup_all(self) -> list[str]:
        """Kill all tracked background processes. Returns status messages."""
        results = []
        for proc_id in list(self._processes.keys()):
            msg = await self.kill(proc_id)
            results.append(msg)
        return results
