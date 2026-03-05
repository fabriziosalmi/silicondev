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
    await expect(page.locator('span:text-is("$")').first()).toBeVisible({ timeout: 5000 })
  })

  test('has send button with title Send (Enter)', async ({ page }) => {
    await expect(page.locator('button[title="Send (Enter)"]')).toBeVisible({ timeout: 5000 })
  })

  test('textarea accepts input', async ({ page }) => {
    const textarea = page.locator('.px-4.py-3 textarea')
    // Force minimum height — the auto-resize effect may collapse it to 0px in headless
    await textarea.evaluate((el: HTMLTextAreaElement) => {
      el.style.height = '24px'
    })
    await textarea.fill('ls -la')
    await expect(textarea).toHaveValue('ls -la')
  })

  test('submit command shows mock output and Done info', async ({ page }) => {
    const textarea = page.locator('.px-4.py-3 textarea')
    await textarea.evaluate((el: HTMLTextAreaElement) => {
      el.style.height = '24px'
    })
    await textarea.fill('echo hello')
    await textarea.press('Enter')

    // Wait for the "Done" info item to appear (confirms SSE was consumed)
    await expect(page.getByText('Done — 0s').first()).toBeVisible({ timeout: 5000 })

    // Tool output is in a collapsed section — expand it by clicking its header
    // The collapsible header button is outside <nav>, inside the feed area
    const toolHeader = page.locator('button:has-text("Terminal")').last()
    await toolHeader.click()

    // Now the output text should be visible
    await expect(page.getByText('mock output').first()).toBeVisible({ timeout: 5000 })
  })

  test('prompt symbol $ is green', async ({ page }) => {
    const prompt = page.locator('span:text-is("$")').first()
    await expect(prompt).toBeVisible({ timeout: 5000 })
    // The prompt has class text-green-400/60
    await expect(prompt).toHaveClass(/green/)
  })
})
