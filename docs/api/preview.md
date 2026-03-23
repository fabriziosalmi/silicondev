# Preview API

Source: `backend/app/api/preview.py`

Live preview server management for web projects in the Code Workspace.

## Endpoints

### Detect Project Type

```
GET /api/preview/detect?workspace_dir=/path/to/project
```

Scans the workspace directory and returns the detected project type and start command.

**Response:**

```json
{
  "project_type": "vite",
  "command": "npm run dev",
  "package_manager": "npm",
  "detected_from": "package.json devDependencies"
}
```

Possible `project_type` values: `vite`, `nextjs`, `cra`, `nuxt`, `svelte`, `astro`, `flask`, `fastapi`, `static`, `unknown`.

### Start Preview Server

```
POST /api/preview/start
```

**Body:**

```json
{
  "workspace_dir": "/path/to/project",
  "command": "npm run dev"
}
```

If `command` is omitted, the server auto-detects the project type and chooses the appropriate start command. Picks a free port in the 3100-3199 range.

**Response:**

```json
{
  "status": "started",
  "port": 3142,
  "pid": 12345,
  "project_type": "vite"
}
```

### Stop Preview Server

```
POST /api/preview/stop
```

Stops the running preview server process.

**Response:**

```json
{
  "status": "stopped"
}
```

### Server Status

```
GET /api/preview/status
```

Returns whether a preview server is running.

**Response:**

```json
{
  "running": true,
  "port": 3142,
  "pid": 12345,
  "project_type": "vite",
  "uptime_seconds": 45.2
}
```

### Server Logs

```
GET /api/preview/logs
```

Returns recent stdout/stderr output from the preview server process.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `lines` | int | 50 | Maximum number of log lines to return |

**Response:**

```json
{
  "logs": [
    {"timestamp": "2026-03-23T14:30:00", "line": "VITE v6.2.0 ready in 312 ms"},
    {"timestamp": "2026-03-23T14:30:00", "line": "Local: http://localhost:3142/"}
  ]
}
```

## Notes

- Only one preview server runs at a time. Starting a new one stops the previous.
- The preview server process is killed when the workspace changes or the app closes.
- Port selection avoids conflicts with the backend (8000+) and Electron dev server (5173).
- Server logs use a ring buffer (last 500 lines).
