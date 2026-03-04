import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
})

test.describe('Fine-Tuning Engine Page', () => {
  test('shows Job Configuration section', async ({ page }) => {
    await navigateTo(page, 'Fine-Tuning Engine')
    await expect(page.getByText('Job Configuration').first()).toBeVisible({ timeout: 5000 })
  })

  test('shows Hyperparameters and LoRA Specifics sections', async ({ page }) => {
    await navigateTo(page, 'Fine-Tuning Engine')
    await expect(page.getByText('Hyperparameters', { exact: true }).first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('LoRA Specifics').first()).toBeVisible({ timeout: 5000 })
  })

  test('has preset selector defaulting to balanced', async ({ page }) => {
    await navigateTo(page, 'Fine-Tuning Engine')
    const presetSelect = page.locator('select[title="Hyperparameters Preset"]')
    await expect(presetSelect).toBeVisible({ timeout: 5000 })
    await expect(presetSelect).toHaveValue('balanced')
  })

  test('preset selector can change to draft', async ({ page }) => {
    await navigateTo(page, 'Fine-Tuning Engine')
    const presetSelect = page.locator('select[title="Hyperparameters Preset"]')
    await presetSelect.selectOption('draft')
    await expect(presetSelect).toHaveValue('draft')
  })

  test('has Start Training Job button', async ({ page }) => {
    await navigateTo(page, 'Fine-Tuning Engine')
    await expect(page.locator('button:has-text("Start Training Job")').first()).toBeVisible({ timeout: 5000 })
  })

  test('shows Real-time Training Loss chart area', async ({ page }) => {
    await navigateTo(page, 'Fine-Tuning Engine')
    await expect(page.getByText('Real-time Training Loss').first()).toBeVisible({ timeout: 5000 })
  })
})
