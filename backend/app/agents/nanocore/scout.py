"""Scout Agent — background task for ongoing codebase health monitoring."""

import asyncio
import logging
import time
from pathlib import Path
from typing import List, Dict, Any

from .tools import check_broken_imports
from .validators import run_lint_check, scan_security

logger = logging.getLogger(__name__)

class ScoutAgent:
    """Background agent that periodically scans the workspace for issues."""
    
    def __init__(self, workspace_dir: str = None):
        self.workspace_dir = Path(workspace_dir or ".").resolve()
        self.active = False
        self._task = None
        self._last_scan = 0
        self._interval = 60  # seconds between background scans
        self._results = []

    async def start(self, emitter):
        """Start the background scout task."""
        if self.active:
            return
        self.active = True
        self._task = asyncio.create_task(self._run_loop(emitter))
        logger.info(f"Scout Agent started for {self.workspace_dir}")

    async def stop(self):
        """Stop the background scout task."""
        self.active = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Scout Agent stopped")

    async def _run_loop(self, emitter):
        """Periodic scan loop."""
        while self.active:
            try:
                # 1. Wait for interval (start with a delay so we don't spike on session start)
                await asyncio.sleep(self._interval)
                if not self.active: break

                logger.info("Scout Agent performing background scan...")
                start_time = time.time()
                
                # 2. Efficient file discovery (prefer git if target is a repo)
                all_files = []
                try:
                    proc = await asyncio.create_subprocess_exec(
                        "git", "ls-files", cwd=str(self.workspace_dir),
                        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
                    )
                    stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
                    if proc.returncode == 0:
                        all_files = [self.workspace_dir / f for f in stdout.decode().splitlines() if f.endswith(".py")]
                except Exception:
                    pass

                if not all_files:
                    # Fallback to limited glob if not a git repo
                    def _discover_files():
                        try:
                            return list(self.workspace_dir.glob("*.py")) + list((self.workspace_dir / "app").glob("**/*.py"))
                        except Exception:
                            return []
                    all_files = await asyncio.to_thread(_discover_files)
                
                # 3. Sample files to avoid CPU bomb (max 20 files per scan)
                if all_files:
                    import random
                    target_files = random.sample(all_files, min(len(all_files), 20))
                else:
                    target_files = []
                
                issues = []
                for fpath in target_files:
                    if not fpath.exists(): continue
                    # Broken imports / Syntax check
                    err = await check_broken_imports(str(fpath))
                    if err:
                        issues.append({
                            "file": str(fpath.relative_to(self.workspace_dir)),
                            "type": "error",
                            "message": err
                        })
                
                # 4. Emit alerts if issues found
                if issues:
                    logger.info(f"Scout found {len(issues)} issues")
                    await emitter({
                        "event": "scout_alert",
                        "data": {
                            "timestamp": time.time(),
                            "issues": issues
                        }
                    })
                
                self._last_scan = time.time()
                logger.debug(f"Scout scan complete in {self._last_scan - start_time:.1f}s")
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Scout Agent loop error: {e}")
                await asyncio.sleep(60)
