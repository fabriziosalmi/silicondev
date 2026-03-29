import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo, setupWorkspace } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
})

test.describe('Code Workspace', () => {
  test('shows empty state when no workspace configured', async ({ page }) => {
    await page.evaluate(() => localStorage.removeItem('silicon-studio-workspace-dir'))
    await navigateTo(page, 'Code')
    // Empty state shows "Add Local Folder" button or "No active session" text
    await expect(
      page.getByText('Add Local Folder').or(page.getByText('No active session')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('shows file tree when workspace is set', async ({ page }) => {
    await setupWorkspace(page)
    await navigateTo(page, 'Code')
    await expect(page.getByText('src').first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('README.md').first()).toBeVisible({ timeout: 5000 })
  })

  test('expand and collapse folder', async ({ page }) => {
    await setupWorkspace(page)
    await navigateTo(page, 'Code')
    // depth-0 folders start expanded, so main.py should be visible
    await expect(page.getByText('main.py').first()).toBeVisible({ timeout: 5000 })

    // Click the src folder button (identified by its role=button name "src")
    const srcFolder = page.locator('role=button[name="src"]')
    await srcFolder.click()
    await expect(page.getByText('main.py')).toBeHidden({ timeout: 5000 })

    // Click again to expand
    await srcFolder.click()
    await expect(page.getByText('main.py').first()).toBeVisible({ timeout: 5000 })
  })

  test('click file opens tab', async ({ page }) => {
    await setupWorkspace(page)
    await navigateTo(page, 'Code')
    await expect(page.getByText('README.md').first()).toBeVisible({ timeout: 5000 })
    await page.getByText('README.md').first().click()
    await expect(page.locator('button:has-text("README.md"), span:has-text("README.md")').first()).toBeVisible({ timeout: 5000 })
  })

  test('agent panel shows model status', async ({ page }) => {
    await setupWorkspace(page)
    await navigateTo(page, 'Code')

    // The agent panel shows "No model loaded" message
    await expect(
      page.getByText('No model loaded').first()
    ).toBeVisible({ timeout: 5000 })
  })
})
