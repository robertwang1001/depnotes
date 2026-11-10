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
test('mobile dashboard keeps filters and release notes reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('#list .package')).toHaveCount(2)
  await page.locator('#list .package').filter({ hasText: 'react' }).click()
  await expect(page.locator('#detail')).toContainText('GitHub releases')
  await expect(page.locator('#detail')).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
test('clicking the backdrop closes dialogs, while clicks inside do not', async ({ page }) => {
  await page.goto('/')
  for (const [open, name] of [
    ['Settings', 'Settings'],
    ['Diagnostics', 'Diagnostics'],
  ]) {
    await page.getByRole('button', { name }).click()
    const dialog = page.getByRole('dialog', { name: open })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('heading', { name: open }).click()
    await expect(dialog).toBeVisible()
    await page.mouse.click(2, 2)
    await expect(dialog).toBeHidden()
  }
})
test('successful upgrade closes the dialog and refreshes the dependency list', async ({ page, request }) => {
  const scan = await (await request.get('/api/scan')).json()
  scan.items = scan.items.filter((item: { name: string }) => item.name !== 'react')
  await page.route('**/api/upgrade/preview', route => route.fulfill({
    json: {
      token: 'preview',
      git: { state: 'clean' },
      items: [
        {
          name: 'react',
          from: '18',
          to: '19',
          workspace: 'fixture',
          section: 'dependencies',
        },
      ],
      commands: [
        { command: 'npm install react@19', importer: '.', section: 'dependencies' },
      ],
    },
  }))
  await page.route('**/api/upgrade/apply', route => route.fulfill({
    json: {
      ok: true,
      results: [
        { ok: true, command: 'npm install react@19', exitCode: 0 },
      ],
    },
  }))
  await page.route('**/api/scan/events?fresh=1', route => route.fulfill({
    contentType: 'text/event-stream',
    body: `event: complete\ndata: ${JSON.stringify({ result: scan })}\n\n`,
  }))
  await page.goto('/')
  await expect(page.locator('#list .package')).toHaveCount(2)
  await page.getByLabel(/Select react .* for upgrade/).check()
  await page.getByRole('button', { name: 'Review selected upgrades' }).click()
  await page.getByRole('button', { name: 'Upgrade selected' }).click()
  await expect(page.locator('#upgrade-dialog')).toBeHidden()
  await expect(page.locator('#list .package')).toHaveCount(1)
  await expect(page.locator('#list .package')).not.toContainText('react')
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
