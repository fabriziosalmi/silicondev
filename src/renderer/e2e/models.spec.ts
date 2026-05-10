import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
  // Default tab is Chat — navigate to Models for these tests
  await navigateTo(page, 'Models')
  await expect(page.getByText('My Models').first()).toBeVisible({ timeout: 5000 })
  // Discover is now the default tab; jump to My Models for the assertions below.
  await page.getByText('My Models').first().click()
})

test.describe('Models Page', () => {
  test('shows downloaded model name', async ({ page }) => {
    // data-testid scopes the selector to the My Models row, ignoring any
    // <option> with the same text inside hidden <select> elsewhere.
    await expect(page.getByTestId('my-model-name').filter({ hasText: 'Llama 3.2 3B Instruct' })).toBeVisible({ timeout: 5000 })
  })

  test('shows model size 1.8GB', async ({ page }) => {
    // The size appears in the model details area (not just button text)
    await expect(page.locator('div, span, td, p').filter({ hasText: '1.8GB' }).first()).toBeVisible({ timeout: 5000 })
  })

  test('shows search input with Search placeholder', async ({ page }) => {
    await expect(page.locator('input[placeholder*="Search"]')).toBeVisible({ timeout: 5000 })
  })

  test('search filters models — matching and non-matching', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"]').first()
    const llamaRow = page.getByTestId('my-model-name').filter({ hasText: 'Llama 3.2 3B Instruct' })

    // "llama" matches the downloaded model
    await searchInput.fill('llama')
    await expect(llamaRow).toBeVisible({ timeout: 5000 })

    // nonsense query hides the model
    await searchInput.fill('xyznonexistent')
    await expect(llamaRow).toBeHidden({ timeout: 5000 })
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
