# Contributing to SiliconDev

Thanks for your interest. This guide covers what you need to get started.

## Architecture

SiliconDev is a desktop app with three layers:

1. **Electron shell** (`src/main/`) — spawns the backend, manages windows, IPC
2. **React frontend** (`src/renderer/`) — TypeScript, Vite, TailwindCSS
3. **FastAPI backend** (`backend/`) — Python, MLX, all model/data operations

The frontend talks to the backend over HTTP (`localhost:<port>`). The backend runs as a child process of Electron.

## Directory Map

```
src/
  main/            Electron main process (main.ts, preload.ts)
  renderer/
    src/
      api/         API client (client.ts — all backend calls)
      components/  React components (one file per tab/feature)
      context/     Global state (GlobalState.tsx)
      hooks/       Custom React hooks
backend/
  app/
    api/           FastAPI route handlers
    engine/        MLX model loading, inference, training orchestrator
    agents/        NanoCore supervisor, scout agent, planner
    memory/        Knowledge graph (SQLite), fact extractor
    preparation/   Dataset conversion, PII redaction
    rag/           Document collections, chunk retrieval
    mcp/           MCP server management
    conversations/ Conversation persistence
    monitor/       System stats (CPU, RAM, GPU)
    search/        Full-text and semantic search
    sandbox/       Isolated script execution
    codebase/      Workspace file operations
    notes/         Markdown notes storage
  tests/           Pytest tests
```

## Setup

```bash
make setup   # creates venv, installs Python + JS deps
make hooks   # installs local pre-commit hook (.githooks/pre-commit)
make run     # starts backend + frontend
make test    # runs dependency sync check + warning-clean pytest
make version-show
make version-bump-patch  # bugfix
make version-bump-minor  # new backward-compatible feature
make version-bump-major  # breaking change
```

The pre-commit hook blocks commits when:
- version is not synchronized across project files
- `backend/pyproject.toml` and `backend/constraints.txt` are out of sync
- backend tests fail
- backend tests emit warnings (warnings must be fixed or explicitly filtered)

See [VERSIONING.md](VERSIONING.md) for the semantic versioning policy and release flow.

## How to Add a New Tab

Each tab is a standalone React component rendered in `src/renderer/src/App.tsx`:

1. Create your component in `src/renderer/src/components/YourFeature.tsx`
2. Import it in `App.tsx`
3. Add a sidebar nav item (follow the existing pattern with `NavItem`)
4. Add `{activeTab === 'your-feature' && <YourFeature />}` in the main content area

## Code Style

- **Frontend**: TypeScript, TailwindCSS utility classes, no CSS files. Format with default Prettier settings.
- **Backend**: Python 3.10+, type hints. Format with Black (`black .`), sort imports with isort.

## Submitting a PR

1. Fork the repo, create a branch from `main`
2. Make your changes
3. Run `make test` and fix any failures
4. Open a PR with a clear description of what changed and why
5. Include a test plan (how to verify the change works)

## Reporting Issues

Use the GitHub issue templates. Include your macOS version, chip (M1/M2/M3/M4), RAM, and app version.
