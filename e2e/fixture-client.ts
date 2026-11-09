// An injectable, deterministic network client. Test executions never contact
// npm or GitHub, and all fixture data belongs to this repository.
interface FixturePackage {
  current: string
  latest: string
  repository: string
}
const installed: Record<string, FixturePackage> = {
  'react': { current: '19.0.0', latest: '19.2.0', repository: 'facebook/react' },
  'tiny-dep': { current: '1.0.0', latest: '1.1.0', repository: 'fixture/tiny-dep' },
}
const baseTime = '2025-01-01T00:00:00.000Z'
function versions(item: FixturePackage) {
  return {
    [item.current]: {
      repository: { type: 'git', url: `https://github.com/${item.repository}.git` },
    },
    [item.latest]: {
      repository: { type: 'git', url: `https://github.com/${item.repository}.git` },
    },
  }
}
export function createFixtureClient({ delayMs = 35 } = {}) {
  const metrics = {
    requests: 0,
    hits: 0,
    retries: 0,
    failures: 0,
  }
  const calls: string[] = []
  return {
    calls,
    metrics: () => ({ ...metrics }),
    async json(rawUrl: string) {
      const url = new URL(rawUrl)
      calls.push(url.pathname)
      metrics.requests++
      await new Promise(resolve => setTimeout(resolve, delayMs))
      if (url.hostname === 'registry.npmjs.org') {
        const pieces = url.pathname.slice(1).split('/')
        // Scoped packages have a single encoded name; URL.pathname stays encoded.
        const name = decodeURIComponent(pieces[0])
        const item = installed[name]
        if (!item)
          throw new Error(`Fixture package not found: ${name}`)
        if (pieces.length > 1) {
          return {
            name,
            version: pieces[1],
            repository: { url: `https://github.com/${item.repository}.git` },
          }
        }
        return {
          'dist-tags': { latest: item.latest },
          'versions': versions(item),
          'time': { [item.current]: baseTime, [item.latest]: baseTime },
          'repository': { url: `https://github.com/${item.repository}.git` },
        }
      }
      if (url.hostname === 'api.github.com') {
        if (url.pathname.endsWith('/contents'))
          return []
        if (url.pathname.endsWith('/releases')) {
          return [
            {
              tag_name: 'v19.2.0',
              name: 'v19.2.0',
              body: '## Improvements\n\n- **Better rendering**\n- Fixed issues',
              html_url: 'https://github.com/facebook/react/releases/tag/v19.2.0',
              published_at: baseTime,
            },
          ]
        }
        throw new Error(`Not found: ${url.pathname}`)
      }
      if (url.hostname === 'raw.githubusercontent.com')
        throw new Error('Fixture changelog unavailable')
      throw new Error(`Unexpected fixture URL: ${rawUrl}`)
    },
  }
}
