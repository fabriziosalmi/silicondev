import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
})

test.describe('Data Preparation Page', () => {
  test('shows Import from File and Generate via MCP mode options', async ({ page }) => {
    await navigateTo(page, 'Data Preparation')
    await expect(page.getByText('Import from File').first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Generate via MCP').first()).toBeVisible({ timeout: 5000 })
  })

  test('shows Select File button in file mode', async ({ page }) => {
    await navigateTo(page, 'Data Preparation')
    await expect(page.getByText('Select File...').first()).toBeVisible({ timeout: 5000 })
  })

  test('shows Select Folder button in file mode', async ({ page }) => {
    await navigateTo(page, 'Data Preparation')
    await expect(page.getByText('Select Folder...').first()).toBeVisible({ timeout: 5000 })
  })
})
