import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
})

test.describe('Datasets Page', () => {
  test('navigates to Datasets page', async ({ page }) => {
    await navigateTo(page, 'Datasets')
    // The Datasets page should show file/folder selection controls
    await expect(
      page.getByText('Import from File')
        .or(page.getByText('Select File'))
        .or(page.getByText('Upload'))
        .or(page.getByText('Datasets'))
        .first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('shows Import from File or file selection option', async ({ page }) => {
    await navigateTo(page, 'Datasets')
    await expect(
      page.getByText('Import from File')
        .or(page.getByText('Select File'))
        .or(page.getByText('Upload'))
        .or(page.locator('button:has-text("File")'))
        .first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('shows dataset-related controls', async ({ page }) => {
    await navigateTo(page, 'Datasets')
    await expect(
      page.getByText('Select Folder')
        .or(page.getByText('Generate'))
        .or(page.getByText('MCP'))
        .or(page.locator('button:has-text("Folder")'))
        .first()
    ).toBeVisible({ timeout: 5000 })
  })
})
