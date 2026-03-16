# Terminal

Source: `src/renderer/src/components/Terminal/AgentTerminal.tsx`

## Overview

Direct bash terminal. Commands are executed via a PTY subprocess on the backend and streamed back in real time via SSE. No model required.

The NanoCore agent (LLM-driven editing loop with diff proposals, self-healing, and multi-agent support) is in the Code Workspace, not the Terminal page. See [Code Workspace](/features/code-workspace).

## Bash Execution

- Output streams in real-time via SSE
- Blocked commands: `rm -rf /`, `sudo`, `mkfs`, and other destructive patterns
- Protected paths: `/System`, `/usr`, `/bin`, `/sbin`, `/etc`, `/Library`, `/Applications`, and others
- Output capped at 10 KB per command
- Default timeout: 60 seconds (configurable up to 300 s via `timeout` field)
- Sub-shell execution (`$()`, backticks) is blocked for safety
- Destructive commands (`rm`, `mv`, `chmod`, etc.) emit a warning before running

## SSE Event Protocol

The terminal exec stream emits:

| Event       | Description                                               |
| ----------- | --------------------------------------------------------- |
| `tool_start` | Command begins; includes tool name, args, and call ID    |
| `tool_log`  | Stdout output from the running command                    |
| `tool_done` | Command completed with exit code                          |
| `done`      | Stream finished; includes total elapsed time              |
| `error`     | Error message                                             |

## Feed

The feed displays a chronological list of items:

| Type          | Rendering                        |
| ------------- | -------------------------------- |
| `user`        | User input                       |
| `tool_start`  | Command header                   |
| `tool_output` | Collapsible terminal output      |
| `info`        | Status messages                  |
| `error`       | Error messages                   |

Feed state is persisted to `sessionStorage` (up to 200 items).

## Components

| File                  | Purpose                                |
| --------------------- | -------------------------------------- |
| `AgentTerminal.tsx`   | Main container, SSE consumer           |
| `InputBar.tsx`        | Command input                          |
| `MessageFeed.tsx`     | Scrollable feed renderer               |
| `StreamingMarkdown.tsx` | Markdown renderer for tool output    |

## API

| Endpoint              | Method | Description                      |
| --------------------- | ------ | -------------------------------- |
| `/api/terminal/exec`  | POST   | Execute bash command (PTY + SSE) |

See [Terminal API](/api/terminal) for full endpoint details including NanoCore agent endpoints.
