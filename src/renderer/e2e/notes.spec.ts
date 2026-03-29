import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
})

test.describe('Notes Page', () => {
  test('shows AI Commands area with Continue and Summarize', async ({ page }) => {
    await navigateTo(page, 'Notes')
    await expect(page.locator('button:has-text("Continue")').first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('button:has-text("Summarize")').first()).toBeVisible({ timeout: 5000 })
  })

  test('shows file management buttons', async ({ page }) => {
    await navigateTo(page, 'Notes')
    // "Files" button replaced "Import", "Export" button replaced ".md"/".txt" buttons
    await expect(page.locator('button:has-text("Files")').or(page.locator('button:has-text("Import")')).first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('button:has-text("Export")').first()).toBeVisible({ timeout: 5000 })
  })

  test('has Send to Chat button', async ({ page }) => {
    await navigateTo(page, 'Notes')
    await expect(page.locator('button:has-text("Send to Chat")').first()).toBeVisible({ timeout: 5000 })
  })

  test('note list sidebar shows notes', async ({ page }) => {
    await navigateTo(page, 'Notes')
    await expect(page.getByText('My First Note').first()).toBeVisible({ timeout: 5000 })
  })
})
