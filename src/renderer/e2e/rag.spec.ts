import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
})

test.describe('RAG Knowledge Page', () => {
  test('shows "Vector Collections" text', async ({ page }) => {
    await navigateTo(page, 'RAG Knowledge')
    await expect(page.getByText('Vector Collections').first()).toBeVisible({ timeout: 5000 })
  })

  test('shows collection "Legal Docs" from mock data', async ({ page }) => {
    await navigateTo(page, 'RAG Knowledge')
    await expect(page.getByText('Legal Docs').first()).toBeVisible({ timeout: 5000 })
  })

  test('has "New Collection" button', async ({ page }) => {
    await navigateTo(page, 'RAG Knowledge')
    await expect(page.locator('button:has-text("New Collection")')).toBeVisible({ timeout: 5000 })
  })

  test('New Collection modal opens and closes', async ({ page }) => {
    await navigateTo(page, 'RAG Knowledge')
    await page.locator('button:has-text("New Collection")').click()
    await expect(page.getByText('New Vector Collection').first()).toBeVisible({ timeout: 5000 })
    await page.locator('button:has-text("Cancel")').click()
    await expect(page.getByText('New Vector Collection')).toBeHidden({ timeout: 5000 })
  })

  test('can switch to "Data Ingestion" tab', async ({ page }) => {
    await navigateTo(page, 'RAG Knowledge')
    await page.getByText('Data Ingestion').first().click()
    await expect(page.getByText('Upload Files for Embedding').first()).toBeVisible({ timeout: 5000 })
  })

  test('Data Ingestion tab has "Ingest" button', async ({ page }) => {
    await navigateTo(page, 'RAG Knowledge')
    await page.getByText('Data Ingestion').first().click()
    await expect(page.locator('button:has-text("Ingest")')).toBeVisible({ timeout: 5000 })
  })
})
