import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
})

test.describe('Model Export Page', () => {
  test('shows header h2 "Model Export"', async ({ page }) => {
    await navigateTo(page, 'Model Export')
    await expect(page.locator('h2:has-text("Model Export")')).toBeVisible({ timeout: 5000 })
  })

  test('shows quantization options with 4-bit', async ({ page }) => {
    await navigateTo(page, 'Model Export')
    await expect(
      page.getByText('4-bit').or(page.getByText('4 bit')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('has an Export button', async ({ page }) => {
    await navigateTo(page, 'Model Export')
    await expect(page.locator('button:has-text("Export")')).toBeVisible({ timeout: 5000 })
  })
})
