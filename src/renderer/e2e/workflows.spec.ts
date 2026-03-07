import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
})

test.describe('MCP Servers Page', () => {
  test('shows connected servers section', async ({ page }) => {
    await navigateTo(page, 'MCP Servers')
    await expect(
      page.getByText('Connected Servers').or(page.getByText('Server Catalog')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('has search input that accepts text', async ({ page }) => {
    await navigateTo(page, 'MCP Servers')
    const searchInput = page.locator('input[placeholder*="earch"]').first()
    await searchInput.fill('filesystem')
    await expect(searchInput).toHaveValue('filesystem')
  })
})

test.describe('Pipelines & Jobs Page', () => {
  test('shows pipelines sidebar or empty state', async ({ page }) => {
    await navigateTo(page, 'Pipelines & Jobs')
    await expect(
      page.getByText('Pipelines').first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('has search input that accepts text', async ({ page }) => {
    await navigateTo(page, 'Pipelines & Jobs')
    const searchInput = page.locator('input[placeholder*="earch"]').first()
    await searchInput.fill('test')
    await expect(searchInput).toHaveValue('test')
  })
})
