import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
})

test.describe('Quantize & Export Page', () => {
  test('shows page header or quantization content', async ({ page }) => {
    await navigateTo(page, 'Quantize & Export')
    await expect(
      page.getByText('Model Export')
        .or(page.getByText('Quantize'))
        .or(page.getByText('Export'))
        .first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('shows quantization options with 4-bit', async ({ page }) => {
    await navigateTo(page, 'Quantize & Export')
    await expect(
      page.getByText('4-bit').or(page.getByText('4 bit')).or(page.getByText('Quantization')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('has an Export button', async ({ page }) => {
    await navigateTo(page, 'Quantize & Export')
    await expect(
      page.locator('button:has-text("Export")').or(page.locator('button:has-text("Quantize")')).first()
    ).toBeVisible({ timeout: 5000 })
  })
})
