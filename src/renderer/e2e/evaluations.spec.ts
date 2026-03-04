import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
})

test.describe('Model Evaluations Page', () => {
  test('shows "Quick Smoke Tests" text', async ({ page }) => {
    await navigateTo(page, 'Model Evaluations')
    await expect(page.getByText('Quick Smoke Tests').first()).toBeVisible({ timeout: 5000 })
  })

  test('shows all 4 test categories', async ({ page }) => {
    await navigateTo(page, 'Model Evaluations')
    await expect(page.getByText('General Knowledge').first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Common Sense').first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Code Generation').first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Factuality').first()).toBeVisible({ timeout: 5000 })
  })
})
