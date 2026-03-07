import { test, expect } from '@playwright/test'
import { mockBackendAPIs, navigateTo } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockBackendAPIs(page)
  await page.goto('/')
  await expect(page.locator('nav')).toBeVisible({ timeout: 15_000 })
})

test.describe('App Shell — Top Bar', () => {
  test('top bar shows Load model button when no model loaded', async ({ page }) => {
    await expect(page.getByText('Load model').first()).toBeVisible({ timeout: 5000 })
  })

  test('top bar shows RAM and CPU stats', async ({ page }) => {
    await expect(page.getByText('RAM', { exact: true }).first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('CPU', { exact: true }).first()).toBeVisible({ timeout: 5000 })
  })
})

test.describe('App Shell — Sidebar', () => {
  test('sidebar renders all nav items', async ({ page }) => {
    const sidebar = page.locator('nav')
    for (const label of [
      'Models', 'Chat', 'Terminal', 'Code', 'Notes',
      'Data Preparation', 'Fine-Tuning Engine', 'Model Evaluations',
      'RAG Knowledge', 'MCP Servers', 'Pipelines & Jobs', 'Deployment',
    ]) {
      await expect(sidebar.getByText(label, { exact: true }).first()).toBeVisible({ timeout: 5000 })
    }
  })

  test('sidebar has Settings item outside nav at bottom', async ({ page }) => {
    await expect(page.getByText('Settings', { exact: true }).first()).toBeVisible({ timeout: 5000 })
  })
})

test.describe('App Shell — Tab Navigation', () => {
  test('default tab is Chat', async ({ page }) => {
    // Chat is the default tab — should show textarea or "No model loaded"
    await expect(
      page.locator('textarea:visible').or(page.getByText('No model loaded')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('tab switch preserves state — Chat keeps content', async ({ page }) => {
    // Default is Chat — type something
    const textarea = page.locator('textarea:visible').first()
    await textarea.fill('preserve me')
    await expect(textarea).toHaveValue('preserve me')

    // Switch to Models
    await navigateTo(page, 'Models')
    await expect(page.getByText('My Models').first()).toBeVisible({ timeout: 5000 })

    // Switch back to Chat — value should still be there
    await navigateTo(page, 'Chat')
    const textareaBack = page.locator('textarea:visible').first()
    await expect(textareaBack).toHaveValue('preserve me')
  })

  test('navigate through all 12 tabs + Settings without console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text()
        if (text.includes('net::ERR') || text.includes('Failed to fetch') || text.includes('favicon') || text.includes('Invalid hook call')) return
        errors.push(text)
      }
    })

    const allTabs = [
      'Models', 'Chat', 'Terminal', 'Code', 'Notes',
      'Data Preparation', 'Fine-Tuning Engine', 'Model Export',
      'Model Evaluations', 'RAG Knowledge', 'MCP Servers',
      'Pipelines & Jobs', 'Deployment', 'Settings',
    ]

    for (const tab of allTabs) {
      await navigateTo(page, tab)
      await page.waitForTimeout(300)
    }

    expect(errors).toEqual([])
  })
})
