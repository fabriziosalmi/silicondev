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
  main/          Electron main process (main.ts, preload.ts)
  renderer/
    src/
      api/       API client (client.ts — all backend calls)
      components/ React components (one file per tab/feature)
      context/   Global state (GlobalState.tsx)
backend/
  app/
    api/         FastAPI route handlers
    engine/      MLX model loading, inference, fine-tuning
    preparation/ Dataset conversion, PII redaction
    rag/         Document collections, chunk retrieval
    agents/      Agent workflows, NanoCore supervisor
    mcp/         MCP server management
  tests/         Pytest tests
```

## Setup

```bash
make setup   # creates venv, installs Python + JS deps
make run     # starts backend + frontend
make test    # runs pytest
```

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
