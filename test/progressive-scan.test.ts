import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { matchesSource } from './source-assertions.js'

const read = (file: string) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')
const [core, server, app, html, css] = await Promise.all([
  'src/core.js',
  'src/server.js',
  'public/app.js',
  'public/index.html',
  'public/style.css',
].map(read))
test('scan core publishes completion per dependency with diagnostics', () => {
  matchesSource(core, /onProgress\?\.\(\{type:'start'/)
  matchesSource(core, /onProgress\?\.\(\{type:'item'/)
  matchesSource(core, /diagnostics:\{total:items.length/)
  matchesSource(core, /mapLimit\(items, concurrency/)
})
test('SSE endpoint publishes result with proper MIME and retains JSON fallback', () => {
  matchesSource(server, /pathname==='\/api\/scan\/events'/)
  matchesSource(server, /text\/event-stream/)
  matchesSource(server, /journal.subscribe\(emit/)
  matchesSource(server, /pathname==='\/api\/scan'/)
  matchesSource(server, /clearInterval\(heartbeat\)/)
})
test('dashboard uses incremental updates and has recoverable fallback', () => {
  matchesSource(app, /new EventSource/)
  matchesSource(app, /requestAnimationFrame/)
  matchesSource(app, /stream.addEventListener\('item'/)
  matchesSource(app, /stream.addEventListener\('complete'/)
  matchesSource(app, /if\(previous\)applyScan\(previous\)/)
  matchesSource(app, /const fallback=async/)
})
test('progress and diagnostics are exposed with accessible layout', () => {
  assert.match(html, /id="scan-progress"/)
  assert.match(html, /id="diagnostics-dialog"/)
  assert.match(html, /id="diagnostics-open"/)
  assert.match(css, /\.scan-progress/)
  assert.match(css, /#diagnostics-dialog/)
  assert.match(css, /html,body\{height:100%;overflow:hidden\}/)
})
