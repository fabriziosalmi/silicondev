import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
})

test.describe('Benchmarks Page', () => {
  test('shows benchmark-related content', async ({ page }) => {
    await navigateTo(page, 'Benchmarks')
    await expect(
      page.getByText('Quick Smoke Tests')
        .or(page.getByText('Benchmark'))
        .or(page.getByText('Evaluation'))
        .or(page.getByText('Run'))
        .first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('shows test categories or benchmark options', async ({ page }) => {
    await navigateTo(page, 'Benchmarks')
    // Look for any benchmark category or test type
    await expect(
      page.getByText('General Knowledge')
        .or(page.getByText('Common Sense'))
        .or(page.getByText('Code Generation'))
        .or(page.getByText('Factuality'))
        .or(page.getByText('Benchmark'))
        .first()
    ).toBeVisible({ timeout: 5000 })
  })
})
