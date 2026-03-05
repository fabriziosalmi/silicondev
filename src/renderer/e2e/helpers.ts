import { Page } from '@playwright/test'

/* ── Shared mock data ─────────────────────────────────────── */

export const MOCK_MODELS = [
  {
    id: 'mlx-community/Llama-3.2-3B-Instruct-4bit',
    name: 'Llama 3.2 3B Instruct',
    size: '1.8GB',
    family: 'Llama',
    architecture: 'LlamaForCausalLM',
    context_window: '4096',
    quantization: '4-bit',
    downloaded: true,
    downloading: false,
    local_path: '/mock/models/llama',
  },
  {
    id: 'mlx-community/Mistral-7B-Instruct-v0.3-4bit',
    name: 'Mistral 7B Instruct',
    size: '4.1GB',
    family: 'Mistral',
    downloaded: false,
    downloading: false,
    local_path: null,
  },
]

export const MOCK_CONVERSATIONS = [
  {
    id: 'conv-1',
    title: 'Test Conversation',
    model_id: 'test-model',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T01:00:00Z',
    message_count: 3,
    pinned: false,
  },
  {
    id: 'conv-2',
    title: 'Pinned Chat',
    model_id: 'test-model',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T02:00:00Z',
    message_count: 5,
    pinned: true,
  },
]

export const MOCK_NOTES = [
  {
    id: 'note-1',
    title: 'My First Note',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T01:00:00Z',
    pinned: false,
    char_count: 42,
  },
]

export const MOCK_RAG_COLLECTIONS = [
  { id: 'col-1', name: 'Legal Docs', chunks: 1250, size: '12MB', lastUpdated: '2 hours ago', model: 'default' },
]

export const MOCK_AGENTS = [
  {
    id: 'agent-1',
    name: 'Research Agent',
    nodes: [{ id: 'n1', type: 'llm', label: 'LLM' }],
    edges: [],
    config: {},
  },
]

export const MOCK_FILE_TREE = {
  name: 'project',
  path: '/mock/project',
  type: 'dir',
  children: [
    {
      name: 'src',
      path: '/mock/project/src',
      type: 'dir',
      children: [
        { name: 'main.py', path: '/mock/project/src/main.py', type: 'file' },
        { name: 'utils.ts', path: '/mock/project/src/utils.ts', type: 'file' },
      ],
    },
    { name: 'README.md', path: '/mock/project/README.md', type: 'file' },
  ],
}

/* ── SSE helpers ──────────────────────────────────────────── */

/** Build an SSE body string from an array of event objects. */
export function buildSSE(events: Array<{ event?: string; data: Record<string, unknown> }>): string {
  return events.map(e => {
    const type = e.event || e.data.type
    return `data: ${JSON.stringify({ event: type, data: e.data })}\n\n`
  }).join('')
}

/** Chat SSE: stream text tokens then done. */
export function chatSSE(tokens: string[]): string {
  const parts = tokens.map(t => `data: {"text":"${t}"}\n\n`)
  parts.push('data: [DONE]\n\n')
  return parts.join('')
}

/** Terminal exec SSE: tool output then done. */
export function terminalExecSSE(output: string, exitCode = 0): string {
  return buildSSE([
    { data: { type: 'tool_log', text: output, call_id: 'c1' } },
    { data: { type: 'tool_done', exit_code: exitCode, call_id: 'c1' } },
    { data: { type: 'done', total_time_ms: 100 } },
  ])
}

/** Agent run SSE: session start, thinking, done. */
export function agentRunSSE(text: string): string {
  return buildSSE([
    { data: { type: 'session_start', session_id: 's1' } },
    { data: { type: 'token_stream', text } },
    { data: { type: 'done', total_tokens: 100, total_time_ms: 1500 } },
  ])
}

/** Agent run SSE with full tool flow: thinking → step_label → tool_start → tool_log → tool_done → text → done */
export function agentFullFlowSSE(): string {
  return buildSSE([
    { data: { type: 'session_start', session_id: 's-full' } },
    { data: { type: 'step_label', label: 'Thinking...', iteration: 1 } },
    { data: { type: 'telemetry_update', agent: 'supervisor', state: 'thinking', tokens_used: 0, elapsed_ms: 100, iteration: 1, token_budget: 50000, budget_fraction: 0 } },
    { data: { type: 'thinking', agent: 'supervisor', content: 'Let me read the file first to understand the code.' } },
    { data: { type: 'step_label', label: 'Reading main.py...', iteration: 1 } },
    { data: { type: 'tool_start', tool: 'read_file', args: { path: '/mock/project/src/main.py' }, call_id: 'c1' } },
    { data: { type: 'tool_log', call_id: 'c1', stream: 'stdout', text: '(5 lines)\n' } },
    { data: { type: 'tool_done', call_id: 'c1', exit_code: 0 } },
    { data: { type: 'step_label', label: 'Editing main.py...', iteration: 1 } },
    { data: { type: 'tool_start', tool: 'patch_file', args: { path: '/mock/project/src/main.py' }, call_id: 'c2' } },
    { data: { type: 'tool_done', call_id: 'c2', exit_code: 0 } },
    { data: { type: 'diff_proposal', call_id: 'c2', file_path: '/mock/project/src/main.py', old: 'print("hello world")\n', new: 'print("hello world!")\n', diff: '--- a/main.py\n+++ b/main.py\n@@ -1 +1 @@\n-print("hello world")\n+print("hello world!")\n' } },
    { data: { type: 'telemetry_update', agent: 'supervisor', state: 'waiting_human_approval', tokens_used: 200, elapsed_ms: 2000, iteration: 1, token_budget: 50000, budget_fraction: 0.004 } },
  ])
}

/** Agent run SSE: simple text response (no tools). */
export function agentTextOnlySSE(text: string): string {
  return buildSSE([
    { data: { type: 'session_start', session_id: 's-text' } },
    { data: { type: 'step_label', label: 'Thinking...', iteration: 1 } },
    { data: { type: 'thinking', agent: 'supervisor', content: 'Analyzing the request...' } },
    { data: { type: 'token_stream', text, agent: 'supervisor' } },
    { data: { type: 'done', total_tokens: 50, total_time_ms: 800 } },
  ])
}

/* ── Mock backend APIs ────────────────────────────────────── */

/**
 * Mock all backend API responses so the app can render without a real backend.
 * Call this in beforeEach for every test file.
 */
export async function mockBackendAPIs(page: Page) {
  // Health check
  await page.route('**/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', service: 'silicon-studio-engine' }),
    })
  )

  // Monitor stats
  await page.route('**/api/monitor/stats', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        memory: { total: 36_000_000_000, available: 20_000_000_000, used: 16_000_000_000, percent: 44.4 },
        cpu: { cores: 10, percent: 12.5 },
        disk: { total: 500_000_000_000, free: 200_000_000_000, used: 300_000_000_000, percent: 60 },
        platform: { system: 'Darwin', processor: 'Apple M3 Max', release: '25.3.0' },
      }),
    })
  )

  // Monitor storage
  await page.route('**/api/monitor/storage', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total: '5.2GB',
        categories: { models: '4.0GB', adapters: '500MB', conversations: '100MB', notes: '10MB', rag: '500MB', logs: '90MB' },
      }),
    })
  )

  // Engine active model (must be before the generic /models route)
  await page.route('**/api/engine/models/active', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ model: null }),
    })
  )

  // Engine models
  await page.route('**/api/engine/models', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_MODELS),
      })
    }
    return route.continue()
  })

  // Engine model load
  await page.route('**/api/engine/models/load', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'loaded',
        model_id: 'mlx-community/Llama-3.2-3B-Instruct-4bit',
        context_window: 4096,
        architecture: 'LlamaForCausalLM',
        is_vision: false,
      }),
    })
  )

  // Engine model unload
  await page.route('**/api/engine/models/unload', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'unloaded' }),
    })
  )

  // Engine model delete
  await page.route('**/api/engine/models/delete', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'deleted', model_id: 'test' }),
    })
  )

  // Engine model download
  await page.route('**/api/engine/models/download', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'downloading', model_id: 'test' }),
    })
  )

  // Engine model format
  await page.route('**/api/engine/models/*/format', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ model_type: 'LlamaForCausalLM', has_chat_template: true, eos_token: '<|eot_id|>' }),
    })
  )

  // Engine adapters
  await page.route('**/api/engine/models/adapters', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'ft-llama-legal',
          name: 'Llama Legal Fine-tune',
          size: '2.1GB',
          downloaded: true,
          downloading: false,
          is_finetuned: true,
          base_model: 'mlx-community/Llama-3.2-3B-Instruct-4bit',
          local_path: '/mock/adapters/llama-legal',
        },
      ]),
    })
  )

  // Engine chat (SSE)
  await page.route('**/api/engine/chat', (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: chatSSE(['Hello ', 'world!']),
      })
    }
    return route.continue()
  })

  // Engine chat stop
  await page.route('**/api/engine/chat/stop', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'stopped' }),
    })
  )

  // Deployment status
  await page.route('**/api/deployment/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ running: false, pid: null, uptime_seconds: null }),
    })
  )

  // Deployment start
  await page.route('**/api/deployment/start', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ running: true, pid: 12345, uptime_seconds: 0 }),
    })
  )

  // Deployment stop
  await page.route('**/api/deployment/stop', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ running: false }),
    })
  )

  // Deployment logs
  await page.route('**/api/deployment/logs*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ logs: [] }),
    })
  )

  // RAG collections
  await page.route('**/api/rag/collections', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_RAG_COLLECTIONS),
      })
    }
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'col-new', name: 'New Collection', chunks: 0, size: '0B', lastUpdated: 'just now', model: 'default' }),
      })
    }
    return route.continue()
  })

  // RAG collection delete
  await page.route('**/api/rag/collections/*', (route) => {
    if (route.request().method() === 'DELETE') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'deleted' }) })
    }
    return route.continue()
  })

  // RAG ingest
  await page.route('**/api/rag/ingest', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ingested', chunks: 42 }),
    })
  )

  // Agent execute (register before the catch-all agent route)
  await page.route('**/api/agents/*/execute', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        agent_id: 'agent-1',
        status: 'completed',
        execution_time: 1.5,
        steps: [{ node: 'LLM', status: 'completed', output: 'Result text', timestamp: '2026-01-01T00:00:00Z' }],
      }),
    })
  )

  // Agents — unified handler for /api/agents/ and /api/agents/*
  await page.route('**/api/agents/**', (route) => {
    const method = route.request().method()
    const url = route.request().url()
    // Execute is handled above; for /api/agents/ list/create and /api/agents/:id delete
    if (method === 'GET' && url.endsWith('/api/agents/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_AGENTS),
      })
    }
    if (method === 'POST' && url.endsWith('/api/agents/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'agent-new', name: 'New Agent', nodes: [], edges: [], config: {} }),
      })
    }
    if (method === 'DELETE') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'deleted' }) })
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' })
  })

  // Conversations
  await page.route('**/api/conversations/', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_CONVERSATIONS),
      })
    }
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'conv-new',
          title: 'New conversation',
          messages: [],
          model_id: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          message_count: 0,
          pinned: false,
        }),
      })
    }
    return route.continue()
  })

  // Conversation by ID
  await page.route('**/api/conversations/conv-*', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'conv-1',
          title: 'Test Conversation',
          messages: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there!' },
          ],
          model_id: 'test-model',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T01:00:00Z',
          message_count: 2,
          pinned: false,
        }),
      })
    }
    if (route.request().method() === 'PATCH') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'conv-1', title: 'Renamed', pinned: true }),
      })
    }
    if (route.request().method() === 'DELETE') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'deleted' }) })
    }
    return route.continue()
  })

  // Conversations search
  await page.route('**/api/conversations/search', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  )

  // Notes
  await page.route('**/api/notes/', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_NOTES),
      })
    }
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'note-new',
          title: 'Untitled',
          content: '',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          pinned: false,
          char_count: 0,
        }),
      })
    }
    return route.continue()
  })

  // Note by ID
  await page.route('**/api/notes/note-*', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'note-1',
          title: 'My First Note',
          content: '# Hello\nSome content here.',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T01:00:00Z',
          pinned: false,
          char_count: 42,
        }),
      })
    }
    if (route.request().method() === 'PATCH') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'note-1', title: 'Updated Note', content: 'Updated', pinned: false, char_count: 7 }),
      })
    }
    if (route.request().method() === 'DELETE') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'deleted' }) })
    }
    return route.continue()
  })

  // MCP servers
  await page.route('**/api/mcp/servers', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    }
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'mcp-1', name: 'test-server', command: 'node', args: ['server.js'] }),
      })
    }
    return route.continue()
  })

  // MCP server tools
  await page.route('**/api/mcp/servers/*/tools', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tools: [{ name: 'test_tool', description: 'A test tool' }] }),
    })
  )

  // Workspace tree
  await page.route('**/api/workspace/tree', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_FILE_TREE),
    })
  )

  // Workspace read file
  await page.route('**/api/workspace/read', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ content: 'print("hello world")\n', language: 'python' }),
    })
  )

  // Workspace save file
  await page.route('**/api/workspace/save', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, bytes: 21 }),
    })
  )

  // Workspace create file
  await page.route('**/api/workspace/create', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, path: '/mock/project/newfile.py' }),
    })
  )

  // Workspace rename file
  await page.route('**/api/workspace/rename', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, new_path: '/mock/project/renamed.py' }),
    })
  )

  // Workspace delete file
  await page.route('**/api/workspace/delete', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  )

  // Indexer sources
  await page.route('**/api/indexer/sources', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sources: [] }),
      })
    }
    return route.continue()
  })

  // Indexer status
  await page.route('**/api/indexer/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ running: false, last_run: null, collection_id: null, total_sources: 0, enabled_sources: 0 }),
    })
  )

  // Codebase status
  await page.route('**/api/codebase/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ indexed: false }),
    })
  )

  // Codebase index
  await page.route('**/api/codebase/index', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'indexed', files: 42, chunks: 300, vector_search: true }),
    })
  )

  // Terminal exec (SSE)
  await page.route('**/api/terminal/exec', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: terminalExecSSE('mock output'),
    })
  )

  // Terminal run (SSE)
  await page.route('**/api/terminal/run', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: agentRunSSE('thinking...'),
    })
  )

  // Terminal stop
  await page.route('**/api/terminal/stop', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'stopped' }) })
  )

  // Search web
  await page.route('**/api/search/web', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    })
  )

  // Search deep
  await page.route('**/api/search/deep', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] }),
    })
  )

  // Engine finetune
  await page.route('**/api/engine/finetune', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job_id: 'job-1', status: 'starting', job_name: 'test-job' }),
    })
  )

  // Engine job status
  await page.route('**/api/engine/jobs/*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'not_found', progress: 0 }),
    })
  )

  // Engine model export
  await page.route('**/api/engine/models/export', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'exported', path: '/mock/exports/model-4bit' }),
    })
  )

  // Data preparation
  await page.route('**/api/preparation/preview', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        columns: ['instruction', 'input', 'output'],
        rows: [
          ['What is 2+2?', '', '4'],
          ['Translate hello', 'English to Spanish', 'Hola'],
        ],
      }),
    })
  )

  await page.route('**/api/preparation/convert', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'converted', rows_processed: 100, rows_skipped: 2 }),
    })
  )

  // Sandbox
  await page.route('**/api/sandbox/check', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ valid: true, language: 'python' }),
    })
  )

  await page.route('**/api/sandbox/run', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ stdout: 'hello world\n', stderr: '', exit_code: 0 }),
    })
  )
}

/* ── Navigation helper ────────────────────────────────────── */

/** Click a sidebar navigation item by label text. */
export async function navigateTo(page: Page, label: string) {
  const navBtn = page.locator(`nav >> role=button[name="${label}"]`)
  if (await navBtn.count() > 0) {
    await navBtn.click()
  } else {
    // Settings lives outside <nav>
    await page.locator(`role=button[name="${label}"]`).first().click()
  }
}

/** Set up workspace directory in localStorage for Code workspace tests. */
export async function setupWorkspace(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem('silicon-studio-workspace-dir', '/mock/project')
    window.dispatchEvent(new CustomEvent('workspace-dir-changed', { detail: '/mock/project' }))
  })
}
