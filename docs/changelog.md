# Changelog

## v0.9.4

### Coder Agent
- Time Machine checkpoint system — every AI edit creates a checkpoint, rollback to any point via TimelineRail sidebar
- Undo fixed — sessions preserved after SSE stream ends (10min TTL)
- `/plan` routing through PlannerEditor with PlanCard approval UI
- Parser unescape for literal `\n`, `\t` from small models in tool args

### UI Polish
- Coder sidebar header redesigned: dynamic info ticker, inline role icons
- Input bar: fixed two-line wrapping, aligned prompt
- Tool labels cleaned up (underscores removed, smaller text)
- Diff header spacing fixed
- Error messages use consistent mono font
- Context Discovery simplified (icon + snippet count)
- React key warning in RagKnowledge fixed

### Testing
- New e2e integration test for coder flow (3 models: Qwen3-0.6B, 1.7B, 4B)
- All 89 Playwright E2E tests updated and passing
- All 214 backend unit tests passing

## v0.9.3

### Adaptive RAG Search
- Multi-method retrieval: BM25, keyword, vector, and hybrid fusion
- Per-query method selection based on query type
- RAG collection analytics and usage tracking

### UI Overhaul
- Redesigned Models page with architecture-based color coding
- Split-view model details with README rendering
- Recommended models section for new users

## v0.9.2

### UI Polish
- Sidebar diff auto-collapses when inline Accept/Reject is used
- "LOCAL EXECUTION ONLY" badge reduced to compact shield icon with tooltip
- Context menu: removed redundant "NanoCore:" prefix, added brain icon per action
- Fixed crash when clicking files in Code panel (`useHolographicDiff` null editor guard)

### Bug Fixes
- Fixed Python 3.14 conditional import shadowing across backend (`mx`, `re`, `tempfile`, `os`, `sys`)
- Fixed missing model directory error with clear message instead of cryptic HF repo ID error
- Fixed npm audit vulnerabilities (tar, minimatch)

## v0.9.1

### Swarm Progress Events
- Real-time SSE events for MoA swarm map/reduce phases
- Frontend shows pulsing status for each expert during swarm execution

### Enriched Session Summary
- Agent `done` event now includes iteration count and edits count

### Security
- Air-gapped web search blocking verification
- npm dependency audit fixes

## v0.9.0

### Phase 8 — UX
- Context health bar (token usage indicator)
- Energy manager (low-power mode)
- Pinned context items
- Scout issues panel

### Phase 9 — Architecture
- Agent mode toggle (edit/review)
- Undo support for agent edits
- Emergency stop shortcut (Cmd+Esc)
- Agency HUD (Architetto/Operaio/Ispettore roles)

### Phase 10 — MoA Swarm
- Map-Reduce Mixture of Agents orchestrator
- Security, Performance, and Syntax expert personas
- Lead Developer Synthesizer reducer

### Phase 11 — Agent Capabilities
- Codebase indexing and search tools
- Escalation flow with user-in-the-loop
- Auto-retry with self-healing on tool failures

## v0.7.4

### PII Redaction Settings
- PII redaction toggle added to main Settings page (Privacy section)
- Redacts emails, phone numbers, IPs, credit cards, SSNs, and API keys from chat messages
- Disabled by default, configurable from both Settings and Chat drawer

### Version Alignment
- Synchronized version across package.json, pyproject.toml, main.py, README badge, docs config, and pre-flight check

### Docs Site
- Reordered features sidebar to match app menu (Local Server / Advanced Tools / App)
- Added Code Workspace documentation page

## v0.7.3

### NanoCore Agent Improvements
- Workspace directory passed from frontend to agent — tools run in the correct working directory
- Active file path injected into agent system prompt — agent knows which file is open in the editor
- Fixed think block boundary bug — text after `</think>` in the same token was silently lost
- Diagnostic logging for raw model output (debug level)

### In-App Documentation
- Built-in documentation viewer accessible from sidebar
- Renders all feature docs as styled markdown cards
- Sections match sidebar menu order

### Error Reporting
- User-facing error reporting dialog with optional description
- Copies error details to clipboard for bug reports

### Log Viewer
- Electron main process log viewer in Settings
- Shows last 200 lines with auto-refresh and copy-to-clipboard

## v0.7.2

### Bug Fixes
- Fixed sandbox process leak causing 100% CPU — orphaned `silicon-sandbox` processes are now cleaned up
- Hidden oversized models (>available RAM) from Discover page to prevent failed loads
- Fixed active model state sync between frontend TopBar and backend polling

## v0.7.1

### Security Hardening
- Input validation on all API endpoints (Pydantic field constraints)
- Path traversal protection on file read/write operations
- Sandboxed command execution blocklist expanded

### Stability Fixes
- Fixed stale closures in React components (useRef pattern for callbacks)
- Typed IPC channels between Electron main and renderer
- Stabilized E2E test suite (reduced flakiness)

## v0.7.0

### Security Fixes
- Added command blocklist for dangerous shell operations
- Protected paths prevent writes outside workspace
- Sandboxed code execution with timeout enforcement

### E2E Test Suite
- Comprehensive Playwright test coverage across all pages
- Mock API routes for deterministic testing
- Console error monitoring during navigation

### Type Safety
- TypeScript strict mode enabled for renderer
- Typed API client with proper error handling

### Honest Evaluations
- Eval benchmarks report real scores (no inflated metrics)
- Score history tracking with timestamps

## v0.6.2

### AI-Assisted Code Workspace
- NanoCore agent integrated into the Code page — autonomous reasoning, tool execution, and diff proposals directly alongside the editor
- Three-column layout: file tree | Monaco editor | agent panel (collapsible)
- Inline Monaco DiffEditor for reviewing proposed changes with Apply/Reject actions
- Agent panel with streaming message feed, telemetry sidebar, and dedicated input bar
- Diff proposals auto-open the target file in the editor

### Terminal Simplified
- Terminal page is now bash-only — cleaner and faster for shell commands
- Agent mode removed from Terminal (moved to Code workspace where it belongs)
- Removed mode toggle, telemetry sidebar, and model dependency from Terminal

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

### Pipelines & Jobs

- Pipeline CRUD with sequential steps
- Step types: LLM inference, shell command, keyword filter
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
