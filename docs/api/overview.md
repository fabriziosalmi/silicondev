# API Overview

The backend exposes a REST API on `http://127.0.0.1:8000`. All endpoints accept and return JSON unless noted otherwise.

## Base URL

```
http://127.0.0.1:8000
```

The backend binds to `127.0.0.1` only. On startup it scans ports 8000–8099 for the first free port and signals the chosen port to the Electron process via stdout (`SILICON_PORT=<port>`). The frontend resolves `API_BASE` dynamically from that signal.

## Health Check

```
GET /health
```

Returns `{"status": "ok", "service": "silicondev-engine"}` when the backend is running. The frontend polls this on startup.

## Authentication

When the `SILICON_AUTH_TOKEN` environment variable is set, the middleware requires a valid token on every non-public endpoint.

- REST requests: `Authorization: Bearer <token>` header
- SSE/EventSource requests (cannot set headers): `?token=<token>` query parameter

Public paths exempt from auth: `/health`, `/docs`, `/openapi.json`.

If `SILICON_AUTH_TOKEN` is not set (standalone/dev mode), auth is skipped.

## Router Map

| Prefix               | Module                              | Description                              |
| -------------------- | ----------------------------------- | ---------------------------------------- |
| `/api/monitor`       | [Monitor](/api/monitor)             | System stats (RAM, CPU, disk)            |
| `/api/engine`        | [Engine](/api/engine)               | Models, fine-tuning, chat, export        |
| `/api/rag`           | [RAG](/api/rag)                     | Knowledge base collections and queries   |
| `/api/conversations` | [Conversations](/api/conversations) | Chat history CRUD                        |
| `/api/notes`         | [Notes](/api/notes)                 | Note storage                             |
| `/api/agents`        | [Agents](/api/agents)               | Workflow definitions and execution       |
| `/api/preparation`   | [Preparation](/api/preparation)     | Data conversion and generation           |
| `/api/mcp`           | [MCP](/api/mcp)                     | MCP server management and tool execution |
| `/api/deployment`    | [Deployment](/api/deployment)       | Model server lifecycle                   |
| `/api/sandbox`       | [Sandbox](/api/sandbox)             | Code execution                           |
| `/api/search`        | [Search](/api/search)               | Web search                               |
| `/api/terminal`      | [Terminal](/api/terminal)           | Agent terminal and bash execution        |
| `/api/indexer`       | [Indexer](/api/indexer)             | Codebase vector index                    |
| `/api/codebase`      | `codebase.py`                       | Codebase search queries                  |
| `/api/workspace`     | `workspace.py`                      | File tree, read, save, git info          |
| `/api/memory`        | `memory.py`                         | Knowledge graph nodes and edges          |
| `/api/training`      | `training.py`                       | Fine-tuning orchestrator                 |

## CORS

The backend allows requests from:
- `http://localhost:5173` (Vite dev server)
- `http://127.0.0.1:5173`
- `app://.` (Electron)

## Error Format

HTTP errors return:

```json
{ "detail": "Error message here" }
```

Pydantic validation errors (422) return an expanded form:

```json
{
  "detail": "Validation error",
  "errors": ["field_name: error description", ...]
}
```

Status codes used: 400 (bad request), 403 (unauthorized), 404 (not found), 409 (conflict), 422 (validation), 500 (server error).

## Streaming

The chat endpoint (`POST /api/engine/chat`) returns Server-Sent Events (SSE). Each event is a JSON object on a `data:` line:

```
data: {"text": "Hello", "done": false}
data: {"text": " world", "done": false}
data: {"text": "", "done": true}
```

A `warning` field may appear on non-done events (e.g. high memory pressure, image sent to text-only model).

## Frontend Client

The API client is in `src/renderer/src/api/client.ts`. It wraps all endpoints in a namespaced object:

```typescript
apiClient.engine.getModels()
apiClient.rag.query(collectionId, query)
apiClient.mcp.listTools(serverId)
// etc.
```
