# Changelog

## v0.6.1

### Code Workspace Enhancements
- New File creation: FilePlus button in file tree header, inline filename input, auto-creates parent dirs
- File context menu: right-click or `...` button on any file/folder for Rename, Delete, Copy Path
- Inline rename with auto-selection of name without extension
- Delete with confirmation dialog, auto-closes open tabs
- Workspace dir now saved independently from codebase indexer — Code tab works even if no source files are found for semantic search

### Monaco Editor Fix
- Fixed `Cannot read properties of null (reading 'useState')` crash when opening files
- Root cause: dual React instances — `@monaco-editor/react` was in root package.json but renderer has its own React
- Moved Monaco to renderer dependencies + Vite resolve alias to guarantee single React instance

### DMG Build Fix
- Added `"size": "2g"` to DMG config for larger app bundles (~950MB with mlx-vlm)
- Fixed "No space left on device" error during DMG creation

### Settings Fix
- "Select Directory" button now correctly opens Finder dialog (was calling wrong IPC method)
- Improved error message when codebase indexer finds no source files

## v0.6.0

### Vision Model Support
- VLM (Vision-Language Model) chat with image attachments
- Image paste/upload in Chat with drag-and-drop support
- Automatic VLM detection and model path routing (mlx-vlm)
- Qwen3.5-recommended sampling parameters for VL tasks
- Thinking mode disabled for VLM (direct response, no garbled output)
- Repetition detection safety net for small VLM models

### VLM Generation Fixes
- Fixed temperature parameter being silently ignored (wrong kwarg name)
- Fixed missing repetition_penalty and top_p in VLM generation path
- Added `</think>` tag closure when model finishes without closing thinking
- Content-level repetition loop detection (breaks on 100-char repeated blocks)

### Frontend Thinking Block Rendering
- Strict regex for `<think>` blocks — only matches when `</think>` is present
- During streaming, thinking content shown without eating visible content
- Prevents empty message body when model generates thinking but no response

### E2E Test Suite
- Expanded Playwright test suite from ~40 visibility checks to 74 interaction tests
- Full coverage across all 13 app pages (Terminal, Code, Settings, Model Export, etc.)
- Input interaction tests: typing, form submission, toggle clicks, dropdown changes
- Console error monitoring during navigation
- Mock routes for all backend API endpoints

## v0.5.8

### Vector Codebase Indexer
- AST-aware Python chunking (classes, methods, functions as individual chunks)
- Sliding-window chunking for JS/TS/Go/Rust and 30+ other languages
- Hybrid search: BM25 keyword + vector cosine + Reciprocal Rank Fusion
- NanoCore `search_codebase` tool for semantic code queries
- Index/re-index/delete from Settings UI
- Stored at `~/.silicon-studio/codebase_index/`

### Live Workspace Editor
- New "Code" tab with file tree sidebar + Monaco editor
- Read/write files through the backend API
- Syntax highlighting for 40+ languages
- Cmd+S to save, dirty-file indicators, tabbed interface
- `diff_proposal` events from NanoCore auto-open the target file
- Cmd+E shortcut to jump to Code tab

## v0.5.6

### Self-Healing Loop
- NanoCore detects non-zero exit codes from `run_command`
- Automatically retries with a fix (up to 2 attempts)
- SSE events: `self_heal_start`, `self_heal_attempt`, `self_heal_success`, `self_heal_fail`
- Telemetry sidebar shows heal status in real-time

## v0.5.4

### Build & Release Fixes
- Pre-flight check script for release builds
- Backend crash handling improvements in Settings
- Version alignment across package.json, pyproject.toml, main.py

## v0.4.2

### Port Auto-Detection
- Backend scans 8000-8099 for a free port instead of crashing if 8000 is busy
- Electron reads the chosen port from backend stdout via IPC
- Frontend `API_BASE` is resolved dynamically at startup

### JSON Data Migration
- Added `_schema_version` field to conversations and notes
- Lazy migration on read: old files get missing fields (`pinned`, timestamps, etc.) auto-filled and re-saved
- Future schema changes just add a new `if version < N` block

### Auto-Updater
- Wired `electron-updater` to check GitHub Releases on launch (packaged builds only)
- Update banner appears below the top bar when a new version is downloaded
- One-click "Restart & Update" button

### Electron File Logging
- Replaced `console.log` with `electron-log` in the main process
- Logs written to `~/Library/Logs/SiliconDev/main.log` (5 MB rotating)
- Log file path shown in Settings for bug reports

### OpenAPI Type Codegen
- Added `openapi-typescript` toolchain (`npm run generate:types` in renderer)
- Types can be gradually adopted from the generated file

### Error Boundary
- React `ErrorBoundary` wrapping the entire app (inline styles, immune to CSS crashes)
- Shows error message + "Reload Application" button instead of white screen

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
- Import from .md and .txt files
- Export as .md, .txt, or PDF
- Legacy note auto-migration
- AI Commands sidebar (Continue Writing, Summarize, Draft Introduction)
- AI Transforms (To Table, Key Points, Expand, Outline)
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
