import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
})

test.describe('Deployment Page', () => {
  test('shows "Start Server" button', async ({ page }) => {
    await navigateTo(page, 'Deployment')
    await expect(page.locator('button:has-text("Start Server")')).toBeVisible({ timeout: 5000 })
  })

  test('host selector defaults to "127.0.0.1"', async ({ page }) => {
    await navigateTo(page, 'Deployment')
    const hostSelect = page.locator('select[title="Bind address"]')
    await expect(hostSelect).toBeVisible({ timeout: 5000 })
    await expect(hostSelect).toHaveValue('127.0.0.1')
  })

  test('host can change to "0.0.0.0"', async ({ page }) => {
    await navigateTo(page, 'Deployment')
    const hostSelect = page.locator('select[title="Bind address"]')
    await hostSelect.selectOption('0.0.0.0')
    await expect(hostSelect).toHaveValue('0.0.0.0')
  })

  test('port input defaults to "8080"', async ({ page }) => {
    await navigateTo(page, 'Deployment')
    const portInput = page.locator('input[title="Port"]')
    await expect(portInput).toBeVisible({ timeout: 5000 })
    await expect(portInput).toHaveValue('8080')
  })

  test('port accepts changes', async ({ page }) => {
    await navigateTo(page, 'Deployment')
    const portInput = page.locator('input[title="Port"]')
    await portInput.clear()
    await portInput.fill('9090')
    await expect(portInput).toHaveValue('9090')
  })
})
