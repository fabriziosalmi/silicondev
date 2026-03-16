# Getting Started

## Requirements

- macOS 13 (Ventura) or later
- Apple Silicon Mac (M1, M2, M3, or M4)
- Node.js 18+
- Python 3.10+

## Install from Source

```bash
git clone https://github.com/fabriziosalmi/silicondev.git
cd silicondev

# Frontend dependencies
npm install

# Backend dependencies
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -c constraints.txt -e ".[dev]"
cd ..
```

## Run in Development Mode

```bash
npm run dev
```

This starts both the Vite dev server (port 5173) and the Electron shell. The backend FastAPI server starts automatically, binding to `127.0.0.1`. It tries port 8000 first and scans up to 8099 if 8000 is busy. The chosen port is signalled to Electron via stdout (`SILICON_PORT=<port>`).

## Build for Distribution

```bash
npm run package
```

Produces a `.dmg` and `.zip` in the `release/` directory. The backend is bundled via PyInstaller.

## First Steps

1. Open the app. Wait for the backend health check (green dot in the top bar).
2. Go to **Models** and download a model from Hugging Face (e.g., `mlx-community/Qwen3-1.7B-MLX-8bit`).
3. Click the model name in the top bar to load it into memory.
4. Switch to **Chat** and start a conversation.

## Storage

All user data is stored in `~/.silicon-studio/`:

| Path | Contents |
|------|----------|
| `models.json` | Model registry (names, paths, status) |
| `models/` | Downloaded model files |
| `adapters/` | Fine-tuned LoRA adapters |
| `conversations/` | Chat history as JSON files |
| `notes/` | Markdown notes as JSON files |
| `agents/agents.json` | Agent workflow definitions |
| `rag/` | RAG collections and chunks |
| `mcp_servers.json` | MCP server configurations |
| `logs/app.log` | Backend rotating log (5 MB, 3 files) |

No data is sent to external servers. Everything stays on disk.
