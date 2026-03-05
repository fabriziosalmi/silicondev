import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo, setupWorkspace, agentFullFlowSSE, agentTextOnlySSE } from './helpers'

/** Navigate to Code workspace and wait for agent panel header */
async function goToCodeWorkspace(page: import('@playwright/test').Page) {
  await setupWorkspace(page)
  await navigateTo(page, 'Code')
  // Wait for the agent panel header to be in the DOM
  await page.locator('text=nanocore').first().waitFor({ state: 'attached', timeout: 10_000 })
  await page.waitForTimeout(300)
}

/** Mock active model endpoint */
async function mockModel(page: import('@playwright/test').Page) {
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
}

/** Get the agent textarea by placeholder match */
async function getAgentInput(page: import('@playwright/test').Page, placeholderMatch = 'agent') {
  const input = page.locator(`textarea[placeholder*="${placeholderMatch}"]`).first()
  await input.waitFor({ state: 'attached', timeout: 10_000 })
  return input
}

test.describe('Coder Agent — Full Flow', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test.beforeEach(async ({ page }) => {
    await mockBackendAPIs(page)
    await page.goto('/')
    await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
  })

  test('agent panel shows header with model name', async ({ page }) => {
    await goToCodeWorkspace(page)
    // Agent panel header: "nanocore" label should be in the DOM
    const header = page.locator('span.text-blue-400:has-text("nanocore")')
    await expect(header).toBeAttached({ timeout: 5000 })
    // Verify text content
    const text = await header.textContent()
    expect(text).toContain('nanocore')
  })

  test('agent input bar placeholder when no model loaded', async ({ page }) => {
    await goToCodeWorkspace(page)
    const input = await getAgentInput(page, 'Load a model')
    await expect(input).toBeAttached({ timeout: 5000 })
    await expect(input).toBeDisabled()
  })

  test('open file then send prompt to agent', async ({ page }) => {
    await mockModel(page)

    await page.route('**/api/terminal/run', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: agentTextOnlySSE('The code looks correct. No changes needed.'),
      })
    )

    await goToCodeWorkspace(page)

    // Open a file
    await page.getByText('README.md', { exact: true }).first().click()
    await page.waitForTimeout(500)

    // Agent input should be enabled now
    const input = await getAgentInput(page, 'Ask the agent')
    await expect(input).toBeAttached({ timeout: 5000 })

    // Type a prompt and submit
    await input.fill('explain this code', { force: true })
    await input.press('Enter')

    // User message should appear in feed
    const userMsg = page.getByText('explain this code').first()
    await userMsg.waitFor({ state: 'attached', timeout: 5000 })

    // AI response should appear
    const aiResponse = page.getByText('The code looks correct').first()
    await aiResponse.waitFor({ state: 'attached', timeout: 10_000 })

    // Done info should appear
    const doneMsg = page.getByText(/Done/).first()
    await doneMsg.waitFor({ state: 'attached', timeout: 5000 })
  })

  test('full agent flow: thinking → read_file → patch_file → diff proposal', async ({ page }) => {
    await mockModel(page)

    await page.route('**/api/terminal/run', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: agentFullFlowSSE(),
      })
    )

    await page.route('**/api/terminal/diff/decide', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok' }),
      })
    )

    await goToCodeWorkspace(page)

    // Open a file
    await page.getByText('main.py', { exact: true }).first().click()
    await page.waitForTimeout(500)

    // Send prompt
    const input = await getAgentInput(page, 'Ask the agent')
    await input.fill('fix the code', { force: true })
    await input.press('Enter')

    // Thinking block should appear
    await page.locator('text=Thinking').first().waitFor({ state: 'attached', timeout: 10_000 })

    // Tool start should show read_file
    await page.locator('text=read_file').first().waitFor({ state: 'attached', timeout: 5000 })

    // Diff proposal should appear with Approve/Reject buttons
    const approveBtn = page.locator('button:has-text("Approve")').first()
    await approveBtn.waitFor({ state: 'attached', timeout: 5000 })
    const rejectBtn = page.locator('button:has-text("Reject")').first()
    await rejectBtn.waitFor({ state: 'attached', timeout: 5000 })
  })

  test('diff approve collapses and shows Approved badge', async ({ page }) => {
    await mockModel(page)

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

    await goToCodeWorkspace(page)
    await page.getByText('main.py', { exact: true }).first().click()
    await page.waitForTimeout(500)

    const input = await getAgentInput(page, 'Ask the agent')
    await input.fill('fix it', { force: true })
    await input.press('Enter')

    // Wait for Approve button
    const approveBtn = page.locator('button:has-text("Approve")').first()
    await approveBtn.waitFor({ state: 'attached', timeout: 10_000 })

    // Click approve
    await approveBtn.click({ force: true })

    // "Approved" badge should appear
    await page.getByText('Approved').first().waitFor({ state: 'attached', timeout: 5000 })
  })

  test('diff reject button is available alongside approve', async ({ page }) => {
    await mockModel(page)

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

    await goToCodeWorkspace(page)
    await page.getByText('main.py', { exact: true }).first().click()
    await page.waitForTimeout(500)

    const input = await getAgentInput(page, 'Ask the agent')
    await input.fill('fix it', { force: true })
    await input.press('Enter')

    // Both Approve and Reject buttons should be present
    const approveBtn = page.locator('button:has-text("Approve")').first()
    const rejectBtn = page.locator('button:has-text("Reject")').first()
    await approveBtn.waitFor({ state: 'attached', timeout: 10_000 })
    await rejectBtn.waitFor({ state: 'attached', timeout: 5000 })

    // Diff content should be visible (file path in header)
    await page.locator('text=main.py').first().waitFor({ state: 'attached', timeout: 5000 })
  })

  test('telemetry bar shows tokens and elapsed time', async ({ page }) => {
    await mockModel(page)

    await page.route('**/api/terminal/run', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: agentTextOnlySSE('done'),
      })
    )

    await goToCodeWorkspace(page)

    const input = await getAgentInput(page, 'Ask the agent')
    await input.fill('hello', { force: true })
    await input.press('Enter')

    // Telemetry bar should show tokens
    await page.locator('text=/tok/').first().waitFor({ state: 'attached', timeout: 10_000 })
  })

  test('clear history button removes all messages', async ({ page }) => {
    await mockModel(page)

    await page.route('**/api/terminal/run', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: agentTextOnlySSE('response text'),
      })
    )

    await goToCodeWorkspace(page)

    const input = await getAgentInput(page, 'Ask the agent')
    await input.fill('test', { force: true })
    await input.press('Enter')

    // Wait for response
    await page.getByText('response text').first().waitFor({ state: 'attached', timeout: 10_000 })
    await page.getByText(/Done/).first().waitFor({ state: 'attached', timeout: 5000 })

    // Clear history
    const clearBtn = page.locator('button[title="Clear history"]')
    await clearBtn.waitFor({ state: 'attached', timeout: 5000 })
    await clearBtn.click({ force: true })

    // Messages should be gone
    await expect(page.getByText('response text')).toHaveCount(0, { timeout: 5000 })
  })

  test('resizable panels — sidebar drag handle exists', async ({ page }) => {
    await goToCodeWorkspace(page)

    // Drag handles (role=separator) should exist
    const separators = page.locator('div[role="separator"]')
    await expect(separators.first()).toBeAttached({ timeout: 5000 })
  })

  test('multi-turn: history is sent with subsequent prompts', async ({ page }) => {
    let requestCount = 0
    let lastBody: Record<string, unknown> | null = null

    await mockModel(page)

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

    await goToCodeWorkspace(page)

    const input = await getAgentInput(page, 'Ask the agent')

    // First prompt — no history
    await input.fill('first question', { force: true })
    await input.press('Enter')
    await page.getByText('response 1').first().waitFor({ state: 'attached', timeout: 10_000 })
    await page.getByText(/Done/).first().waitFor({ state: 'attached', timeout: 5000 })

    // Second prompt — should include history from first turn
    await input.fill('follow up', { force: true })
    await input.press('Enter')
    await page.getByText('response 2').first().waitFor({ state: 'attached', timeout: 10_000 })

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
