import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
})

test.describe('Agent Workflows Page', () => {
  test('shows saved pipelines or agent content', async ({ page }) => {
    await navigateTo(page, 'Agent Workflows')
    await expect(
      page.getByText('Saved Pipelines').or(page.getByText('Research Agent')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('shows "Research Agent" from mock data', async ({ page }) => {
    await navigateTo(page, 'Agent Workflows')
    await expect(page.getByText('Research Agent').first()).toBeVisible({ timeout: 5000 })
  })

  test('has search input that accepts text', async ({ page }) => {
    await navigateTo(page, 'Agent Workflows')
    const searchInput = page.locator('input[placeholder*="earch"]').first()
    await searchInput.fill('research')
    await expect(searchInput).toHaveValue('research')
  })
})
