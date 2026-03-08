import sys
import bdb
import threading
import queue
import traceback
import os
import json
import logging
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)

class DebuggerService(bdb.Bdb):
    def __init__(self):
        super().__init__()
        self.cmd_queue = queue.Queue()
        self.state_queue = queue.Queue()
        self.breakpoints = set()
        self._stop = False
        self.current_frame = None
        self.last_state = None

    def user_line(self, frame):
        """Called when the debugger stops at a line."""
        if self._stop:
            raise bdb.BdbQuit()

        # Check if we should stop here
        filename = self.canonic(frame.f_code.co_filename)
        # Only stop in user code (not libraries)
        if not filename.startswith(os.getcwd()) and not filename.startswith('/tmp/'):
             return

        self.current_frame = frame
        self._report_state(frame)
        self._wait_for_command()

    def _report_state(self, frame):
        state = {
            "line": frame.f_lineno,
            "filename": frame.f_code.co_filename,
            "locals": {k: str(v) for k, v in frame.f_locals.items() if not k.startswith('__')},
            "globals": {k: str(v) for k, v in frame.f_globals.items() if not k.startswith('__')},
            "stack": self._get_stack(frame)
        }
        self.last_state = state
        self.state_queue.put(state)

    def _get_stack(self, frame):
        stack = []
        curr = frame
        while curr:
            stack.append({
                "function": curr.f_code.co_name,
                "line": curr.f_lineno,
                "filename": curr.f_code.co_filename
            })
            curr = curr.f_back
        return stack

    def _wait_for_command(self):
        while True:
            cmd = self.cmd_queue.get()
            if cmd == "continue":
                self.set_continue()
                break
            elif cmd == "next":
                self.set_next(self.current_frame)
                break
            elif cmd == "step":
                self.set_step()
                break
            elif cmd == "stop":
                self._stop = True
                self.set_quit()
                raise bdb.BdbQuit()
            elif cmd.startswith("eval:"):
                expr = cmd[5:]
                try:
                    # Compile first to catch syntax errors; restrict to expressions only
                    code = compile(expr, "<debugger>", "eval")
                    # Block dangerous builtins while allowing inspection
                    safe_builtins = {
                        k: v for k, v in __builtins__.items()
                        if k not in (
                            "exec", "eval", "compile", "__import__",
                            "open", "input", "breakpoint", "exit", "quit",
                        )
                    } if isinstance(__builtins__, dict) else {
                        k: getattr(__builtins__, k)
                        for k in dir(__builtins__)
                        if k not in (
                            "exec", "eval", "compile", "__import__",
                            "open", "input", "breakpoint", "exit", "quit",
                        ) and not k.startswith("_")
                    }
                    safe_globals = {**self.current_frame.f_globals, "__builtins__": safe_builtins}
                    res = eval(code, safe_globals, self.current_frame.f_locals)
                    self.state_queue.put({"eval_result": str(res)})
                except Exception as e:
                    self.state_queue.put({"eval_error": str(e)})
                # Continue waiting for Next/Step/Cont
            else:
                logger.warning(f"Unknown debugger command: {cmd}")

    def run_code(self, code: str, filename: str = "<string>"):
        self._stop = False
        try:
            self.run(code, filename=filename)
        except bdb.BdbQuit:
            pass
        except Exception as e:
            self.state_queue.put({"error": traceback.format_exc()})
        finally:
            self.state_queue.put({"status": "finished"})

def start_debugger_session(code: str, filename: str):
    dbg = DebuggerService()
    # We run in a separate thread so the API remains responsive
    thread = threading.Thread(target=dbg.run_code, args=(code, filename), daemon=True)
    thread.start()
    return dbg
