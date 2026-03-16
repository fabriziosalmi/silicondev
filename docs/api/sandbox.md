# Sandbox API

Prefix: `/api/sandbox`

Source: `backend/app/api/sandbox.py`

## Syntax Check

```
POST /api/sandbox/check
```

```json
{
  "code": "def foo():\n    return 42",
  "language": "python"
}
```

Validates syntax without executing. Supported languages: Python, JavaScript, TypeScript, Bash, Ruby, PHP, Perl, Swift.

Response:

```json
{
  "valid": true,
  "error": null,
  "language": "python"
}
```

## Run Code

```
POST /api/sandbox/run
```

```json
{
  "code": "print('hello')",
  "language": "python",
  "timeout": 10
}
```

Executes code in a subprocess. `timeout` is in seconds (default: 10).

Response:

```json
{
  "stdout": "hello\n",
  "stderr": "",
  "exit_code": 0,
  "timed_out": false,
  "run_id": "uuid"
}
```

Output is capped at 256KB. ANSI escape sequences are stripped.

## Kill Process

```
POST /api/sandbox/kill
```

```json
{ "run_id": "uuid" }
```

Terminates a running execution.

## Debugger

The sandbox includes a Python `bdb`-based interactive debugger. Sessions are keyed by a short `debug_id`.

### Start Session

```
POST /api/sandbox/debug/start
```

```json
{
  "code": "x = 1\ny = 2\nprint(x + y)",
  "filename": "<string>",
  "breakpoints": [2]
}
```

Response:

```json
{ "debug_id": "a1b2c3d4" }
```

### Send Command

```
POST /api/sandbox/debug/{debug_id}/command
```

```json
{ "command": "next" }
```

Valid commands: `continue`, `next`, `step`, `stop`, `eval:<expression>`.

### Stream Events

```
GET /api/sandbox/debug/{debug_id}/events
```

SSE stream. Each event is a JSON object:

```json
{ "status": "stopped", "line": 2, "locals": { "x": 1 } }
```

Terminal events have `"status": "finished"` or an `"error"` key. The session is removed from memory after either.
