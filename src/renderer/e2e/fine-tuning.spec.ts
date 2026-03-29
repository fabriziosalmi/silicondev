import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
})

test.describe('Fine-Tuning Page', () => {
  test('shows Job Configuration section', async ({ page }) => {
    await navigateTo(page, 'Fine-Tuning')
    await expect(page.getByText('Job Configuration').first()).toBeVisible({ timeout: 5000 })
  })

  test('shows Hyperparameters and LoRA Specifics sections', async ({ page }) => {
    await navigateTo(page, 'Fine-Tuning')
    await expect(page.getByText('Hyperparameters').first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('LoRA Specifics').or(page.getByText('LoRA')).first()).toBeVisible({ timeout: 5000 })
  })

  test('has preset selector defaulting to balanced', async ({ page }) => {
    await navigateTo(page, 'Fine-Tuning')
    const presetSelect = page.locator('select[title="Hyperparameters Preset"]')
    await expect(presetSelect).toBeVisible({ timeout: 5000 })
    await expect(presetSelect).toHaveValue('balanced')
  })

  test('preset selector can change to draft', async ({ page }) => {
    await navigateTo(page, 'Fine-Tuning')
    const presetSelect = page.locator('select[title="Hyperparameters Preset"]')
    await presetSelect.selectOption('draft')
    await expect(presetSelect).toHaveValue('draft')
  })

  test('has Start Training Job button', async ({ page }) => {
    await navigateTo(page, 'Fine-Tuning')
    await expect(page.locator('button:has-text("Start Training")').first()).toBeVisible({ timeout: 5000 })
  })

  test('shows training loss chart area', async ({ page }) => {
    await navigateTo(page, 'Fine-Tuning')
    // The chart area shows "Loss" heading and/or "Validation Loss" label
    await expect(
      page.locator('h3:has-text("Loss")')
        .or(page.getByText('Validation Loss'))
        .or(page.getByText('Training Loss'))
        .first()
    ).toBeVisible({ timeout: 5000 })
  })
})
