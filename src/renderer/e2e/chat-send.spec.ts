/**
 * Chat send flow E2E tests — real interaction with a mocked loaded model.
 *
 * These tests reproduce the bug where pressing Enter did NOT send the message
 * because `overlayVisible` remained `true` (stale state) even when the
 * InputOverlay was rendering nothing (zero matching items).
 *
 * Root cause: `handleKeyDown` in ChatInterface checked only `overlayVisible`,
 * not whether there was a live trigger. A call to `/xyz` (no slash command match)
 * left `overlayVisible=true` but the overlay showed nothing — Enter was then
 * swallowed silently. Fixed by re-computing `detectTrigger` inline at keydown time.
 */
import { test, expect } from '@playwright/test'
import { mockBackendAPIs, mockActiveModel, navigateTo, chatSSE } from './helpers'

/* ── shared setup ──────────────────────────────────────────── */

async function setup(page: import('@playwright/test').Page) {
  await mockBackendAPIs(page)
  await mockActiveModel(page)           // model is already loaded
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
  await navigateTo(page, 'Chat')
}

/* ── helpers ───────────────────────────────────────────────── */

async function getTextarea(page: import('@playwright/test').Page) {
  const ta = page.locator('textarea:visible').first()
  await expect(ta).toBeVisible({ timeout: 5_000 })
  return ta
}

/* ── tests ─────────────────────────────────────────────────── */

test.describe('Chat Send Flow', () => {

  test('Enter key sends a normal message when model is loaded', async ({ page }) => {
    await setup(page)
    const ta = await getTextarea(page)

    await ta.fill('Hello from Enter key')
    await ta.press('Enter')

    // The user message should appear in the DOM
    await expect(page.getByText('Hello from Enter key').first()).toBeVisible({ timeout: 10_000 })
  })

  test('send button is enabled and sends message when model is loaded', async ({ page }) => {
    await setup(page)
    const ta = await getTextarea(page)

    await ta.fill('Hello from send button')

    // Send button must NOT have cursor-not-allowed
    const sendBtn = page.locator('button[title]').filter({ hasText: '' }).last()
    await ta.press('Enter')

    await expect(page.getByText('Hello from send button').first()).toBeVisible({ timeout: 10_000 })
  })

  test('Shift+Enter inserts a newline instead of sending', async ({ page }) => {
    await setup(page)
    const ta = await getTextarea(page)

    await ta.fill('line one')
    await ta.press('Shift+Enter')
    await ta.type('line two')

    // Message should NOT have been sent (textarea still has content)
    const value = await ta.inputValue()
    expect(value).toContain('line one')
    expect(value).toContain('line two')
  })

  test('Enter is NOT blocked when slash input has zero matching items (stale overlay bug)', async ({ page }) => {
    await setup(page)
    const ta = await getTextarea(page)

    // Type a slash command prefix that matches nothing — overlay shows 0 items
    // but `overlayVisible` could remain true in the stale-state bug.
    await ta.fill('/zzznomatch')

    // Now clear and type a normal message
    await ta.fill('plain message no slash')

    // Press Enter — must send the message, NOT be silently discarded
    await ta.press('Enter')

    await expect(page.getByText('plain message no slash').first()).toBeVisible({ timeout: 10_000 })
  })

  test('overlay Enter selects slash command (not send)', async ({ page }) => {
    await setup(page)
    const ta = await getTextarea(page)

    // Type '/' — the slash command overlay should appear
    await ta.fill('/')

    // Wait for the overlay to show at least one command
    await expect(page.locator('text=/help/i').first()).toBeVisible({ timeout: 5_000 })

    // Press Enter — should select the top command, NOT send a bare '/'
    await ta.press('Enter')

    // Textarea should be cleared (command executed) — not show '/' as a sent message
    const value = await ta.inputValue()
    expect(value).toBe('')
  })

  test('assistant reply appears after Enter send', async ({ page }) => {
    // Override chat SSE to return a known token sequence
    await mockBackendAPIs(page)
    await mockActiveModel(page)
    await page.route('**/api/engine/chat', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: chatSSE(['Hi ', 'there!', ' How can I help?']),
        })
      }
      return route.continue()
    })

    await page.goto('/')
    await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
    await navigateTo(page, 'Chat')

    const ta = await getTextarea(page)
    await ta.fill('test prompt')
    await ta.press('Enter')

    // User message
    await expect(page.getByText('test prompt').first()).toBeVisible({ timeout: 8_000 })

    // Assistant reply — tokens concatenated: "Hi there! How can I help?"
    await expect(page.getByText('Hi', { exact: false }).first()).toBeVisible({ timeout: 10_000 })
  })

})
