import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
  await navigateTo(page, 'Settings')
})

test.describe('Settings Page', () => {
  test('shows Chat Defaults section', async ({ page }) => {
    await expect(page.getByText('CHAT DEFAULTS').or(page.getByText('Chat Defaults')).first()).toBeVisible({ timeout: 5000 })
  })

  test('shows system prompt textarea', async ({ page }) => {
    const textarea = page.locator('textarea:visible').first()
    await expect(textarea).toBeVisible({ timeout: 5000 })
  })

  test('system prompt accepts input', async ({ page }) => {
    const textarea = page.locator('textarea:visible').first()
    await textarea.clear()
    await textarea.fill('You are a test assistant.')
    await expect(textarea).toHaveValue('You are a test assistant.')
  })

  test('shows temperature control', async ({ page }) => {
    await expect(
      page.locator('label:has-text("TEMPERATURE")').or(page.locator('label:has-text("Temperature")')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('shows max tokens control', async ({ page }) => {
    await expect(
      page.locator('label:has-text("MAX TOKENS")').or(page.locator('label:has-text("Max Tokens")')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('shows reasoning mode control', async ({ page }) => {
    await expect(
      page.locator('label:has-text("REASONING")').or(page.locator('label:has-text("Reasoning")')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('shows MCP Servers section', async ({ page }) => {
    await expect(page.getByText('MCP SERVERS').or(page.getByText('MCP Servers')).first()).toBeVisible({ timeout: 5000 })
  })

  test('shows Codebase Index section', async ({ page }) => {
    await expect(page.locator('h3:has-text("Codebase Index")')).toBeVisible({ timeout: 5000 })
  })

  test('shows Storage section', async ({ page }) => {
    await expect(page.getByText('STORAGE').or(page.getByText('Storage')).first()).toBeVisible({ timeout: 5000 })
  })

  test('shows Web Indexer section', async ({ page }) => {
    await expect(page.getByText('WEB INDEXER').or(page.getByText('Web Indexer')).first()).toBeVisible({ timeout: 5000 })
  })
})
