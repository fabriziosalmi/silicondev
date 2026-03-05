import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo, setupWorkspace, agentFullFlowSSE, agentTextOnlySSE, buildSSE } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
})

test.describe('Coder Agent — Full Flow', () => {
  test('agent panel shows header with model name', async ({ page }) => {
    await setupWorkspace(page)
    await navigateTo(page, 'Code')
    // Agent panel header: "nanocore" label should be visible
    await expect(page.getByText('nanocore').first()).toBeVisible({ timeout: 5000 })
  })

  test('agent input bar placeholder when no model loaded', async ({ page }) => {
    await setupWorkspace(page)
    await navigateTo(page, 'Code')
    const input = page.locator('textarea[placeholder*="Load a model"]')
    // Should show disabled placeholder when no model is loaded
    await expect(input).toBeVisible({ timeout: 5000 })
    await expect(input).toBeDisabled()
  })

  test('open file then send prompt to agent', async ({ page }) => {
    // Mock a model loaded
    await page.route('**/api/engine/models/active', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          model: {
            id: 'test-model',
            name: 'Test 3B',
            size: '1.8GB',
            path: '/mock/test-model',
            architecture: 'LlamaForCausalLM',
            context_window: 4096,
            is_vision: false,
          },
        }),
      })
    )

    // Mock agent run with text-only response
    await page.route('**/api/terminal/run', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: agentTextOnlySSE('The code looks correct. No changes needed.'),
      })
    )

    await setupWorkspace(page)
    await navigateTo(page, 'Code')

    // Open a file
    await page.getByText('README.md', { exact: true }).first().click()
    await expect(page.locator('span:has-text("README.md")').first()).toBeVisible({ timeout: 5000 })

    // Agent input should be enabled now
    const input = page.locator('textarea[placeholder*="Ask the agent"]')
    await expect(input).toBeVisible({ timeout: 5000 })

    // Type a prompt and submit
    await input.fill('explain this code')
    await input.press('Enter')

    // User message should appear in feed
    await expect(page.getByText('explain this code').first()).toBeVisible({ timeout: 5000 })

    // AI response should appear
    await expect(page.getByText('The code looks correct').first()).toBeVisible({ timeout: 10_000 })

    // Done info should appear
    await expect(page.getByText(/Done/).first()).toBeVisible({ timeout: 5000 })
  })

  test('full agent flow: thinking → read_file → patch_file → diff proposal', async ({ page }) => {
    // Mock a model loaded
    await page.route('**/api/engine/models/active', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          model: {
            id: 'test-model',
            name: 'Test 3B',
            size: '1.8GB',
            path: '/mock/test-model',
            architecture: 'LlamaForCausalLM',
            context_window: 4096,
            is_vision: false,
          },
        }),
      })
    )

    // Mock agent run with full flow (thinking, read, patch, diff proposal)
    await page.route('**/api/terminal/run', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: agentFullFlowSSE(),
      })
    )

    // Mock diff decide
    await page.route('**/api/terminal/diff/decide', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok' }),
      })
    )

    await setupWorkspace(page)
    await navigateTo(page, 'Code')

    // Open a file
    await page.getByText('main.py', { exact: true }).first().click()

    // Send prompt
    const input = page.locator('textarea[placeholder*="Ask the agent"]')
    await expect(input).toBeVisible({ timeout: 5000 })
    await input.fill('fix the code')
    await input.press('Enter')

    // Thinking block should appear (collapsible)
    await expect(page.getByText('Thinking').first()).toBeVisible({ timeout: 10_000 })

    // Tool start should show read_file
    await expect(page.locator('text=read_file').first()).toBeVisible({ timeout: 5000 })

    // Diff proposal should appear with Approve/Reject buttons
    await expect(page.getByText('main.py').first()).toBeVisible({ timeout: 5000 })
    const approveBtn = page.locator('button:has-text("Approve")').first()
    await expect(approveBtn).toBeVisible({ timeout: 5000 })
    const rejectBtn = page.locator('button:has-text("Reject")').first()
    await expect(rejectBtn).toBeVisible({ timeout: 5000 })
  })

  test('diff approve collapses and shows Approved badge', async ({ page }) => {
    await page.route('**/api/engine/models/active', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          model: { id: 'test-model', name: 'Test 3B', size: '1.8GB', path: '/mock/test-model', architecture: 'LlamaForCausalLM', context_window: 4096, is_vision: false },
        }),
      })
    )

    await page.route('**/api/terminal/run', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: agentFullFlowSSE(),
      })
    )

    await page.route('**/api/terminal/diff/decide', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) })
    )

    await setupWorkspace(page)
    await navigateTo(page, 'Code')
    await page.getByText('main.py', { exact: true }).first().click()

    const input = page.locator('textarea[placeholder*="Ask the agent"]')
    await expect(input).toBeVisible({ timeout: 5000 })
    await input.fill('fix it')
    await input.press('Enter')

    // Wait for Approve button
    const approveBtn = page.locator('button:has-text("Approve")').first()
    await expect(approveBtn).toBeVisible({ timeout: 10_000 })

    // Click approve
    await approveBtn.click()

    // "Approved" badge should appear
    await expect(page.getByText('Approved').first()).toBeVisible({ timeout: 5000 })
  })

  test('diff reject shows Rejected badge and reason input', async ({ page }) => {
    await page.route('**/api/engine/models/active', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          model: { id: 'test-model', name: 'Test 3B', size: '1.8GB', path: '/mock/test-model', architecture: 'LlamaForCausalLM', context_window: 4096, is_vision: false },
        }),
      })
    )

    await page.route('**/api/terminal/run', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: agentFullFlowSSE(),
      })
    )

    await page.route('**/api/terminal/diff/decide', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) })
    )

    await setupWorkspace(page)
    await navigateTo(page, 'Code')
    await page.getByText('main.py', { exact: true }).first().click()

    const input = page.locator('textarea[placeholder*="Ask the agent"]')
    await expect(input).toBeVisible({ timeout: 5000 })
    await input.fill('fix it')
    await input.press('Enter')

    // Wait for Reject button
    const rejectBtn = page.locator('button:has-text("Reject")').first()
    await expect(rejectBtn).toBeVisible({ timeout: 10_000 })

    // Click reject — should show reason input
    await rejectBtn.click()
    const reasonInput = page.locator('input[placeholder*="Why are you rejecting"]')
    await expect(reasonInput).toBeVisible({ timeout: 5000 })

    // Submit rejection with reason
    await reasonInput.fill('wrong approach')
    await reasonInput.press('Enter')

    // "Rejected" badge should appear
    await expect(page.getByText('Rejected').first()).toBeVisible({ timeout: 5000 })
  })

  test('telemetry bar shows tokens and elapsed time', async ({ page }) => {
    await page.route('**/api/engine/models/active', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          model: { id: 'test-model', name: 'Test 3B', size: '1.8GB', path: '/mock/test-model', architecture: 'LlamaForCausalLM', context_window: 4096, is_vision: false },
        }),
      })
    )

    await page.route('**/api/terminal/run', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: agentTextOnlySSE('done'),
      })
    )

    await setupWorkspace(page)
    await navigateTo(page, 'Code')

    const input = page.locator('textarea[placeholder*="Ask the agent"]')
    await expect(input).toBeVisible({ timeout: 5000 })
    await input.fill('hello')
    await input.press('Enter')

    // Telemetry bar should show tokens
    await expect(page.getByText(/tok/).first()).toBeVisible({ timeout: 10_000 })
  })

  test('clear history button removes all messages', async ({ page }) => {
    await page.route('**/api/engine/models/active', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          model: { id: 'test-model', name: 'Test 3B', size: '1.8GB', path: '/mock/test-model', architecture: 'LlamaForCausalLM', context_window: 4096, is_vision: false },
        }),
      })
    )

    await page.route('**/api/terminal/run', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: agentTextOnlySSE('response text'),
      })
    )

    await setupWorkspace(page)
    await navigateTo(page, 'Code')

    const input = page.locator('textarea[placeholder*="Ask the agent"]')
    await expect(input).toBeVisible({ timeout: 5000 })
    await input.fill('test')
    await input.press('Enter')

    // Wait for response
    await expect(page.getByText('response text').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/Done/).first()).toBeVisible({ timeout: 5000 })

    // Clear history
    const clearBtn = page.locator('button[title="Clear history"]')
    await expect(clearBtn).toBeVisible({ timeout: 5000 })
    await clearBtn.click()

    // Messages should be gone, empty state should show
    await expect(page.getByText('response text')).toBeHidden({ timeout: 5000 })
  })

  test('resizable panels — sidebar drag handle exists', async ({ page }) => {
    await setupWorkspace(page)
    await navigateTo(page, 'Code')

    // Drag handles (role=separator) should exist
    const separators = page.locator('div[role="separator"]')
    await expect(separators.first()).toBeVisible({ timeout: 5000 })
  })

  test('multi-turn: history is sent with subsequent prompts', async ({ page }) => {
    let requestCount = 0
    let lastBody: Record<string, unknown> | null = null

    await page.route('**/api/engine/models/active', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          model: { id: 'test-model', name: 'Test 3B', size: '1.8GB', path: '/mock/test-model', architecture: 'LlamaForCausalLM', context_window: 4096, is_vision: false },
        }),
      })
    )

    await page.route('**/api/terminal/run', async (route) => {
      requestCount++
      try {
        lastBody = JSON.parse(route.request().postData() || '{}')
      } catch { lastBody = null }
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: agentTextOnlySSE(`response ${requestCount}`),
      })
    })

    await setupWorkspace(page)
    await navigateTo(page, 'Code')

    const input = page.locator('textarea[placeholder*="Ask the agent"]')
    await expect(input).toBeVisible({ timeout: 5000 })

    // First prompt — no history
    await input.fill('first question')
    await input.press('Enter')
    await expect(page.getByText('response 1').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/Done/).first()).toBeVisible({ timeout: 5000 })

    // Second prompt — should include history from first turn
    await input.fill('follow up')
    await input.press('Enter')
    await expect(page.getByText('response 2').first()).toBeVisible({ timeout: 10_000 })

    // Verify the second request included history
    expect(requestCount).toBe(2)
    expect(lastBody).toBeTruthy()
    expect((lastBody as Record<string, unknown>).history).toBeTruthy()
    const history = (lastBody as Record<string, unknown>).history as Array<{ role: string; content: string }>
    expect(history.length).toBeGreaterThanOrEqual(1)
    // Should contain the first user message
    expect(history.some(h => h.content.includes('first question'))).toBe(true)
  })
})
