# Code Workspace

Source: `src/renderer/src/components/CodeWorkspace/CodeWorkspace.tsx`

## Overview

The Code Workspace provides an in-app code editor with an AI agent panel. It lets you open a project directory, browse files, edit code with syntax highlighting, and use an AI agent to make changes.

## Features

- **File Tree**: Browse and open files from a selected project directory
- **Monaco Editor**: Full-featured code editor with syntax highlighting, line numbers, and language detection
- **Diff Viewer**: Review AI-generated changes as side-by-side diffs before accepting or rejecting them
- **Agent Panel**: Chat with the AI agent to request code edits — the agent reads files, proposes changes, and applies accepted diffs
- **File Management**: Create new files, save with `Cmd+S`, and track unsaved changes
- **Live Preview**: Start a dev server and preview web projects directly below the editor

## Usage

1. Click **Select Directory** to open a project folder
2. Browse the file tree on the left and click files to open them in tabs
3. Edit files directly in the Monaco editor
4. Open the Agent Panel on the right to ask the AI to modify code
5. Review proposed diffs and accept or reject each change
6. Toggle Live Preview to see web output in real time

## Agent Panel

The agent uses the loaded model to:
- Read file contents from the workspace
- Generate code modifications based on your instructions
- Present changes as visual diffs for review
- Delegate focused tasks to subagent workers

The agent requires a model to be loaded. It runs through the NanoCore `SupervisorAgent` and `PlannerEditor` — the same infrastructure exposed by the `/api/terminal` backend endpoints.

### NanoCore Features

- **Diff proposals**: File edits are shown as diffs; you approve or reject before the file is written
- **Undo / Rollback**: Undo the last edit, or roll back to any checkpoint in the edit history
- **Self-healing**: Up to 3 automatic retries on tool failures before escalating to you
- **Human escalation**: When the agent is stuck, it pauses and asks for guidance
- **Mixture of Agents (MoA)**: Parallel Security, Performance, and Syntax expert sub-agents
- **Air-gapped mode**: Blocks outbound network calls in tool executions
- **Python sandbox**: Isolated subprocess for script execution
- **Context health**: Token budget and context usage indicator
- **Scout Agent**: Background monitor flags high-activity files as refactoring candidates
- **Planner mode**: Generate a multi-step plan and approve it before execution begins

### Subagent Workers

The agent can delegate focused tasks to independent workers via the `spawn_worker` tool. Each worker has its own context window and a restricted set of tools appropriate for its role:

| Role | Tools | Output |
|------|-------|--------|
| `code_reviewer` | `read_file` only | Structured review with findings |
| `test_writer` | `read_file`, `run_bash` | Test file paths |
| `docs_generator` | `read_file` | Docstrings and markdown |
| `bug_fixer` | `read_file`, `edit_file`, `patch_file`, `run_bash` | Targeted diff |

Workers can run in parallel (`spawn_parallel`) or as a sequential pipeline where each worker's output feeds into the next.

### Model Routing

When model routing is enabled (via `~/.silicon-studio/routing.json`), the supervisor assigns different models to different phases:

- **Planning** → planner model (larger, better at reasoning)
- **Coding / tool use** → coder model (faster, code-specialized)
- **Review / inspection** → reviewer model
- **Default** → falls back to the active model

Up to 2 models are cached in RAM for near-instant switching. On machines with limited RAM, routing degrades silently to single-model mode.

## Live Preview

The Code Workspace includes a live preview panel for web projects. Click the preview toggle button in the toolbar (or press `Cmd+Shift+P`) to start.

### How it works

1. **Project detection**: Scans the workspace for `package.json`, `pyproject.toml`, or `index.html` to determine the framework and start command.
2. **Server start**: Spawns the dev server on a free port (3100-3199) and waits for it to become reachable.
3. **Preview rendering**: Shows the output in an iframe below the editor. Vite/Next.js projects get HMR automatically.
4. **Resize**: Drag the handle between editor and preview to adjust height (150-600px, persisted to localStorage).

### Supported project types

| Framework | Detection | Start command |
|-----------|-----------|---------------|
| Vite | `vite` in devDependencies | `npm run dev` |
| Next.js | `next` in dependencies | `npm run dev` |
| Create React App | `react-scripts` in dependencies | `npm start` |
| Nuxt | `nuxt` in dependencies | `npm run dev` |
| Svelte/SvelteKit | `svelte` in devDependencies | `npm run dev` |
| Astro | `astro` in dependencies | `npm run dev` |
| Flask | `flask` in requirements.txt | `flask run` |
| FastAPI | `fastapi` in requirements.txt | `uvicorn main:app` |
| Static HTML | `index.html` at root | `python -m http.server` |

Package manager is auto-detected: npm, pnpm, yarn, or bun.

## Backend API

The Code Workspace frontend communicates with these backend routers:

| Prefix | Purpose |
|--------|---------|
| `/api/workspace` | File tree (`POST /tree`), read (`POST /read`), save (`POST /save`), create (`POST /create`), rename (`POST /rename`), delete (`POST /delete`), git info (`POST /git-info`) |
| `/api/terminal` | NanoCore agent SSE stream for agent panel |
| `/api/preview` | Live preview server management (`POST /start`, `POST /stop`, `GET /status`, `GET /detect`, `GET /logs`) |

All file operations enforce path containment — paths outside the selected workspace root are rejected. macOS system paths are also blocked.

## Authentication

All backend requests include the `Authorization: Bearer <token>` header when `SILICON_AUTH_TOKEN` is set. The agent SSE stream uses `fetch` (not `EventSource`), so it can include the authorization header directly rather than needing a `?token=` query parameter.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+S` | Save active file |
| `Cmd+Shift+P` | Toggle live preview |
