# Terminal API

Endpoints for the NanoCore agent terminal.

## `POST /api/terminal/exec`

Execute a shell command directly. Returns an SSE stream.

**Request body:**

```json
{
  "command": "ls -la",
  "timeout": 60
}
```

**SSE events:** `tool_start`, `tool_log`, `tool_done`, `done`, `error`

## `POST /api/terminal/run`

Start a NanoCore agent session. Returns an SSE stream of events.

**Request body:**

```json
{
  "prompt": "List all Python files and count lines",
  "model_id": "mlx-community/Llama-3.2-3B-Instruct-4bit",
  "max_iterations": 10,
  "temperature": 0.7
}
```

**SSE events:** `session_start`, `token_stream`, `tool_start`, `tool_log`, `tool_done`, `diff_proposal`, `telemetry_update`, `done`, `error`

## `POST /api/terminal/diff/decide`

Approve or reject a pending diff proposal.

**Request body:**

```json
{
  "session_id": "abc-123",
  "call_id": "c2",
  "approved": true,
  "reason": ""
}
```

## `POST /api/terminal/stop`

Stop a running agent session.

**Request body:**

```json
{
  "session_id": "abc-123"
}
```
