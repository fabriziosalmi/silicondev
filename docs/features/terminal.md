# Agent Terminal

The Terminal page provides a dual-mode interface for interacting with your system and AI models directly.

## Modes

### Terminal Mode

Direct shell execution. Type commands and see streaming output, just like a native terminal. Commands run in a sandboxed PTY with safety checks (blocked destructive patterns, protected system paths, output size limits).

### Agent Mode

NanoCore agent-assisted coding. Describe what you want in natural language and the agent will:

1. Reason about the task
2. Execute shell commands as needed
3. Propose file edits as unified diffs
4. Wait for your approval before writing any changes

All tool calls stream back in real time via SSE.

## Diff Proposals

When the agent wants to edit a file, it generates a diff proposal showing the exact changes. You can approve or reject each proposal individually. The agent only writes to disk after explicit human approval.

## Safety

- Blocked patterns: `rm -rf /`, `sudo`, `mkfs`, and other destructive commands
- Protected paths: `/System`, `/usr`, `/bin`, `/etc` are off-limits
- Output capped at 10KB per command to prevent runaway processes
- 60-second default timeout per command

## Requirements

A model must be loaded before using Agent mode. Terminal mode works without a loaded model.
