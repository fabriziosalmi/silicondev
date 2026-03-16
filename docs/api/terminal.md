# Terminal API

Endpoints for the NanoCore agent terminal.

Source: `backend/app/api/terminal.py`

## `POST /api/terminal/exec`

Execute a shell command directly via PTY. Returns an SSE stream.

**Request body:**

```json
{
  "command": "ls -la",
  "timeout": 60
}
```

`timeout`: 1–300 seconds. Default 60.

**SSE events:** `tool_start`, `tool_log`, `tool_done`, `done`, `error`

## `POST /api/terminal/run`

Start a NanoCore agent session. Returns an SSE stream of events.

**Request body:**

```json
{
  "prompt": "List all Python files and count lines",
  "model_id": "mlx-community/Llama-3.2-3B-Instruct-4bit",
  "max_iterations": 10,
  "temperature": 0.3,
  "max_total_tokens": 50000,
  "mode": "edit",
  "workspace_dir": "/path/to/project",
  "enable_moa": true,
  "air_gapped_mode": false,
  "enable_python_sandbox": false,
  "active_file": {
    "path": "/path/to/file.py",
    "content": "...",
    "language": "python"
  },
  "history": [
    { "role": "user", "content": "previous message" },
    { "role": "assistant", "content": "previous reply" }
  ]
}
```

`mode`: `"edit"` (default) or `"review"`. `active_file` and `history` are optional. Up to the last 10 history turns are used.

**SSE events:**

| Event               | Description                                                    |
| ------------------- | -------------------------------------------------------------- |
| `session_start`     | Session initialized; includes `session_id` and `git_snapshot` |
| `agency_status`     | Active agent role and status                                   |
| `context_health`    | Token usage vs. context limit                                  |
| `prompt_profile`    | Intent, complexity, extracted file paths                       |
| `token_stream`      | LLM text tokens, streamed incrementally                        |
| `thinking`          | Model thinking block content                                   |
| `step_label`        | Current step description with iteration and budget progress    |
| `tool_start`        | Tool invocation begins (tool name, args, call ID)              |
| `tool_log`          | Stdout/stderr output from a running tool                       |
| `tool_done`         | Tool completed with exit code                                  |
| `diff_proposal`     | Agent proposes a file edit for user approval                   |
| `human_escalation`  | Agent is stuck and requests user input                         |
| `auto_retry`        | Self-healing: retrying a failed command                        |
| `budget_exhausted`  | Token budget reached                                           |
| `telemetry_update`  | Agent state, token count, elapsed time, iteration              |
| `agency_trace`      | Multi-agent role trace event                                   |
| `rag_search`        | Codebase RAG search results                                    |
| `scout_alert`       | Background Scout agent flagged potential issues                |
| `swarm_progress`    | MoA swarm map/reduce phase status                              |
| `file_changed`      | A file was written by the agent                                |
| `lint_result`       | Post-edit lint check result                                    |
| `plan_proposal`     | Planner session proposed a plan                                |
| `plan_status`       | Plan phase changed (executing, rejected, done)                 |
| `plan_step_start`   | A plan step began executing                                    |
| `plan_step_done`    | A plan step completed                                          |
| `error`             | Error message                                                  |
| `done`              | Session complete with total tokens, time, iterations, edits    |

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

## `POST /api/terminal/escalation/respond`

Provide user guidance for a stuck agent.

**Request body:**

```json
{
  "session_id": "abc-123",
  "escalation_id": "esc-1",
  "user_message": "Try using pip3 instead of pip"
}
```

## `POST /api/terminal/undo`

Undo the last approved file edit in a session.

**Request body:**

```json
{ "session_id": "abc-123" }
```

Returns `{ "status": "undone", "file_path": "..." }`. Sessions are available for undo for 10 minutes after they finish.

## `GET /api/terminal/checkpoints/{session_id}`

List edit checkpoints for a session. Returns `{ "checkpoints": [...] }` where each entry has `index`, `file_path`, `tool`, `timestamp`.

## `POST /api/terminal/rollback`

Roll back all edits after a given checkpoint index. `index: -1` undoes everything.

**Request body:**

```json
{ "session_id": "abc-123", "index": 2 }
```

Returns `{ "status": "rolled_back", "files": [...] }`.

## `POST /api/terminal/stop`

Stop a running agent session.

**Request body:**

```json
{ "session_id": "abc-123" }
```

## `POST /api/terminal/plan`

Start a planner/editor session. Returns an SSE stream.

**Request body:**

```json
{
  "prompt": "Refactor the authentication module",
  "model_id": "mlx-community/Llama-3.2-3B-Instruct-4bit",
  "workspace_dir": "/path/to/project",
  "temperature": 0.3,
  "max_edit_tokens": 2048
}
```

The planner generates a multi-step plan and emits a `plan_proposal` event. After the user approves via `POST /api/terminal/plan/decide`, it executes each step and emits `plan_step_start` / `plan_step_done` events.

## `POST /api/terminal/plan/decide`

Approve, modify, or reject a pending plan.

**Request body:**

```json
{
  "session_id": "abc-123",
  "approved": true,
  "modifications": null
}
```

## Dataset Engine

These endpoints expose the passive interaction log captured by NanoCore sessions for use as fine-tuning data.

### `GET /api/terminal/dataset/status`

Returns the current sample count.

```json
{ "count": 142, "ready": true, "threshold": 50, "path": "/path/to/mlx_train_ready" }
```

### `POST /api/terminal/dataset/export`

Merges all session JSONL files into a single `dataset_latest.jsonl`.

```json
{ "message": "Exported 142 samples to /path/to/dataset_latest.jsonl" }
```

### `POST /api/terminal/dataset/prepare?min_samples=50`

Prepares a training-ready directory (with `train.jsonl` / `valid.jsonl`). Returns 422 if sample count is below `min_samples`.

```json
{
  "ready": true,
  "count": 142,
  "path": "/path/to/mlx_train_ready",
  "command": "python -m mlx_lm.tuner.train --data /path/to/mlx_train_ready ..."
}
```
