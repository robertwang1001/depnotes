import { expect, test } from '@playwright/test'
// Uses the injected fixture client in e2e/fixture-server.ts, not live npm/GitHub.
test('progressive scan completes and reveals package updates', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Review before you upgrade.' })).toBeVisible()
  await expect(page.locator('#project')).toHaveText('depnotes-ui-fixture')
  await expect(page.locator('#list .package')).toHaveCount(2)
  await expect(page.locator('#scan-progress')).toBeHidden()
  await expect(page.getByRole('button', { name: /Rescan/ })).toBeEnabled()
})
test('reads formatted release notes after selecting a dependency', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#list .package')).toHaveCount(2)
  await page.locator('#list .package').filter({ hasText: 'react' }).click()
  await expect(page.locator('#detail')).toContainText('GitHub releases')
  const firstNote = page.locator('#detail details').first()
  await expect(firstNote).toHaveAttribute('open', '')
  await expect(firstNote.locator('strong')).toContainText('Better rendering')
})
test('rescan completes and keeps update list usable', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#list .package')).toHaveCount(2)
  await page.getByRole('button', { name: /Rescan/ }).click()
  await expect(page.getByRole('button', { name: /Rescan/ })).toBeEnabled()
  await expect(page.locator('#list .package')).toHaveCount(2)
  await expect(page.locator('#global-message')).not.toHaveClass(/error/)
})
test('settings and theme controls work', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Settings/ }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await page.getByRole('button', { name: 'Close settings' }).click()
  await page.getByLabel('Color theme').selectOption('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})
test('scan transport errors remain visible, styled, and retryable', async ({ page }) => {
  await page.route('**/api/scan/events*', route => route.fulfill({ status: 503, contentType: 'text/plain', body: 'Unavailable' }))
  await page.route('**/api/scan', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Simulated transport failure' }),
  }))
  await page.goto('/')
  await expect(page.locator('#global-message')).toContainText('Scan failed', { timeout: 15000 })
  await expect(page.locator('#global-message')).toHaveClass(/error/)
  await expect(page.getByRole('button', { name: /Rescan/ })).toBeEnabled()
})
