import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { matchesSource } from './source-assertions.js'

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
const logo = readFileSync(new URL('../public/logo.svg', import.meta.url), 'utf8')
test('dashboard uses accessible SVG brand assets', () => {
  assert.match(html, /src="\/logo\.svg"/)
  assert.match(html, /rel="icon"/)
  assert.match(logo, /<svg/)
  assert.match(logo, /<title/)
  assert.doesNotMatch(logo, /<script|onload=/i)
})
test('local server explicitly serves both SVG assets', () => {
  const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8')
  matchesSource(server, /'\/logo\.svg':'logo\.svg'/)
  matchesSource(server, /'\/favicon\.svg':'favicon\.svg'/)
  matchesSource(server, /image\/svg\+xml/)
})
