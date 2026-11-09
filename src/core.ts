import type { DependencyInput, DependencyItem, DependencySection, GithubRelease, JsonClient, PackageManifest, Packument, ReleaseNotes, ReleaseRequest, RepositoryNotes, ScanDiagnostic, ScanProgress, ScanResult } from './types.js'
import path from 'node:path'
import semver from 'semver'
import { discoverRepositoryNotes } from './changelog.js'
import { loadProjectConfig, selectAgeEligibleVersion } from './config.js'
import { createClient } from './http-client.js'
import { readWorkspace, resolveDependency } from './lockfile.js'
import { classify, githubRepo, relevantReleases } from './utils.js'
import { errorMessage } from './validation.js'

export { createClient } from './http-client.js'
const sections: DependencySection[] = ['dependencies', 'devDependencies', 'optionalDependencies']
const registryUrl = 'https://registry.npmjs.org/'
// The abbreviated npm packument is intentionally missing repository metadata.
// Fetch only the small version manifest when a package actually has an upgrade.
export async function resolveGithubRepository({ name, latest, current, packument, client }: {
  name: string
  latest: string
  current: string
  packument: Packument
  client: JsonClient
}) {
  const available = [packument.versions?.[latest], packument.versions?.[current], packument]
  for (const candidate of available) {
    const repo = githubRepo(candidate?.repository) || githubRepo(candidate?.homepage) || githubRepo(candidate?.bugs?.url)
    if (repo)
      return repo
  }
  const encodedName = encodeURIComponent(name)
  const versions = [
    ...new Set([latest, current].filter(version => semver.valid(version))),
  ]
  for (const version of versions) {
    try {
      const manifest = await client.json(`${registryUrl}${encodedName}/${encodeURIComponent(version)}`) as PackageManifest
      const repo = githubRepo(manifest.repository) || githubRepo(manifest.homepage) || githubRepo(manifest.bugs?.url)
      if (repo)
        return repo
    }
    catch {
      // Keep scanning even if a registry mirror cannot serve version manifests.
    }
  }
  return null
}
export async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  let next = 0
  const results: R[] = []
  await Promise.all(Array.from({
    length: Math.min(limit, items.length),
  }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await mapper(items[index], index)
    }
  }))
  return results
}
export async function scanProject(project: string, { client = createClient(), concurrency = 8, onProgress }: {
  client?: JsonClient
  concurrency?: number
  onProgress?: (event: ScanProgress) => void
} = {}): Promise<ScanResult> {
  const directory = path.resolve(project)
  const { packages, warning, manager } = await readWorkspace(directory)
  const config = await loadProjectConfig(directory, { manager: manager.name })
  if (!packages.length)
    throw new Error(`No readable package.json found in ${directory}`)
  const items = packages.flatMap(pkg => sections.flatMap(section => Object.entries(pkg.manifest[section] || {}).map(([name, range]) => ({
    name,
    range,
    section,
    importer: pkg.importer,
    workspaceName: pkg.name,
    resolved: pkg.resolutions[`${section}:${name}`],
  }))))
  // One registry request per package, even if many workspace importers use it.
  const metadata = new Map<string, Promise<unknown>>()
  let completed = 0
  const timings: ScanDiagnostic[] = []
  onProgress?.({ type: 'start', total: items.length })
  const results = await mapLimit(items, concurrency, async (item) => {
    const started = performance.now()
    const result = await scanDependency(item)
    const elapsedMs = Math.round(performance.now() - started)
    const entry = {
      name: item.name,
      importer: item.importer,
      status: result.status,
      elapsedMs,
      message: result.message || null,
    }
    timings.push(entry)
    onProgress?.({
      type: 'item',
      index: completed++,
      total: items.length,
      item: result,
      diagnostic: entry,
    })
    return result
  })
  async function scanDependency(item: DependencyInput): Promise<DependencyItem> {
    const { resolved, ...base } = item
    const baseline = resolveDependency(item.name, item.range, resolved)
    if (baseline.status !== 'ready') {
      return {
        ...base,
        ...baseline,
      }
    }
    const { current, source } = baseline
    try {
      if (!metadata.has(item.name))
        metadata.set(item.name, client.json(`${registryUrl}${encodeURIComponent(item.name)}`, { Accept: 'application/vnd.npm.install-v1+json' }))
      const data = await metadata.get(item.name) as Packument
      const latestAvailable = data['dist-tags']?.latest
      if (!latestAvailable || !semver.valid(latestAvailable)) {
        return {
          ...base,
          current,
          source,
          status: 'unsupported',
          message: 'No valid latest dist-tag',
        }
      }
      const allVersions = Object.keys(data.versions || {}).filter(v => semver.valid(v)).sort(semver.rcompare)
      const compatible = semver.maxSatisfying(allVersions, item.range)
      // Publication timestamps are unavailable in the abbreviated packument.
      // Only fetch the full packument for packages which could have an upgrade.
      let full = data
      let eligible: string | null = latestAvailable
      let deferred: string[] = []
      let unknown: string[] = []
      if (semver.gt(latestAvailable, current) && config.minimumReleaseAge > 0) {
        try {
          full = await client.json(`${registryUrl}${encodeURIComponent(item.name)}`) as Packument
          const sorted = Object.keys(full.versions || {}).filter(v => semver.valid(v) && !semver.prerelease(v) && semver.gt(v, current) && semver.lte(v, latestAvailable)).sort(semver.rcompare).map(version => ({ version }))
          const choice = selectAgeEligibleVersion({
            name: item.name,
            versions: sorted,
            current,
            latest: latestAvailable,
            times: full.time,
            minimumReleaseAge: config.minimumReleaseAge,
            excludes: config.minimumReleaseAgeExclude,
          })
          eligible = choice.target
          deferred = choice.deferred
          unknown = choice.unknown
        }
        catch (error) {
          return {
            ...base,
            current,
            source,
            latestAvailable,
            status: 'error',
            message: `Publication time lookup failed: ${errorMessage(error)}`,
          }
        }
      }
      const outdated = eligible && semver.gt(eligible, current)
      const repo = outdated
        ? await resolveGithubRepository({
            name: item.name,
            latest: eligible!,
            current,
            packument: full,
            client,
          })
        : null
      const status = outdated
        ? 'outdated'
        : deferred.length
          ? 'deferred'
          : unknown.length ? 'unknown-age' : 'current'
      return {
        ...base,
        current,
        source,
        latest: eligible || latestAvailable,
        latestAvailable,
        compatible,
        repo,
        status,
        kind: outdated
          ? classify(current, eligible!)
          : null,
        deferred,
        unknown,
        message: status === 'deferred'
          ? `Newer releases are within the ${config.minimumReleaseAge}-minute minimum release age.`
          : status === 'unknown-age'
            ? 'Registry metadata does not contain publication timestamps for newer versions.'
            : undefined,
      }
    }
    catch (error) {
      return {
        ...base,
        current,
        source,
        status: 'error',
        message: errorMessage(error),
      }
    }
  }
  return {
    diagnostics: {
      total: items.length,
      byStatus: Object.fromEntries([
        ...new Set(results.map(x => x.status)),
      ].map(status => [status, results.filter(x => x.status === status).length])),
      slowest: [...timings].sort((a, b) => b.elapsedMs - a.elapsedMs).slice(0, 15),
    },
    project: directory,
    packageName: packages.find(p => p.importer === '.')?.name || '(workspace)',
    warning,
    manager,
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      engines: packages.find(p => p.importer === '.')?.manifest?.engines || {},
    },
    workspaces: packages.map(p => ({ importer: p.importer, name: p.name })),
    config,
    items: results,
  }
}
export async function getReleaseNotes({ name, from, to, repo }: ReleaseRequest, { client = createClient(), token = process.env.GITHUB_TOKEN }: {
  client?: JsonClient
  token?: string
} = {}): Promise<ReleaseNotes> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) {
    return {
      releases: [],
      message: 'No valid GitHub repository metadata found',
      complete: false,
      warnings: ['Repository metadata unavailable.'],
    }
  }
  if (!semver.valid(from) || !semver.valid(to) || semver.gte(from, to))
    throw new Error('Invalid release version range')
  const [owner, project] = repo.split('/')
  const headers: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {}
  const all: GithubRelease[] = []
  const warnings: string[] = []
  let exhausted = false
  let releaseError = null
  for (let page = 1; page <= 3; page++) {
    try {
      const chunk = await client.json(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(project)}/releases?per_page=100&page=${page}`, headers)
      if (!Array.isArray(chunk)) {
        warnings.push('Unexpected GitHub Releases response.')
        break
      }
      all.push(...chunk)
      if (chunk.length < 100) {
        exhausted = true
        break
      }
    }
    catch (error) {
      releaseError = errorMessage(error)
      warnings.push(`Could not retrieve GitHub Releases: ${errorMessage(error)}`)
      break
    }
  }
  const matching = relevantReleases(all, from, to, name)
  let discovery: RepositoryNotes = { changelog: null, guides: [], warnings: [] }
  try {
    discovery = await discoverRepositoryNotes({
      repo,
      name,
      from,
      to,
      client,
      headers,
    })
  }
  catch (error) {
    warnings.push(`Changelog lookup failed: ${errorMessage(error)}`)
  }
  warnings.push(...discovery.warnings)
  if (!exhausted)
    warnings.push('Release search did not reach the end of repository history (maximum 300 releases).')
  if (!matching.length && !discovery.changelog?.sections?.length)
    warnings.push('No version-specific release notes found. Coverage is unknown.')
  if (matching.length)
    warnings.push('Releases can be repository-wide; matching tags do not prove package-specific coverage.')
  const releases = matching.map(r => ({
    tag: r.tag_name,
    title: r.name || r.tag_name,
    body: r.body || '',
    url: r.html_url,
    published: r.published_at,
  }))
  return {
    repo,
    releases,
    changelog: discovery.changelog,
    guides: discovery.guides,
    complete: false,
    coverage: 'unverified',
    warnings,
    message: releaseError
      ? 'Partial results: Releases API request failed.'
      : `${releases.length} matching GitHub release(s); ${discovery.changelog?.sections?.length || 0} changelog section(s). Coverage is not guaranteed.`,
  }
}
