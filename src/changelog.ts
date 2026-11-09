import type { ChangelogSection, JsonClient, ReleaseRequest, RepositoryNotes } from './types.js'
import semver from 'semver'
import { errorMessage } from './validation.js'

const MAX_CHANGELOG_BYTES = 250000
const MAX_SECTION_BYTES = 14000
const MAX_SECTIONS = 24
const DOC_RE = /(?:^|\/)(?:CHANGELOG|CHANGES|HISTORY)(?:\.[a-z]+)?\.md$/i
const GUIDE_RE = /migration|migrat|upgrade|upgrading|breaking.changes/i
export function extractVersion(heading: string, packageName = '') {
  const short = packageName.split('/').pop() || packageName
  const cleaned = heading.replace(/[`*]/g, '').trim().replace(/^\[([^\]]+)\]/, '$1').replace(/^version\s+/i, '')
  // Scope to a version heading; never parse a random version embedded in prose.
  const escaped = short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^(?:(?:${escaped})[@/\\s-]+)?v?(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)(?=$|[\\s(\\]–—:-])`, 'i')
  const match = cleaned.match(pattern)
  return match && semver.valid(match[1])
    ? match[1]
    : null
}
export function parseChangelog(markdown: string, { name = '', from, to }: {
  name?: string
  from?: string
  to?: string
} = {}): ChangelogSection[] {
  if (typeof markdown !== 'string' || !from || !to || !semver.valid(from) || !semver.valid(to))
    return []
  const lines = markdown.slice(0, MAX_CHANGELOG_BYTES).split(/\r?\n/)
  const heads: {
    line: number
    version: string
    heading: string
  }[] = []
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^#{1,4}\s(.*)$/)
    if (!match)
      continue
    const heading = match[1].trim().replace(/#+$/, '').trim()
    const version = extractVersion(heading, name)
    if (version)
      heads.push({ line: i, version, heading })
  }
  const entries = []
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i]
    if (!semver.gt(h.version, from) || !semver.lte(h.version, to))
      continue
    const end = heads[i + 1]?.line ?? lines.length
    const body = lines.slice(h.line + 1, end).join('\n').trim()
    entries.push({
      version: h.version,
      heading: h.heading,
      body: body.slice(0, MAX_SECTION_BYTES),
      truncated: body.length > MAX_SECTION_BYTES,
    })
  }
  return entries.sort((a, b) => semver.rcompare(a.version, b.version)).slice(0, MAX_SECTIONS)
}
function safePath(value: unknown) {
  return typeof value === 'string' && !value.startsWith('/') && !value.includes('..') && /^[\w./-]+$/.test(value)
}
function repoFileUrl(repo: string, file: string) {
  return `https://github.com/${repo}/blob/HEAD/${file.split('/').map(encodeURIComponent).join('/')}`
}
function decodeFile(result: {
  encoding?: string
  content?: string
  size: number
}) {
  if (result?.encoding !== 'base64' || typeof result.content !== 'string' || result.size > MAX_CHANGELOG_BYTES)
    return null
  return Buffer.from(result.content.replace(/\s/g, ''), 'base64').toString('utf8')
}
export async function discoverRepositoryNotes({ repo, name, from, to, client, headers = {} }: ReleaseRequest & {
  client: JsonClient
  headers?: Record<string, string>
}): Promise<RepositoryNotes> {
  const [owner, project] = repo.split('/')
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(project)}/contents`
  const warnings: string[] = []
  let root: {
    type: string
    path: string
    name: string
  }[] = []
  try {
    root = await client.json(base, headers) as typeof root
    if (!Array.isArray(root))
      root = []
  }
  catch (error) {
    return {
      changelog: null,
      guides: [],
      warnings: [`Could not list repository files: ${errorMessage(error)}`],
    }
  }
  const short = name.split('/').pop() || name
  const candidates = root.filter(x => x.type === 'file' && DOC_RE.test(x.path || x.name)).map(x => x.path)
  // Common monorepo convention: root CHANGELOG is more likely than an arbitrary package file.
  let selected = candidates.find(x => x.toLowerCase() === 'changelog.md') || candidates[0]
  let packageFiles: string[] = []
  if (!selected) {
    try {
      const dir = await client.json(`${base}/packages/${encodeURIComponent(short)}`, headers)
      if (Array.isArray(dir))
        packageFiles = dir.filter(x => x.type === 'file' && DOC_RE.test(x.path || x.name)).map(x => x.path)
      selected = packageFiles[0]
    }
    catch { /* optional path */
    }
  }
  let changelog = null
  if (selected && safePath(selected)) {
    try {
      const content = decodeFile(await client.json(`${base}/${selected.split('/').map(encodeURIComponent).join('/')}`, headers) as Parameters<typeof decodeFile>[0])
      if (content !== null) {
        changelog = {
          url: repoFileUrl(repo, selected),
          path: selected,
          sections: parseChangelog(content, { name, from, to }),
        }
      }
      else {
        warnings.push('Changelog exceeds the size limit or has unsupported encoding.')
      }
    }
    catch (error) {
      warnings.push(`Changelog unavailable: ${errorMessage(error)}`)
    }
  }
  const guides = root.filter(x => x.type === 'file' && /\.md$/i.test(x.name) && GUIDE_RE.test(x.name) && safePath(x.path)).slice(0, 8).map(x => ({
    title: x.name,
    url: repoFileUrl(repo, x.path),
  }))
  if (!changelog?.sections?.length && selected)
    warnings.push('A changelog was found, but no matching version headings were identified.')
  if (!selected)
    warnings.push('No changelog found at the repository root or common package directory.')
  return { changelog, guides, warnings }
}
