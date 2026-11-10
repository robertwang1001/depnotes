import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
import { matchesSource } from './source-assertions.js'

const base = new URL('../public/', import.meta.url)
const [html, css, js, format] = await Promise.all([
  'index.html',
  'style.css',
  'app.js',
  'format.js',
].map(x => fs.readFile(new URL(x, base), 'utf8')))
test('settings dialog accessible and linked from header', () => {
  assert.match(html, /id="settings-open"/)
  assert.match(html, /<dialog[^>]*id="settings-dialog"[^>]*aria-labelledby="settings-title"/)
  assert.match(html, /id="settings-form"/)
  assert.match(html, /id="settings-defaults"/)
})
test('viewport shell and independent panel scrollers', () => {
  assert.match(css, /height:100dvh/)
  assert.match(html, /tw:lg:overflow-y-auto/)
  assert.match(html, /tw:lg:overflow-y-auto/)
  assert.match(html, /tw:overflow-y-auto/)
})
test('human readable times and settings persistence', () => {
  matchesSource(format, /Intl\.RelativeTimeFormat/)
  matchesSource(js, /duration\(Number\(config\.minimumReleaseAge/)
  matchesSource(js, /fetch\(`\/api\/settings\?scope=\$\{/)
  assert.match(html, /id="settings-scope"/)
  assert.match(html, /id="setting-theme"/)
})
