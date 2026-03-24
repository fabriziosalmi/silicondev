# Changelog

## [0.13.0] — 2026-03-24

### Component Modularization

- Split `EngineInterface.tsx` (695 lines) into `engine/LoraTab` and `engine/DpoTab`.
- Split `ModelsInterface.tsx` (901 lines) into `models/MyModelsTab`, `models/DiscoverTab`, `models/AddModelModal`, and `models/ModelsUtils`.
- Split `Settings.tsx` (1066 lines) into `settings/WebIndexerSection`, `settings/CodebaseIndexSection`, `settings/LogViewerSection`, and `settings/SettingsUtils`.
- Split `RagKnowledge.tsx` (621 lines) into `rag/CollectionsTab`, `rag/IngestTab`, and `rag/AnalyticsTab`.

### Security Hardening

- **Preview command injection**: Replaced `shell=True` with `shlex.split()` + `shell=False` in the preview server launcher.
- **Model cache thread safety**: Added `_cache_lock` around all `_model_cache` mutations to prevent concurrent access corruption.
- **RAG concurrency**: Added `threading.Lock` to `create_collection`, `delete_collection`, and `ingest_files` to prevent data corruption under concurrent requests.
- **Air-gap bypass fix**: Replaced string-matching import detection with AST-based analysis; blocks `__import__()` calls.
- **Path validation**: Added Pydantic `field_validator` on `workspace_dir` in `TerminalRequest` and `PlanRequest`; preview endpoint now validates with `safe_user_file()`.
- **OOM recovery**: Model cache is now cleared before retry to free memory; cache clear protected by lock.
- **npm audit**: Resolved `tar` symlink traversal vulnerability in root dependencies.

### Fixes

- `pre_flight_check.py` now reads version from `package.json` instead of a hardcoded string.

---

## [0.12.0] — 2026-03-23

Four structural features that change how the inference engine, agent routing, task delegation, and project preview work.

### Inference Engine Improvements

- **Smart GC**: `gc.collect()` + `mx.metal.clear_cache()` no longer runs after every single generation. Triggers conditionally: memory > 80%, 10+ generations, or 5+ minutes since last GC. Model switches and OOM recovery still force-collect.
- **Disk KV cache**: Persistent cross-session cache for KV prompt state. Uses `mlx_lm.models.cache.save_prompt_cache` / `load_prompt_cache`. Stored in `~/.silicon-studio/cache/kv/` with 2 GB LRU eviction. Saves in background thread for prompts > 256 tokens.
- **Speculative decoding**: Optional draft model for faster generation. Uses `mlx_lm`'s native `draft_model` parameter. Memory-aware: checks available RAM before loading. Falls back silently to normal generation if the draft model can't fit.
- API: `POST/GET /api/engine/draft-model`, `GET/DELETE /api/engine/kv-cache`.

### Model Routing

- **Role-based model selection**: Configure different models for different agent roles (planner, coder, reviewer, inspector) via `~/.silicon-studio/routing.json`.
- **Multi-model LRU cache**: Up to 2 models cached in RAM for near-instant switching between roles. Memory-aware: skips caching when RAM > 75%.
- **Prelayer integration**: `PromptProfile` now suggests a model role based on intent and complexity (complex → planner, review → reviewer, default → coder).
- **Supervisor routing**: Main generation uses "coder" role, inspector review uses "inspector", swarm uses "reviewer". All fall back to the caller's model_id when routing is disabled.
- **Swarm routing**: Experts resolve via "reviewer" role, reducer via "coder".
- API: `GET/PUT /api/engine/routing`.

### Subagent System

- **SubagentWorker**: Focused single-task workers with independent context and role-specific tool subsets. Four roles: `code_reviewer` (read-only), `test_writer`, `docs_generator`, `bug_fixer`.
- **SubagentOrchestrator**: Three execution patterns: `spawn_worker` (single), `spawn_parallel` (asyncio.gather), `spawn_pipeline` (sequential chain).
- **Supervisor tool**: The LLM can invoke `spawn_worker` to delegate tasks. Results are injected back as tool output.
- **SSE events**: `worker_start` and `worker_done` events shown in the frontend feed.

### Live Preview

- **Project detection**: Auto-detects Vite, Next.js, CRA, Nuxt, Svelte, Astro, Flask, FastAPI, and static HTML projects. Detects package manager (npm/pnpm/yarn/bun).
- **Preview server**: Starts a dev server, picks a free port (3100-3199), waits for readiness, streams logs to a ring buffer.
- **PreviewPanel**: Renders in an iframe below the editor with toolbar (Start/Stop/Refresh/Open in Browser/Logs toggle), project type badge, resizable height.
- **Layout**: Horizontal split below the editor, same column as DebuggerPanel. Drag handle for resize (150-600px), height persisted to localStorage.
- API: `POST /api/preview/start|stop`, `GET /api/preview/status|detect|logs`.

### Tests

65 new tests across 5 test files: `test_engine_improvements.py`, `test_model_routing.py`, `test_subagent.py`, `test_preview.py`, `test_dpo_pipeline.py`.

---

## [0.11.1] — 2026-03-20

### Fixes
- Fix TypeScript build errors from hook extraction refactor.
- UX, code quality, and maintainability improvements across frontend.
- Security hardening: auth middleware edge cases, error handling, correctness fixes.

---

## [0.11.0] — 2026-03-17

### Features
- Integrate NanoCoder model (4 variants added to models.json).
- Fix App hotkeys not triggering on certain keyboard layouts.

---

## [0.10.5] — 2026-03-17

### Fixes
- Move proposed change overlay to bottom-right to avoid obscuring code in the editor.

---

## [0.10.4] — 2026-03-17

### Fixes
- Fix broken "Start Server" due to missing python executable path resolution.
- Fix missing avatar paths (icon.svg absolute path) causing broken avatars in chat.
- Fix code block overflow: removed `overflow-hidden` so code block menus display correctly.

---

## [0.10.3] — 2026-03-17

### Features
- Add Codebase API documentation with hybrid search capabilities.

### Fixes
- Fix avatar paths and code block overflow styling.

---

## [0.10.2] — 2026-03-16

### Features
- **Evaluations**: 30-question evaluation suite with DatasetEngine API.
- **val_loss tracking**: Training loss validation during fine-tuning.
- **Predictive model loader**: Background thread pre-heats default model when system has >40% free RAM.

### Fixes
- Remove dead training module, wire debugger routes, fix CommandPalette actions.

---

## [0.10.1] — 2026-03-16

### Fixes
- Compatibility with `mlx_lm` 0.30.7 API changes.
- Docs overhaul: README, CONTRIBUTING, VERSIONING updated to reflect actual codebase.
- VitePress config version update.

---

## [0.10.0] — 2026-03-15

### Features — "The Autonomous Core"
- **NanoCore Supervisor Agent**: Full agentic loop with tools (`read_file`, `edit_file`, `patch_file`, `run_bash`).
- **Planner**: Two-phase plan+execute for multi-file edits.
- **Knowledge Graph**: SQLite-backed graph of nodes/edges extracted from conversations.
- **Knowledge Extractor**: LLM-based fact extraction from chat history.
- **Prelayer**: Intent classification, complexity scoring, file extraction, auto-mode selection.
- **Auth Middleware**: Bearer token for Electron↔Backend communication.
- **Command Palette**: Keyboard-driven action launcher (`Alt+Shift+P`).
- **Prompt Library**: 22 curated system prompts.
- **Response Actions**: Rewrite, translate, self-critique on any response.
- **Assessment Popover**: Rate and evaluate agent responses.
- **Confirm Dialog**: Confirmation for destructive actions.
- **i18n**: 23 languages.

---

## [0.9.6] — 2026-03-09

### Features
- Regenerate responses, git branch display, diff highlighting, context drawer, fix-this action, task recap.

### Fixes
- Terminal page: memory leaks, performance, accessibility, persistence.
- Security hardening: auth middleware, MCP validation, eval sandboxing, path traversal checks.
- Tailwind CSS content paths for Vite builds from project root.

---

## [0.9.5] — 2026-03-08

### Features
- **Chat input**: Slash commands, @file mentions, prompt history, paste detection, token counter.
- **Prompt Library**: 22 curated system prompts (assistant, coding, writing, analysis, education, roleplay).
- **i18n**: 7 new locales (ru, ko, tr, uk, bn, fa, sw) — 23 languages total. All 15 existing locales synced to 610 keys.
- Prelayer agent integration, UI components update.

### Fixes
- Chat & Models page UI audit: layout, actions, icons, build fixes.

---

## [0.9.4] — 2026-03-08

### Features
- Coder checkpoint/undo system.
- `/plan` routing for structured multi-file edits.
- Parser unescape improvements.
- Adaptive RAG search.
- UI overhaul.

---

## [0.9.3] — 2026-03-07

### Features
- Fast-close after single clean patch approval.

### Fixes
- Preserve tool calls inside unclosed `<think>` blocks, strip incomplete think blocks.
- Show `patch_file` errors in agent feed instead of silently failing.
- UI polish: CSS import order, feed styling, header cleanup, sidebar diff sync, badge icon, context menu.
- Guard against null editor in useHolographicDiff.

---

## [0.9.2] — 2026-03-07

### Fixes
- Bump version, update changelog.
- UI polish: sidebar diff sync, badge icon, context menu cleanup.

---

## [0.9.1] — 2026-03-07

### Features
- **MoA Swarm**: Parallel sub-agents (Security, Performance, Syntax) review proposed changes.
- Swarm progress events, enriched session summary.
- Agent capability toggles in UI.

### Fixes
- Purge all conditional imports shadowing top-level in Python 3.14.
- Dependency security fixes.

---

## [0.9.0] — 2026-03-07

### Features — "UX Magic & Architectural Foundations"
- Phase 8 UX improvements and Phase 9 architectural foundations.
- Core agent loop, tool parsing, diff proposal workflow.

---

## [0.8.0] — 2026-03-05

### Features
- Strict SemVer governance and automated version sync gates (pre-commit hook).

---

## [0.7.4] — 2026-03-05

### Features
- Step labels, stuck-agent nudge, diff sync/collapse, multi-turn memory, E2E tests.
- Editor context menu, code snippet actions, inline telemetry.
- Resizable split panes in Code workspace (sidebar + agent panel).
- Collapsible thinking display, shorter system prompt, file context instruction.
- Agent file context, collapsible tool output, markdown rendering.

### Fixes
- Codebase indexer hardening, warning-clean backend quality gates.
- NanoCore SSE test mocks accept kwargs matching real `run()` signature.
- DiffEditor ↔ HolographicDiff approval sync, stop agent after clean patch.
- Agent output missing spaces: `strip_tool_calls` was stripping whitespace between tokens.
- Agent input focus (pointerdown capture), strip `<think>` tags in terminal.
- Active model fallback when not in config, AgentInputBar focus, polling ref sync.
- Crash on file open: `EditorContextKeys.hasNonEmptySelection` undefined.
- NanoCore chat input disabled despite model being loaded.

---

## [0.7.3] — 2026-03-04

### Fixes
- Sandbox process leak (100% CPU).
- Hide oversized models in Discover page.

---

## [0.7.2] — 2026-03-04

### Fixes
- Sync active model state between frontend and backend.

---

## [0.7.1] — 2026-03-04

### Fixes
- Security hardening, stale closures, IPC types, test stability.
- Model load blocked by stale generation lock.
- TopBar silent catch.
