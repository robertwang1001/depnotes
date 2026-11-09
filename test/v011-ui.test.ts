import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { matchesSource } from './source-assertions.js'

const root = new URL('../', import.meta.url)
const files = await Promise.all([
  'public/app.js',
  'public/index.html',
  'public/style.css',
  'src/server.js',
  'src/config.js',
].map(file => readFile(new URL(file, root), 'utf8')))
const [app, html, css, server, config] = files
test('rescan retries disconnected request without discarding previous results', () => {
  matchesSource(app, /catch\(error\)\{/)
  matchesSource(app, /fetch\('\/api\/scan'/)
  matchesSource(app, /Previous results are kept/)
  matchesSource(server, /pathname==='\/api\/health'/)
})
test('user preferences are default, project override explicit', () => {
  assert.match(html, /id="settings-scope"/)
  matchesSource(server, /scope=url.searchParams.get\('scope'\)\|\|'user'/)
  matchesSource(config, /userConfigPath/)
  matchesSource(config, /saveUserConfig/)
})
test('theme options and strongly differentiated errors', () => {
  assert.match(html, /id="theme-quick"/)
  assert.match(html, /id="setting-theme"/)
  assert.match(css, /prefers-color-scheme:light/)
  assert.match(css, /\.message\.error/)
  assert.match(css, /\.policy-value/)
})
