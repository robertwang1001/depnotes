import assert from 'node:assert/strict'
import test from 'node:test'
import { openBrowser, parseArgs } from '../bin/cli.js'
import { createClient, mapLimit } from '../src/core.js'

test('parses commands and flags', () => {
  const parsed = parseArgs([
    'list',
    '--dir',
    './example',
    '--json',
    '--all',
  ])
  assert.equal(parsed.command, 'list')
  assert.equal(parsed.json, true)
  assert.equal(parsed.all, true)
  assert.ok(parsed.dir.endsWith('example'))
  assert.equal(parseArgs(['check', '@scope/pkg']).package, '@scope/pkg')
  assert.equal(parseArgs(['--no-open', '--port', '4177']).port, 4177)
  assert.equal(parseArgs(['--no-open']).open, false)
})
test('rejects unknown options and invalid ports', () => {
  assert.throws(() => parseArgs(['--unused']), /Unknown option/)
  assert.throws(() => parseArgs(['--port', '70000']), /Port/)
  assert.throws(() => parseArgs(['check']), /requires a package/)
})
test('browser launch uses operating system handler without a shell on unix', () => {
  const calls: {
    cmd: string
    args: string[]
    opts: unknown
  }[] = []
  openBrowser('http://127.0.0.1:4177', {
    platform: 'darwin',
    spawnImpl: (cmd, args, opts) => {
      calls.push({ cmd, args, opts })
      return {
        on() {
        },
        unref() {
        },
      }
    },
  })
  assert.equal(calls[0].cmd, 'open')
  assert.deepEqual(calls[0].args, ['http://127.0.0.1:4177'])
})
test('bounded concurrency retains input order', async () => {
  let active = 0
  let max = 0
  const results = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
    active++
    max = Math.max(max, active)
    await new Promise(resolve => setTimeout(resolve, 2))
    active--
    return n * 2
  })
  assert.deepEqual(results, [2, 4, 6, 8, 10])
  assert.ok(max <= 2)
})
test('client deduplicates concurrent identical requests', async () => {
  let calls = 0
  const client = createClient({
    fetchImpl: async () => {
      calls++
      return {
        ok: true,
        json: async () => ({ value: 1 }),
      }
    },
  })
  const [a, b] = await Promise.all([
    client.json('https://registry.npmjs.org/test'),
    client.json('https://registry.npmjs.org/test'),
  ])
  assert.equal(calls, 1)
  assert.deepEqual(a, b)
})
