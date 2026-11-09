import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { matchesSource } from './source-assertions.js'

const base = new URL('../public/', import.meta.url)
test('dashboard exposes labeled controls and accessible updates', async () => {
  const html = await readFile(new URL('index.html', base), 'utf8')
  for (const id of [
    'search',
    'workspace',
    'filter',
    'sort',
    'list',
    'detail',
    'refresh',
    'load-more',
    'global-message',
  ])
    assert.match(html, new RegExp(`id="${id}"`))
  assert.match(html, /aria-live="polite"/)
  assert.match(html, /type="module"/)
})
test('dashboard uses safe text rendering and incremental rows', async () => {
  const js = await readFile(new URL('app.js', base), 'utf8') + await readFile(new URL('notes.js', base), 'utf8')
  matchesSource(js, /content\.innerHTML=html/)
  matchesSource(js, /details\.addEventListener\('toggle'/)
  matchesSource(js, /textContent/)
  matchesSource(js, /slice\(0,state\.shown\)/)
  matchesSource(js, /AbortController/)
  matchesSource(js, /aria-current/)
})
test('responsive and reduced-motion styles present', async () => {
  const css = await readFile(new URL('style.css', base), 'utf8')
  assert.match(css, /@media\(max-width:600px\)/)
  assert.match(css, /prefers-reduced-motion/)
})
test('first release note is opened, status counts drill down and release policy is shown', async () => {
  const html = await readFile(new URL('index.html', base), 'utf8')
  const js = await readFile(new URL('app.js', base), 'utf8') + await readFile(new URL('notes.js', base), 'utf8')
  assert.match(html, /id="policy"/)
  assert.match(html, /id="view-label"/)
  matchesSource(js, /let expandFirst=true/)
  matchesSource(js, /expandFirst=false/)
  matchesSource(js, /state\.statusFilter=view/)
  matchesSource(js, /state\.statusFilter==='issues'/)
})
