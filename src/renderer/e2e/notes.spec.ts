import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
})

test.describe('Notes Page', () => {
  test('shows AI Commands area with Continue Writing and Summarize', async ({ page }) => {
    await navigateTo(page, 'Notes')
    await expect(page.getByText('Continue Writing').first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Summarize', { exact: true }).first()).toBeVisible({ timeout: 5000 })
  })

  test('shows import button and export buttons', async ({ page }) => {
    await navigateTo(page, 'Notes')
    await expect(page.locator('button:has-text("Import")').first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('button:has-text(".md")').first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('button:has-text(".txt")').first()).toBeVisible({ timeout: 5000 })
  })

  test('has Send to Chat button', async ({ page }) => {
    await navigateTo(page, 'Notes')
    await expect(page.locator('button:has-text("Send to Chat")').first()).toBeVisible({ timeout: 5000 })
  })

  test('note list sidebar shows notes', async ({ page }) => {
    await navigateTo(page, 'Notes')
    await expect(page.getByText('My First Note').first()).toBeVisible({ timeout: 5000 })
  })
})
