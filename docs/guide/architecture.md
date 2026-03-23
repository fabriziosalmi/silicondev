# Architecture

## Overview

SiliconDev is a desktop application with two processes:

```
Electron Main Process
    |
    +-- Renderer (React app, Vite, TailwindCSS)
    |       |
    |       +-- HTTP requests to localhost:8000
    |
    +-- Backend (FastAPI, spawned as subprocess)
            |
            +-- MLX engine (model loading, inference, fine-tuning)
            +-- Services (RAG, agents, NanoCore/terminal, conversations, notes, MCP, sandbox)
            +-- File storage (~/.silicon-studio/)
```

The frontend communicates with the backend exclusively via REST API over `localhost`. The backend binds to port 8000 by default; if that port is busy it scans 8001–8099 and signals the chosen port to Electron via stdout (`SILICON_PORT=<port>`). The frontend resolves `API_BASE` dynamically at startup from this signal. Electron IPC is used only for native OS features (file dialogs, window controls, auth token retrieval).

## Frontend

| Layer      | Technology           | Location                         |
| ---------- | -------------------- | -------------------------------- |
| Shell      | Electron 35          | `src/main/main.ts`               |
| UI         | React 19, TypeScript | `src/renderer/src/`              |
| Build      | Vite                 | `src/renderer/vite.config.ts`    |
| Styling    | TailwindCSS          | `src/renderer/src/index.css`     |
| State      | React Context        | `src/renderer/src/context/`      |
| API Client | Fetch wrapper        | `src/renderer/src/api/client.ts` |

### State Management

Three context providers wrap the app:

- **GlobalStateProvider** — backend status, system stats, active model, training state. Polls every 5 seconds.
- **ConversationProvider** — conversation list, active selection, search, CRUD operations.
- **NotesProvider** — note list, active selection, CRUD operations.

### Component Layout

```
App.tsx
  +-- TopBar (model switcher, system stats)
  +-- Left Sidebar (navigation, conversation/note lists)
  +-- Content Area (renders active tab component)
  +-- Right Sidebar (chat parameters, collapsed by default)
```

The left sidebar is always visible. The right sidebar (parameters) only appears on the Chat tab and is collapsed by default.

## Backend

| Layer     | Technology         | Location                   |
| --------- | ------------------ | -------------------------- |
| Server    | FastAPI, Uvicorn   | `backend/main.py`          |
| ML Engine | MLX, MLX-LM        | `backend/app/engine/`      |
| Data      | Pandas, JSON files | `backend/app/preparation/` |
| Privacy   | Presidio           | `backend/app/shield/`      |
| MCP       | MCP Python SDK     | `backend/app/mcp/`         |
| Sandbox   | subprocess         | `backend/app/sandbox/`     |

### API Router Registration

All routers are registered in `backend/main.py`:

| Prefix               | Router             | Purpose                           |
| -------------------- | ------------------ | --------------------------------- |
| `/api/monitor`       | `monitor.py`       | System stats                      |
| `/api/preparation`   | `preparation.py`   | CSV/JSONL conversion              |
| `/api/engine`        | `engine.py`        | Models, fine-tuning, chat         |
| `/api/deployment`    | `deployment.py`    | Model server                      |
| `/api/rag`           | `rag.py`           | Knowledge base                    |
| `/api/agents`        | `agents.py`        | Workflow execution                |
| `/api/conversations` | `conversations.py` | Chat history                      |
| `/api/sandbox`       | `sandbox.py`       | Code execution                    |
| `/api/notes`         | `notes.py`         | Note storage                      |
| `/api/search`        | `search.py`        | Web search                        |
| `/api/mcp`           | `mcp.py`           | MCP servers and tools             |
| `/api/indexer`       | `indexer.py`       | Codebase vector index             |
| `/api/terminal`      | `terminal.py`      | Agent terminal and bash execution |
| `/api/codebase`      | [Codebase](/api/codebase) | Codebase search queries           |
| `/api/workspace`     | `workspace.py`     | File tree, read, save, git info   |
| `/api/memory`        | `memory.py`        | Knowledge graph nodes and edges   |
| `/api/training`      | `training.py`      | Fine-tuning orchestrator          |
| `/api/preview`       | `preview.py`       | Live preview server management    |

### Model Lifecycle

```
Download (HuggingFace) -> Register in models.json -> Load into MLX memory -> Chat/Fine-tune -> Unload
```

With model routing enabled (`~/.silicon-studio/routing.json`), up to 2 models can be cached in RAM simultaneously. The engine swaps between them based on the agent's current phase (planning, coding, reviewing). On machines with limited RAM, this degrades to single-model mode transparently.

### Agent Architecture

```
Prelayer (intent + complexity + file extraction)
    |
    v
SupervisorAgent (main agent loop)
    |
    +-- Tools: read_file, edit_file, patch_file, run_bash, spawn_worker
    |
    +-- MapReduceSwarm (3 parallel experts: security, performance, syntax)
    |
    +-- PlannerEditor (2-phase plan + execute)
    |
    +-- SubagentOrchestrator
    |       |
    |       +-- SubagentWorker (code_reviewer, test_writer, docs_generator, bug_fixer)
    |
    +-- DatasetEngine (SFT + DPO pair logging)
    |
    +-- KnowledgeGraph (SQLite fact/edge store)
    |
    +-- ModelRouter (role -> model_id resolution)
```

The Prelayer classifies each user prompt before the supervisor runs, determining intent, complexity, relevant files, and suggested model role. The supervisor then executes the agent loop, optionally delegating to the Swarm (parallel review), Planner (multi-step edits), or Subagent Workers (focused tasks).

### Inference Engine

```
generate_stream(model_id, messages)
    |
    +-- Prefix cache: token-by-token matching with dynamic trimming
    +-- KV quantization: 4-bit or 8-bit (optional)
    +-- Disk KV cache: cross-session prefix reuse (~/.silicon-studio/cache/kv/)
    +-- Speculative decoding: draft model for faster generation (optional)
    +-- Smart GC: conditional gc.collect() + mx.metal.clear_cache()
    +-- Multi-model LRU cache: up to 2 models for fast role switching
```

### Data Flow: Chat

```
User types message
  -> Frontend sends POST /api/engine/chat (SSE stream)
  -> Backend checks RAG (if enabled): queries collection, injects top chunks
  -> Backend checks Web Search (if enabled): fetches results, injects snippets
  -> Backend builds message array with system prompt + context + history
  -> MLX generates tokens, streamed back via SSE
  -> Frontend renders tokens incrementally
  -> On complete: syntax check (if enabled), save to conversation
```

### Data Flow: Fine-Tuning

```
User configures job (model, dataset, hyperparameters)
  -> POST /api/engine/finetune starts background thread
  -> Backend runs mlx_lm.lora() with config
  -> Frontend polls GET /api/engine/jobs/{id} every 2 seconds
  -> Loss/metrics streamed back in job status
  -> On complete: adapter saved to ~/.silicon-studio/adapters/
```
