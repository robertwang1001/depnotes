import type { GithubRelease, PackageManifest, UpdateKind } from './types.js'

export function parseVersion(input: unknown) {
  if (typeof input !== 'string')
    return null
  const match = input.trim().match(/^(?:[~^=]|>=?|<=?)?\s*(\d+)\.(\d+)\.(\d+)(?:-[\w.-]+)?(?:\+[\w.-]+)?$/)
  return match
    ? match[0].match(/\d+\.\d+\.\d+(?:-[\w.-]+)?/)?.[0] || null
    : null
}
export function compareVersions(a: string, b: string) {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y)
    return 0
  const aa = x.split('-')[0].split('.').map(Number)
  const bb = y.split('-')[0].split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (aa[i] !== bb[i])
      return Math.sign(aa[i] - bb[i])
  }
  const ap = x.split('-')[1]
  const bp = y.split('-')[1]
  if (ap && !bp)
    return -1
  if (!ap && bp)
    return 1
  return ap && bp
    ? Math.sign(ap.localeCompare(bp, undefined, { numeric: true }))
    : 0
}
export function classify(a: string, b: string): UpdateKind {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y)
    return 'unknown'
  const aa = x.split('.').map(Number)
  const bb = y.split('.').map(Number)
  return aa[0] !== bb[0]
    ? 'major'
    : aa[1] !== bb[1]
      ? 'minor'
      : aa[2] !== bb[2]
        ? 'patch'
        : 'prerelease'
}
export function githubRepo(repository: PackageManifest['repository']) {
  const url = typeof repository === 'string'
    ? repository
    : repository?.url
  if (!url)
    return null
  const match = url.match(/github\.com[:/]([^/\s]+)\/([^/#?\s]+?)(?:\.git)?(?:[/?#]|$)/i)
  if (!match)
    return null
  const owner = match[1]
  const repo = match[2].replace(/\.git$/, '')
  return /^[\w.-]+$/.test(owner) && /^[\w.-]+$/.test(repo)
    ? `${owner}/${repo}`
    : null
}
export function relevantReleases(releases: GithubRelease[], from: string, to: string, name: string) {
  const short = name.split('/').pop() || name
  return releases.filter(r => !r.draft && !r.prerelease).filter((r) => {
    const tag = r.tag_name || ''
    const candidates = [
      tag,
      tag.replace(/^v/, ''),
      tag.replace(new RegExp(`^${short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[@/-]v?`), ''),
    ]
    const version = candidates.map(parseVersion).find(Boolean)
    return version && compareVersions(version, from) > 0 && compareVersions(version, to) <= 0
  }).sort((a, b) => compareVersions(parseVersion(b.tag_name.replace(/^v/, '')) || '0.0.0', parseVersion(a.tag_name.replace(/^v/, '')) || '0.0.0'))
}
