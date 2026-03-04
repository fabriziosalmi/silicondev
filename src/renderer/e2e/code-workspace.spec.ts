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
    await expect(page.getByText('No workspace configured').first()).toBeVisible({ timeout: 5000 })
  })

  test('shows file tree when workspace is set', async ({ page }) => {
    await setupWorkspace(page)
    await navigateTo(page, 'Code')
    await expect(page.getByText('src', { exact: true }).first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('README.md', { exact: true }).first()).toBeVisible({ timeout: 5000 })
  })

  test('expand and collapse folder', async ({ page }) => {
    await setupWorkspace(page)
    await navigateTo(page, 'Code')
    // depth-0 folders start expanded, so main.py should be visible
    await expect(page.getByText('main.py', { exact: true }).first()).toBeVisible({ timeout: 5000 })

    // Click src folder to collapse
    const srcFolder = page.locator('div[role="button"]').filter({ hasText: /^src$/ }).first()
    await srcFolder.click()
    await expect(page.getByText('main.py', { exact: true })).toBeHidden({ timeout: 5000 })

    // Click again to expand
    await srcFolder.click()
    await expect(page.getByText('main.py', { exact: true }).first()).toBeVisible({ timeout: 5000 })
  })

  test('click file opens tab', async ({ page }) => {
    await setupWorkspace(page)
    await navigateTo(page, 'Code')
    await expect(page.getByText('README.md', { exact: true }).first()).toBeVisible({ timeout: 5000 })
    await page.getByText('README.md', { exact: true }).first().click()
    await expect(page.locator('span:has-text("README.md")').first()).toBeVisible({ timeout: 5000 })
  })

  test('agent panel toggle', async ({ page }) => {
    await setupWorkspace(page)
    await navigateTo(page, 'Code')

    // Agent panel is open by default, so "Hide agent" button should be visible
    const toggleBtn = page.locator('button[title="Hide agent"], button[title="Show agent"]').first()
    await expect(toggleBtn).toBeVisible({ timeout: 5000 })

    // Click to hide the agent panel
    await toggleBtn.click()
    // After hiding, the button title changes to "Show agent"
    await expect(page.locator('button[title="Show agent"]').first()).toBeVisible({ timeout: 5000 })

    // Click again to show the agent panel
    await page.locator('button[title="Show agent"]').first().click()
    await expect(page.locator('button[title="Hide agent"]').first()).toBeVisible({ timeout: 5000 })
  })
})
