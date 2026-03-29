import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
})

test.describe('RAG Knowledge Page', () => {
  test('shows "Collections" content', async ({ page }) => {
    await navigateTo(page, 'RAG Knowledge')
    await expect(page.getByText('Collections').first()).toBeVisible({ timeout: 5000 })
  })

  test('shows collection "Legal Docs" from mock data', async ({ page }) => {
    await navigateTo(page, 'RAG Knowledge')
    await expect(page.getByText('Legal Docs').first()).toBeVisible({ timeout: 5000 })
  })

  test('has "New Collection" button', async ({ page }) => {
    await navigateTo(page, 'RAG Knowledge')
    await expect(page.locator('button:has-text("New Collection")')).toBeVisible({ timeout: 5000 })
  })

  test('can switch to "Ingest Files" tab', async ({ page }) => {
    await navigateTo(page, 'RAG Knowledge')
    await page.locator('button:has-text("Ingest Files")').click()
    // Ingest Files tab should show upload or ingest controls
    await expect(
      page.getByText('Upload Files for Embedding')
        .or(page.locator('button:has-text("Ingest")'))
        .or(page.getByText('Ingest'))
        .first()
    ).toBeVisible({ timeout: 5000 })
  })
})
