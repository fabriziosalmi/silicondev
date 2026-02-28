import { Page } from '@playwright/test'

/**
 * Mock all backend API responses so the app can render without a real backend.
 * Call this in beforeEach for every test file.
 */
export async function mockBackendAPIs(page: Page) {
  // Health check — makes the app pass the loading screen
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
        platform: { system: 'Darwin', processor: 'Apple M3 Max' },
      }),
    })
  )

  // Engine models
  await page.route('**/api/engine/models', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'mlx-community/Llama-3.2-3B-Instruct-4bit',
            name: 'Llama 3.2 3B Instruct',
            size: '1.8GB',
            family: 'Llama',
            downloaded: true,
            downloading: false,
          },
          {
            id: 'mlx-community/Mistral-7B-Instruct-v0.3-4bit',
            name: 'Mistral 7B Instruct',
            size: '4.1GB',
            family: 'Mistral',
            downloaded: false,
            downloading: false,
          },
        ]),
      })
    }
    return route.continue()
  })

  // Deployment status
  await page.route('**/api/deployment/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ running: false, pid: null, uptime_seconds: null }),
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
        body: JSON.stringify([
          { id: 'col-1', name: 'Legal Docs', chunks: 1250, size: '12MB', lastUpdated: '2 hours ago' },
        ]),
      })
    }
    return route.continue()
  })

  // Agents
  await page.route('**/api/agents/', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    }
    return route.continue()
  })
}

/** Click a sidebar navigation item by label text. */
export async function navigateTo(page: Page, label: string) {
  await page.click(`button:has-text("${label}")`)
}
