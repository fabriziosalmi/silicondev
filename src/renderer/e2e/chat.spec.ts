import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
  await navigateTo(page, 'Chat')
})

test.describe('Chat Page', () => {
  test('shows empty state No model loaded', async ({ page }) => {
    await expect(page.getByText('No model loaded').first()).toBeVisible({ timeout: 5000 })
  })

  test('textarea is visible and accepts input', async ({ page }) => {
    const textarea = page.locator('textarea:visible').first()
    await expect(textarea).toBeVisible({ timeout: 5000 })
  })

  test('parameters panel opens and shows Temperature label', async ({ page }) => {
    await page.locator('button:has-text("Parameters")').click()
    await expect(page.locator('label:has-text("Temperature")')).toBeVisible({ timeout: 5000 })
  })

  test('parameters panel shows Reasoning, Memory Map, Web Search, Syntax Check', async ({ page }) => {
    await page.locator('button:has-text("Parameters")').click()
    await expect(page.getByText('Reasoning').first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Memory Map').first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Web Search').first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Syntax Check').first()).toBeVisible({ timeout: 5000 })
  })

  test('conversation history sidebar shows Test Conversation and Pinned Chat', async ({ page }) => {
    await expect(page.getByText('Test Conversation').first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Pinned Chat').first()).toBeVisible({ timeout: 5000 })
  })

  test('search conversations input exists', async ({ page }) => {
    // Search input is hidden until the search icon is clicked
    await page.locator('button[title="Search conversations"]').first().click()
    await expect(
      page.locator('input[placeholder="Search conversations..."]')
    ).toBeVisible({ timeout: 5000 })
  })

  test('textarea accepts text input', async ({ page }) => {
    const textarea = page.locator('textarea:visible').first()
    await textarea.fill('hello world')
    await expect(textarea).toHaveValue('hello world')
  })
})
