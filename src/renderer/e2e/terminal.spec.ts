import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
  await navigateTo(page, 'Terminal')
})

test.describe('Terminal Page', () => {
  test('shows input bar with $ prompt', async ({ page }) => {
    await expect(page.getByText('$').first()).toBeVisible({ timeout: 5000 })
  })

  test('has send button', async ({ page }) => {
    await expect(
      page.locator('role=button[name="Send"]').or(page.locator('button[title="Send (Enter)"]')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('textarea accepts input', async ({ page }) => {
    const textarea = page.locator('textarea').first()
    // Force minimum height — the auto-resize effect may collapse it to 0px in headless
    await textarea.evaluate((el: HTMLTextAreaElement) => {
      el.style.height = '24px'
    })
    await textarea.fill('ls -la')
    await expect(textarea).toHaveValue('ls -la')
  })

  test('submit command echoes it and shows the output', async ({ page }) => {
    const textarea = page.locator('textarea').first()
    await textarea.evaluate((el: HTMLTextAreaElement) => {
      el.style.height = '24px'
    })
    await textarea.fill('echo hello')
    await textarea.press('Enter')

    // The mocked SSE has been consumed when its tool output is on screen. This used to
    // wait for a "Done — 0s" badge, but inline terminal mode deliberately stopped
    // rendering it (AgentTerminal, case 'done') so the feed reads like a real shell —
    // the test kept waiting for something the UI no longer draws.
    await expect(page.getByText('mock output').first()).toBeVisible({ timeout: 5000 })

    // Verify the command text appears in the feed
    await expect(page.getByText('echo hello').first()).toBeVisible({ timeout: 5000 })
  })

  test('prompt symbol $ is visible', async ({ page }) => {
    await expect(page.getByText('$').first()).toBeVisible({ timeout: 5000 })
  })
})
