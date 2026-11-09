import { VERSION } from './version.js'

// Bounded metadata cache with conditional validation, in-flight deduplication,
// and limited retries for transient registry/GitHub failures. No disk writes.
interface FetchResponse {
  ok: boolean
  status?: number
  headers?: {
    get: (name: string) => string | null
  }
  json: () => Promise<unknown>
}
interface ClientOptions {
  fetchImpl?: (url: string, options: {
    headers: Record<string, string>
    signal: AbortSignal
  }) => Promise<FetchResponse>
  ttl?: number
  timeout?: number
  retries?: number
  maxEntries?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}
interface CacheEntry {
  time: number
  value: unknown
  etag: string | null
}
export function createClient({ fetchImpl = globalThis.fetch, ttl = 300000, timeout = 12000, retries = 2, maxEntries = 300, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }: ClientOptions = {}) {
  const cache = new Map<string, CacheEntry>()
  const pending = new Map<string, Promise<unknown>>()
  const stats = {
    requests: 0,
    hits: 0,
    revalidated: 0,
    retries: 0,
    failures: 0,
  }
  function cacheSet(key: string, entry: CacheEntry) {
    cache.delete(key)
    cache.set(key, entry)
    while (cache.size > maxEntries)
      cache.delete(cache.keys().next().value!)
  }
  const retryable = new Set([429, 500, 502, 503, 504])
  function retryDelay(response: FetchResponse | undefined, attempt: number) {
    const header = response?.headers?.get?.('retry-after')
    if (header) {
      const seconds = Number(header)
      if (Number.isFinite(seconds) && seconds >= 0)
        return Math.min(2000, seconds * 1000)
      const date = Date.parse(header)
      if (Number.isFinite(date))
        return Math.max(0, Math.min(2000, date - now()))
    }
    return Math.min(2000, 200 * 2 ** attempt)
  }
  async function json(url: string, headers: Record<string, string> = {}) {
    // Never cache or deduplicate across credentials or different Accept headers.
    const key = JSON.stringify([url, headers.Authorization || '', headers.Accept || ''])
    const hit = cache.get(key)
    if (hit && now() - hit.time < ttl) {
      stats.hits++
      cacheSet(key, hit)
      return hit.value
    }
    if (pending.has(key)) {
      stats.hits++
      return pending.get(key)
    }
    const task = (async () => {
      for (let attempt = 0; attempt <= retries; attempt++) {
        let response
        try {
          const requestHeaders: Record<string, string> = { 'User-Agent': `depnotes/${VERSION}`, 'Accept': 'application/json', ...headers }
          if (hit?.etag)
            requestHeaders['If-None-Match'] = hit.etag
          stats.requests++
          response = await fetchImpl(url, {
            headers: requestHeaders,
            signal: AbortSignal.timeout(timeout),
          })
          if (response.status === 304 && hit) {
            stats.revalidated++
            cacheSet(key, {
              ...hit,
              time: now(),
            })
            return hit.value
          }
          if (!response.ok) {
            if (response.status !== undefined && retryable.has(response.status) && attempt < retries) {
              stats.retries++
              await sleep(retryDelay(response, attempt))
              continue
            }
            throw new Error(`HTTP ${response.status} fetching ${new URL(url).hostname}`)
          }
          const value = await response.json()
          cacheSet(key, {
            time: now(),
            value,
            etag: response.headers?.get?.('etag') || null,
          })
          return value
        }
        catch (error) {
          // Retry only transient network failures, not bad JSON or client errors.
          const isNetworkFailure = !response && (error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError'))
          if (isNetworkFailure && attempt < retries) {
            stats.retries++
            await sleep(Math.min(2000, 200 * 2 ** attempt))
            continue
          }
          stats.failures++
          throw error
        }
      }
    })()
    pending.set(key, task)
    try {
      return await task
    }
    finally {
      pending.delete(key)
    }
  }
  return {
    json,
    metrics: () => ({ ...stats, entries: cache.size, inFlight: pending.size }),
  }
}
