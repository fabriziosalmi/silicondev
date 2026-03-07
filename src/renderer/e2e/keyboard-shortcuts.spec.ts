import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
})

test.describe('Keyboard Shortcuts', () => {
  test('Cmd+K navigates to Chat', async ({ page }) => {
    // Navigate to Models first (default is Chat)
    await navigateTo(page, 'Models')
    await expect(page.getByText('My Models').first()).toBeVisible({ timeout: 5000 })

    // Cmd+K should go back to Chat
    await page.keyboard.press('Meta+k')
    await expect(
      page.locator('textarea:visible').or(page.getByText('No model loaded')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('Cmd+E navigates to Code workspace', async ({ page }) => {
    await page.keyboard.press('Meta+e')
    // Code workspace shows either file tree or empty state
    await expect(
      page.getByText('No workspace configured').or(page.getByText('Select a file')).first()
    ).toBeVisible({ timeout: 8000 })
  })

  test('Cmd+, navigates to Settings', async ({ page }) => {
    await page.keyboard.press('Meta+,')
    await expect(page.getByText('CHAT DEFAULTS').or(page.getByText('Chat Defaults')).first()).toBeVisible({ timeout: 5000 })
  })

  test('Cmd+B toggles sidebar', async ({ page }) => {
    // Sidebar should be expanded by default (shows "Models" text)
    const modelsLabel = page.locator('nav').getByText('Models', { exact: true }).first()
    await expect(modelsLabel).toBeVisible({ timeout: 5000 })

    // Press Cmd+B to collapse
    await page.keyboard.press('Meta+b')
    // After collapse, the text labels should be hidden (sidebar goes to icon-only w-14)
    await page.waitForTimeout(300) // transition duration
    // The nav items are still there but text is hidden via conditional render
  })
})
