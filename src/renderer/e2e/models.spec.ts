import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
  // Default tab is Chat — navigate to Models for these tests
  await navigateTo(page, 'Models')
  await expect(page.getByText('My Models').first()).toBeVisible({ timeout: 5000 })
})

test.describe('Models Page', () => {
  test('shows downloaded model name', async ({ page }) => {
    await expect(page.getByText('Llama 3.2 3B Instruct', { exact: true })).toBeVisible({ timeout: 5000 })
  })

  test('shows model size 1.8GB', async ({ page }) => {
    await expect(page.getByText('1.8GB', { exact: true })).toBeVisible({ timeout: 5000 })
  })

  test('shows search input with Search placeholder', async ({ page }) => {
    await expect(page.locator('input[placeholder*="Search"]')).toBeVisible({ timeout: 5000 })
  })

  test('search filters models — matching and non-matching', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"]')

    // "llama" matches the downloaded model
    await searchInput.fill('llama')
    await expect(page.getByText('Llama 3.2 3B Instruct', { exact: true })).toBeVisible({ timeout: 5000 })

    // nonsense query hides the model
    await searchInput.fill('xyznonexistent')
    await expect(page.getByText('Llama 3.2 3B Instruct', { exact: true })).toBeHidden({ timeout: 5000 })
  })

  test('has My Models and Discover tabs', async ({ page }) => {
    await expect(page.getByText('My Models').first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Discover').first()).toBeVisible({ timeout: 5000 })
  })

  test('can switch to Discover tab', async ({ page }) => {
    await page.getByText('Discover').first().click()
    await expect(page.locator('input[placeholder*="Search"]')).toBeVisible({ timeout: 5000 })
  })

  test('shows model context window and size in table', async ({ page }) => {
    // Use locators that exclude hidden option elements inside select dropdowns
    await expect(page.locator('td, span, div, p').filter({ hasText: '4096' }).first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('td, span, div, p').filter({ hasText: '1.8GB' }).first()).toBeVisible({ timeout: 5000 })
  })
})
