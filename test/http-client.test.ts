import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createClient } from '../src/http-client.js'

function response(data: unknown, { status = 200, etag = null, retryAfter = null }: {
  status?: number
  etag?: string | null
  retryAfter?: string | null
} = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key: string) => key === 'etag'
        ? etag
        : key === 'retry-after'
          ? retryAfter
          : null,
    },
    json: async () => data,
  }
}
test('deduplicates simultaneous requests and caches their results', async () => {
  let calls = 0
  const client = createClient({
    fetchImpl: async () => {
      calls++
      return response({ ok: true })
    },
  })
  const [a, b] = await Promise.all([
    client.json('https://example.org/pkg'),
    client.json('https://example.org/pkg'),
  ])
  assert.deepEqual(a, b)
  await client.json('https://example.org/pkg')
  assert.equal(calls, 1)
  assert.equal(client.metrics().hits, 2)
})
test('revalidates expired cache entries using ETag and handles 304', async () => {
  let tick = 1000
  const requests: Record<string, string>[] = []
  const client = createClient({
    ttl: 50,
    now: () => tick,
    fetchImpl: async (_url, options) => {
      requests.push(options.headers)
      return requests.length === 1
        ? response({ v: 2 }, { etag: '"rev2"' })
        : response(null, { status: 304 })
    },
  })
  assert.deepEqual(await client.json('https://example.org/pkg'), { v: 2 })
  tick = 1100
  assert.deepEqual(await client.json('https://example.org/pkg'), { v: 2 })
  assert.equal(requests[1]['If-None-Match'], '"rev2"')
  assert.equal(client.metrics().revalidated, 1)
})
test('retries transient 429 and 503 but never retries 404', async () => {
  let calls = 0
  const waits: number[] = []
  const client = createClient({
    sleep: async (ms) => {
      waits.push(ms)
    },
    fetchImpl: async () => {
      calls++
      return calls === 1
        ? response(null, { status: 429, retryAfter: '1' })
        : calls === 2
          ? response(null, { status: 503 })
          : response({ latest: 'ok' })
    },
  })
  assert.deepEqual(await client.json('https://example.org/pkg'), { latest: 'ok' })
  assert.equal(calls, 3)
  assert.deepEqual(waits, [1000, 400])
  assert.equal(client.metrics().retries, 2)
  const missing = createClient({
    fetchImpl: async () => {
      calls++
      return response(null, { status: 404 })
    },
  })
  await assert.rejects(missing.json('https://example.org/missing'), /HTTP 404/)
  assert.equal(calls, 4)
})
test('failed requests are not cached and distinct Accept headers have distinct keys', async () => {
  let calls = 0
  const client = createClient({
    retries: 0,
    fetchImpl: async () => {
      calls++
      if (calls === 1)
        throw new TypeError('offline')
      return response({ calls })
    },
  })
  await assert.rejects(client.json('https://example.org/pkg'), /offline/)
  assert.equal((await client.json('https://example.org/pkg') as {
    calls: number
  }).calls, 2)
  assert.equal((await client.json('https://example.org/pkg', { Accept: 'custom' }) as {
    calls: number
  }).calls, 3)
})

test('uses the package version in its HTTP user agent', async () => {
  const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
  let userAgent = ''
  const client = createClient({
    fetchImpl: async (_url, options) => {
      userAgent = options.headers['User-Agent']
      return response({})
    },
  })
  await client.json('https://example.org/pkg')
  assert.equal(userAgent, `depnotes/${version}`)
})
