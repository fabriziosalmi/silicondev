# Changelog

## v0.4.0

### Backend Hardening

- Thread-safe `active_jobs` and `models_config` in engine service via `threading.Lock`
- Thread-safe `server_process` in deployment service via `threading.Lock`
- Async-safe `_active_sessions` in terminal API via `asyncio.Lock`
- Atomic JSON writes (tempfile + `os.replace`) in conversations, notes, and models config — prevents data corruption on crash
- `get_job_status` returns a copy to prevent external mutation

### Terminal UX

- Input bar retains focus after submitting a command (no need to re-click)

### Docs

- Added Agent Terminal feature page and API reference
- Updated changelog and version references

## v0.3.0

### UI/UX Consistency Audit

- Global iOS-style `:active` scale-down on all buttons and switches
- Upgraded `focus-visible` to 2px solid blue with 2px offset
- Apple-style tight letter-spacing on headings (`-0.02em`)
- Fixed placeholder contrast from gray-600 to gray-500 (WCAG 3:1)
- ToggleSwitch keyboard support (spacebar and Enter)
- AI text width capped at `max-w-prose` for readability
- Slim 6px scrollbars with Firefox fallback

### Terminal Improvements

- Full-bleed terminal layout (no padding, fills viewport)
- Removed 240px output truncation — output streams naturally
- Auto-scroll follows bottom unless user scrolls up manually
- Dark-themed code blocks in streaming markdown
- AbortController on SSE streams for proper stop/cancel
- Stop button works in both Terminal and Agent modes

## v0.2.0

### NanoCore Agent Terminal

- Dual-mode terminal: direct bash (PTY) and NanoCore agent
- Streaming SSE output for both modes
- XML-based tool call parsing with safety checks
- Diff proposals with human approval before writing files
- Telemetry sidebar (agent state, tokens, elapsed time)
- Sandboxed command execution with blocked patterns and protected paths

### VitePress Documentation Site

- Custom Apple-inspired theme
- Full feature documentation and API reference
- Guide, architecture, and configuration pages

## v0.1.0

Initial release. Based on [Silicon-Studio](https://github.com/rileycleavenger/Silicon-Studio) by Riley Cleavenger with significant additions.

### Core

- Electron + React + TypeScript frontend with TailwindCSS dark theme
- FastAPI + MLX backend for Apple Silicon
- All data stored locally in `~/.silicon-studio/`

### Models

- Browse and download models from Hugging Face
- Auto-discover models from LM Studio, Ollama, HuggingFace cache
- Register custom models by local path
- Load/unload from top bar dropdown
- Delete downloaded models

### Chat

- Streaming inference with SSE
- Conversation persistence with CRUD
- Conversation branching (fork at any message)
- Conversation search (sidebar)
- In-chat text search with match navigation (Ctrl+F)
- Collapsible parameters sidebar (collapsed by default)
- Quick actions: rewrite, translate, perspectives, self-critique, ethical assessment
- Code syntax checking and sandbox execution
- PII redaction via Presidio
- Memory map (auto-summarize context)
- RAG knowledge injection
- Web search injection (DuckDuckGo)
- Reasoning mode control (off, auto, low, high)

### Fine-Tuning

- LoRA and QLoRA via MLX
- Preset configurations (draft, balanced, deep)
- Configurable hyperparameters and LoRA settings
- Real-time loss curves and job monitoring

### Data Preparation

- CSV preview and JSONL conversion
- Column mapping for instruction/input/output
- MCP-based synthetic dataset generation

### RAG Knowledge

- Collection CRUD
- File ingestion with chunking
- Keyword-overlap querying (no vector embeddings yet)
- Chat integration toggle

### MCP Integration

- Server management (add, remove, test)
- Tool discovery via MCP protocol
- Tool execution
- Dataset generation from tool schemas

### Agent Workflows

- Workflow CRUD with nodes and edges
- Node types: input, llm, tool, condition, output
- Execution is mocked (placeholder results)

### Notes

- Markdown editor with auto-save
- Pin, rename, delete
- Export as .md
- Send to chat

### Model Export

- Export fine-tuned adapters with quantization
- 4-bit, 8-bit, or full precision
- Uses mlx_lm.fuse()

### Deployment

- Deploy model as OpenAI-compatible HTTP server
- Start/stop with real-time logs

### Evaluations

- Benchmark runner (MMLU, HellaSwag, HumanEval, TruthfulQA)
- Score tracking and history

### Settings

- Centralized settings page
- Chat defaults, RAG defaults, MCP server management
- Reset all settings

### UI

- Dark theme throughout
- Collapsible left sidebar with conversation/note panels
- Collapsible right sidebar (parameters)
- Top bar with model switcher and system stats
- Search within conversations
