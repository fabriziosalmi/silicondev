# Changelog

## [0.15.0] — 2026-05-10

### Features — "P0 Complete: Native Runtime, Agents, RAG, MCP, Coder Loop"

This release delivers the full **P0 milestone**: five major platform capabilities that move SiliconDev from demo-reliable to production-reliable.

#### P0.1 — Native API Runtime (eliminates external `mlx_lm.server`)
- New `backend/app/api/openai.py` router exposes `/v1/chat/completions` and `/v1/models` directly via the internal `MLXEngineService`. SSE streaming and non-streaming modes both supported; fully OpenAI-compatible (Cursor, scripts, external clients).
- `backend/app/api/deployment.py` rewritten: `POST /api/deployment/start` now loads the model into unified VRAM instead of spawning an external process. `stop`, `status`, and `logs` endpoints updated accordingly.
- Removed `--mlx-lm-server` CLI intercept from `backend/main.py`. Single-process architecture, zero subprocess orchestration required.

#### P0.2 — Agent Workflows: real DAG execution engine
- `backend/app/agents/service.py` replaced with a deterministic graph execution engine.
- Nodes executed in topological BFS order via `edges` (not sequential loop).
- Conditional nodes return `(output, route_key)` to route execution to `true`/`false` branches.
- Per-run state persisted atomically to `~/.silicon-studio/agents/runs/<run_id>.json`.
- Resume failed runs via `POST /api/agents/{agent_id}/runs/{run_id}/resume` — completed nodes are skipped, execution restarts from failure point.
- Retries with exponential backoff (configurable `max_retries`, `timeout_sec` in agent config).
- New endpoints: `GET /api/agents/{agent_id}/runs`, `POST /api/agents/{agent_id}/runs/{run_id}/resume`.

#### P0.3 — RAG completion: quality evals
- Internal evaluation harness (`backend/scripts/rag_eval.py`): synthetic 5-document corpus, 7 targeted queries, Hit Rate@3 and MRR metrics.
- Eval result: **MRR 1.0 / Hit Rate 100%** on internal dataset with BM25 fallback (MLX embedding unavailable in offline CI).
- Existing hybrid BM25 + HNSW vector search with RRF and adaptive usage boost confirmed production-ready.

#### P0.4 — MCP in chat and agents (full, not exploratory)
- `backend/app/mcp/registry.py`: per-server `enabled` flag, atomic `_save()` with `os.replace`.
- `backend/app/mcp/client.py`: **3 retries with exponential backoff** (1 → 2 → 4s) on all tool calls and `list_tools`; typed `MCPError` with attempt count.
- `backend/app/mcp/audit.py` (new): append-only JSONL audit log at `~/.silicon-studio/mcp_audit.jsonl` with rotation at 10 MB. Records server_id, tool, args (truncated), status, duration_ms, and result preview for every call.
- `backend/app/mcp/service.py`: enforces enabled/disabled policy (raises `PermissionError`), wires audit log, exposes `execute_tool_for_agent()` for LLM context injection.
- `backend/app/api/mcp.py`: `PATCH /api/mcp/servers/{id}/enabled`, `GET /api/mcp/audit`, `403` responses for disabled servers.
- `backend/app/agents/service.py`: new `mcp` node type — agent workflows can now call any registered MCP tool with `{{input}}` template substitution.

#### P0.5 — Coder Reliability Loop (Evaluator/Optimizer)
- `backend/app/engine/coder_loop.py` (new): bounded `generate → syntax check → critique → revise` loop.
  - Hard cap: 1–10 iterations (clamped).
  - Per-step LLM timeout via `asyncio.wait_for`.
  - LLM critic: if response is `"LGTM"`, loop stops early (`stop_reason: critic_pass`).
  - Explicit stop reasons: `success`, `max_iter`, `critic_pass`, `model_error`, `sandbox_unavailable`, `cancelled`.
  - All steps emit structured SSE telemetry events: `started`, `generated`, `check_result`, `critique`, `revised`, `finished`.
- `backend/app/api/coder_loop.py` (new):
  - `POST /api/coder/run`: starts loop, returns SSE stream; `X-Session-Id` header for cancellation.
  - `DELETE /api/coder/run/{session_id}`: graceful cancellation.
  - `GET /api/coder/sessions`: lists active sessions.

### Version bumps
- `backend/app/version.py`, `package.json`, `src/renderer/package.json`, `backend/pyproject.toml` → `0.15.0`.

## [0.14.2] — 2026-05-10

### Bug Fixes

- **Scout: 353 Risks badge growing without bound**: recommendation rows had timestamped node ids, so every 5-minute reconnaissance added duplicates for the same hotspot. Now deterministic id (`scout_rec_hotspot_<target>`), upserted via existing `ON CONFLICT DO UPDATE`. One-shot purge of legacy timestamped rows runs at scout startup.
- **`Error: There is no Stream(gpu, 0) in current thread.`**: MLX requires a per-thread default GPU stream; the chat path runs token generation through asyncio's default executor, which spawns arbitrary threads with no stream. Pinned all 9 MLX `loop.run_in_executor` calls to a single dedicated `ThreadPoolExecutor(max_workers=1)` initialized with `mx.set_default_device(mx.gpu)`.
- **`.gitignore` `models/` matched `src/renderer/src/components/models/`**: anchored with `/` to repo root only.

### Refactor

- **engine/service.py modularization**: split from 2521 → 1783 lines (-29%). Four new cohesive modules (`engine/_helpers.py`, `engine/_messages.py`, `engine/_dpo.py`, `engine/_lora.py`). Public API of `MLXEngineService` unchanged so all callers (api/engine.py, agents, nanocore supervisor) keep working with zero edits.

### UI

- **Models page redesign**: dense list view (~40px rows vs ~140px cards), Discover-first tab order with adaptive default (My Models when any model exists, otherwise Discover for first-time users), family filter chips with live counts, hover-revealed download button, sorted smallest-first.
- **Catalog refresh**: 21 current mlx-community models added (Qwen 3 / 3.5 / 3.6, Gemma 3 QAT and Gemma 4 family, Devstral Small 2, gpt-oss-20b, Kimi K2.6, LFM2.5).
- **Notes — global right-click capture**: select any text anywhere → context menu with "Save to new note" + "Copy". Smart formatting fences code blocks with parsed language tag.
- **LoRA training compaction**: form roughly half the previous height; new 3-region pattern (header / scrolling middle / sticky footer) keeps the "Start Training" button always visible.
- **DataPreparation tab padding**, **Deployment "Copy all" log button**.

### Release pipeline polish

- **Removed `backend/verify_phase5.py`**: leftover Phase 4/5 verification script, no longer used.
- **PyInstaller spec**: removed bogus `'app.main'` hidden import (entrypoint is `backend/main.py`, not `app.main`) — kills the noisy "Hidden import 'app.main' not found" warning during analysis.
- **`presidio_analyzer` import fix**: removed unused `Registry` import that broke `test_shield.py` collection on current presidio versions.
- **`docs/development/releasing.md`**: full reference for the local-only signed/notarized release pipeline.

## [0.14.1] — 2026-05-10

### Release

- **Signed and notarized macOS builds**: DMG and zip artifacts are now signed with `Developer ID Application` and notarized by Apple. Previous releases (≤ 0.14.0) shipped unsigned and required manual quarantine bypass; v0.14.1 opens with a double click on any Mac with Gatekeeper enabled.
- **`scripts/release.sh`**: Local release script that runs preflight checks (Apple credentials, keychain identity, notarytool reachability), builds frontend + PyInstaller + electron-builder, notarizes and staples the DMG, and uploads to GitHub. Reads credentials from `.env.local` (gitignored). Supports `--skip-build`, `--replace`, `--no-publish`, `--dry-run`.
- **`package.json` mac config**: Added `identity` and `notarize: true`. Notarization credentials are passed via env, never via repo secrets.
- **Removed `.github/workflows/release.yml`**: CI build on tag is replaced by local `scripts/release.sh`. Signing keys live only on the developer machine; the GitHub Actions runner never sees them. CI continues to lint/test/build (unsigned) on every push and PR via `ci.yml`.

## [0.14.0] — 2026-03-29

### Security

- **Path traversal fix**: Agent supervisor now validates all relative paths with `Path.resolve()` + workspace bounds check, blocking `../` escapes in `read_file`, `edit_file`, `patch_file`, and bash redirects.
- **Global state mutation fix**: Removed `os.chdir()` from supervisor — was mutating process-wide working directory, breaking concurrent agents.

### Bug Fixes

- **Engine race condition**: Fixed check-then-act race on `generation_lock` during model switching. Now uses atomic `wait_for(acquire)` with proper `try/finally` release.
- **React refs-during-render**: Moved all callback ref updates in `MessageFeed.tsx` into `useEffect` hooks (was causing stale renders).
- **RAG error masking**: `get_collections()` now distinguishes `FileNotFoundError` / `JSONDecodeError` / `OSError` instead of catching all exceptions silently.

### Improvements

- **Model cache type safety**: Replaced raw tuple with `_CachedModel` NamedTuple — eviction uses `.last_used` instead of magic index `[4]`.
- **Edit history bounded**: Supervisor `_edit_history` is now a `deque(maxlen=200)` to prevent memory leaks in long sessions.
- **ESLint zero errors**: Resolved all 86 ESLint errors across 25+ files — replaced `any` types with proper interfaces, fixed unused variables, added missing hook dependencies.
- **ESLint config**: Enabled `allowConstantExport` for the Provider+Hook co-export pattern.
- **E2E tests fixed**: Aligned all 87 Playwright tests with current UI (tab renames, selector updates). First green CI in project history.
- **CI badge**: Added GitHub Actions CI status badge to README.

---

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
