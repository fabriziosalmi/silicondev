# Changelog

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

- Security, error handling, and correctness fixes.
- TypeScript build error fixes from hook extraction refactor.

## [0.11.0] — 2026-03-19

- NanoCoder model integration (4 variants in models.json).
- App hotkey fixes.

## [0.10.4] — 2026-03-18

- Fix broken Start Server due to missing python executable.
- Fix avatar paths and code block overflow.

## [0.10.2] — 2026-03-17

- Evaluations: 30 questions, DatasetEngine API, val_loss tracking, predictive model loader.
