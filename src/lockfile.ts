import type { DependencySection, PackageManifest } from './types.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import semver from 'semver'
import YAML from 'yaml'
import { detectPackageManager } from './package-manager.js'
import { errorCode, errorMessage } from './validation.js'

interface PnpmLock {
  importers?: Record<string, Partial<Record<DependencySection, Record<string, string | {
    version?: string
  }>>>>
}
interface NpmLock {
  packages?: Record<string, PackageManifest>
}
type YarnLock = Record<string, {
  version?: string
}>
interface BunLock {
  [key: string]: unknown
  workspaces?: Record<string, PackageManifest>
  packages?: Record<string, unknown[]>
}
export function extractResolutions(lock: PnpmLock | null, importer = '.') {
  const entry = lock?.importers?.[importer]
  if (!entry)
    return {}
  const result: Record<string, string> = {}
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    for (const [name, dep] of Object.entries(entry[section] || {})) {
      const raw = typeof dep === 'string'
        ? dep
        : dep?.version
      const match = typeof raw === 'string' && raw.match(/^(\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?)(?:\(|$)/)
      if (match && semver.valid(match[1]))
        result[`${section}:${name}`] = match[1]
    }
  }
  return result
}
export function extractNpmResolutions(lock: NpmLock, importer = '.') {
  const result: Record<string, string> = {}
  const root = importer === '.'
    ? ''
    : `${importer}/`
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    const dependencies = lock.packages?.[importer === '.'
      ? ''
      : importer]?.[section] || {}
    for (const name of Object.keys(dependencies)) {
      const entry = lock.packages?.[`${root}node_modules/${name}`] || (importer === '.'
        ? null
        : lock.packages?.[`node_modules/${name}`])
      if (entry?.version && semver.valid(entry.version))
        result[`${section}:${name}`] = entry.version
    }
  }
  return result
}
/**
 * Extract direct registry resolutions from Yarn Classic (v1) or modern Yarn locks.
 * Only exact semver versions are accepted; local and protocol-based resolutions
 * deliberately fall through to manifest estimates with a visible source label.
 */
export function extractYarnResolutions(source: string, manifest: PackageManifest, parsedModern: YarnLock | null = null) {
  const result: Record<string, string> = {}
  if (parsedModern && typeof parsedModern === 'object' && parsedModern.__metadata) {
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
      for (const [name, range] of Object.entries(manifest[section] || {})) {
        const descriptor = `${name}@${range}`
        const candidates = [descriptor, `${name}@npm:${range}`]
        const entry = candidates.map(key => parsedModern[key]).find(Boolean) || Object.entries(parsedModern).find(([key]) => key.split(/,\s*/).some(x => candidates.includes(x.replace(/^"|"$/g, ''))))?.[1]
        const version = entry?.version
        if (version && semver.valid(version))
          result[`${section}:${name}`] = version
      }
    }
    return result
  }
  // Yarn v1 has quoted or unquoted comma-separated selectors and `version "x"`.
  const entries = new Map<string, string>()
  let selectors: string[] = []
  for (const line of source.split(/\r?\n/)) {
    if (line && !/^\s/.test(line) && line.trimEnd().endsWith(':') && !line.startsWith('#')) {
      selectors = line.slice(0, -1).match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^,]+/g)?.map(x => x.trim().replace(/^['"]|['"]$/g, '')) || []
    }
    else {
      const match = /^\s{2}version\s+["']?([^\s"']+)["']?\s*$/.exec(line)
      if (match && semver.valid(match[1])) {
        for (const key of selectors)
          entries.set(key, match[1])
      }
    }
  }
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    for (const [name, range] of Object.entries(manifest[section] || {})) {
      const found = entries.get(`${name}@${range}`)
      if (found)
        result[`${section}:${name}`] = found
    }
  }
  return result
}
/** bun.lock is JSONC. Remove comments and trailing commas without changing strings. */
export function parseBunLock(source: string): BunLock {
  let output = ''
  let inString = false
  let escaped = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    const next = source[i + 1]
    if (inLine) {
      if (c === '\n') {
        inLine = false
        output += '\n'
      }
      continue
    }
    if (inBlock) {
      if (c === '*' && next === '/') {
        inBlock = false
        i++
      }
      else if (c === '\n') {
        output += '\n'
      }
      continue
    }
    if (inString) {
      output += c
      if (escaped)
        escaped = false
      else if (c === '\\')
        escaped = true
      else if (c === '"')
        inString = false
      continue
    }
    if (c === '"') {
      inString = true
      output += c
      continue
    }
    if (c === '/' && next === '/') {
      inLine = true
      i++
      continue
    }
    if (c === '/' && next === '*') {
      inBlock = true
      i++
      continue
    }
    output += c
  }
  // Remove commas immediately before `}` or `]` outside of strings.
  let cleaned = ''
  let quoted = false
  let escape = false
  for (let i = 0; i < output.length; i++) {
    const c = output[i]
    if (quoted) {
      cleaned += c
      if (escape)
        escape = false
      else if (c === '\\')
        escape = true
      else if (c === '"')
        quoted = false
      continue
    }
    if (c === '"') {
      quoted = true
      cleaned += c
      continue
    }
    if (c === ',') {
      let j = i + 1
      while (/\s/.test(output[j] || '') && j < output.length)
        j++
      if (output[j] === ']' || output[j] === '}')
        continue
    }
    cleaned += c
  }
  return JSON.parse(cleaned)
}
export function extractBunResolutions(lock: BunLock | null, manifest: PackageManifest, importer = '.') {
  const workspace = lock?.workspaces?.[importer === '.'
    ? ''
    : importer]
  if (!workspace || !lock.packages || typeof lock.packages !== 'object')
    return {}
  const result: Record<string, string> = {}
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    for (const [name, range] of Object.entries(manifest[section] || {})) {
      // Match the installer's workspace declaration to avoid stale lock entries.
      if (workspace[section]?.[name] !== range)
        continue
      const info = lock.packages[name]
      if (!Array.isArray(info) || typeof info[0] !== 'string')
        continue
      // Registry entries have a `name@version` locator; aliases can name another package.
      const locator = info[0]
      const version = locator.startsWith(`${name}@`)
        ? locator.slice(name.length + 1)
        : null
      if (version && semver.valid(version))
        result[`${section}:${name}`] = version
    }
  }
  return result
}
function globRegex(glob: string) {
  const pieces = glob.replace(/\\/g, '/').replace(/\/$/, '').split('/')
  let result = '^'
  for (const [index, segment] of pieces.entries()) {
    if (index > 0)
      result += '/'
    if (segment === '**') {
      result += '(?:[^/]+(?:/|$))*'
      continue
    }
    result += segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
  }
  return new RegExp(`${result}$`)
}
export function matchesWorkspace(importer: string, patterns: string[]) {
  let included = false
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || !pattern.trim())
      continue
    const excluded = pattern.startsWith('!')
    const normalized = (excluded
      ? pattern.slice(1)
      : pattern).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
    if (globRegex(normalized).test(importer))
      included = !excluded
  }
  return included
}
async function listWorkspaceFolders(root: string, patterns: string[]) {
  if (!patterns.length)
    return []
  const result = []
  const queue = [
    { relative: '', depth: 0 },
  ]
  let seen = 0
  while (queue.length) {
    const { relative, depth } = queue.shift()!
    if (depth >= 6 || seen++ >= 3000)
      continue
    let entries = []
    try {
      entries = await fs.readdir(path.join(root, relative), { withFileTypes: true })
    }
    catch (error) {
      if (errorCode(error) === 'ENOENT')
        continue
      throw error
    }
    for (const ent of entries) {
      if (!ent.isDirectory() || [
        'node_modules',
        '.git',
        '.next',
        'dist',
        'build',
        '.turbo',
        '.yarn',
        '.pnpm',
      ].includes(ent.name)) {
        continue
      }
      const next = relative
        ? `${relative}/${ent.name}`
        : ent.name
      if (matchesWorkspace(next, patterns))
        result.push(next)
      queue.push({ relative: next, depth: depth + 1 })
    }
  }
  return [
    ...new Set(result),
  ].sort()
}
async function optionalFile(file: string) {
  try {
    return await fs.readFile(file, 'utf8')
  }
  catch (error) {
    if (errorCode(error) === 'ENOENT')
      return null
    throw error
  }
}
export async function readWorkspace(project: string) {
  const root = path.resolve(project)
  const rootManifest: PackageManifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  const manager = await detectPackageManager(root, rootManifest)
  const warnings = [...manager.warnings]
  let pnpmLock: PnpmLock | null = null
  let npmLock: NpmLock | null = null
  let yarnLock: YarnLock | null = null
  let bunLock: BunLock | null = null
  let yarnSource = null
  if (manager.name === 'pnpm' && manager.lockfile) {
    try {
      const source = await fs.readFile(path.join(root, manager.lockfile), 'utf8')
      const docs = YAML.parseAllDocuments(source)
      const doc = docs.at(-1)
      if (!doc || doc.errors.length)
        throw new Error(doc?.errors[0]?.message || 'Empty lockfile')
      pnpmLock = doc.toJS() as PnpmLock
    }
    catch (error) {
      warnings.push(`pnpm lockfile could not be read: ${errorMessage(error)}`)
    }
  }
  if (manager.name === 'npm' && manager.lockfile) {
    try {
      npmLock = JSON.parse(await fs.readFile(path.join(root, manager.lockfile), 'utf8')) as NpmLock
    }
    catch (error) {
      warnings.push(`npm lockfile could not be read: ${errorMessage(error)}`)
    }
  }
  if (manager.name === 'yarn' && manager.lockfile) {
    try {
      yarnSource = await fs.readFile(path.join(root, manager.lockfile), 'utf8')
      if (/^__metadata:/m.test(yarnSource)) {
        yarnLock = YAML.parse(yarnSource, { uniqueKeys: false }) as YarnLock
      }
    }
    catch (error) {
      warnings.push(`Yarn lockfile could not be read: ${errorMessage(error)}`)
      yarnSource = null
    }
  }
  if (manager.name === 'bun' && manager.lockfile) {
    if (manager.lockfile === 'bun.lockb') {
      warnings.push('Binary bun.lockb cannot be parsed; migrate to text bun.lock for resolved versions.')
    }
    else {
      try {
        bunLock = parseBunLock(await fs.readFile(path.join(root, manager.lockfile), 'utf8'))
      }
      catch (error) {
        warnings.push(`Bun lockfile could not be read: ${errorMessage(error)}`)
      }
    }
  }
  let patterns: string[] = []
  if (manager.name === 'pnpm') {
    try {
      const workspaceText = await optionalFile(path.join(root, 'pnpm-workspace.yaml'))
      const data = workspaceText
        ? YAML.parse(workspaceText)
        : {}
      patterns = Array.isArray(data?.packages)
        ? data.packages
        : []
    }
    catch (error) {
      warnings.push(`pnpm workspace configuration: ${errorMessage(error)}`)
    }
  }
  if (!patterns.length) {
    const ws = rootManifest.workspaces
    patterns = Array.isArray(ws)
      ? ws
      : Array.isArray(ws?.packages)
        ? ws.packages
        : []
  }
  let importers = ['.']
  if (manager.name === 'pnpm' && pnpmLock?.importers) {
    importers = [
      ...new Set([
        '.',
        ...Object.keys(pnpmLock.importers),
      ]),
    ]
  }
  else {
    importers.push(...await listWorkspaceFolders(root, patterns))
    if (manager.name === 'npm' && npmLock?.packages) {
      // The npm lockfile may record workspace links even when manifests omit workspaces.
      for (const [key, value] of Object.entries(npmLock.packages)) {
        if (key && !key.includes('node_modules') && value?.name)
          importers.push(key)
      }
    }
    importers = [
      ...new Set(importers),
    ]
  }
  const packages: {
    importer: string
    name: string
    manifest: PackageManifest
    resolutions: Record<string, string>
  }[] = []
  for (const importer of importers) {
    if (path.isAbsolute(importer) || importer.split(/[\\/]/).includes('..'))
      continue
    const manifestPath = path.resolve(root, importer, 'package.json')
    if (!manifestPath.startsWith(root + path.sep) && manifestPath !== path.join(root, 'package.json'))
      continue
    try {
      const manifest: PackageManifest = importer === '.'
        ? rootManifest
        : JSON.parse(await fs.readFile(manifestPath, 'utf8'))
      const resolutions: Record<string, string> = manager.name === 'pnpm'
        ? extractResolutions(pnpmLock, importer)
        : manager.name === 'npm'
          ? extractNpmResolutions(npmLock || {}, importer)
          : manager.name === 'yarn' && yarnSource
            ? extractYarnResolutions(yarnSource, manifest, yarnLock)
            : manager.name === 'bun'
              ? extractBunResolutions(bunLock, manifest, importer)
              : {}
      packages.push({
        importer,
        name: manifest.name || importer,
        manifest,
        resolutions,
      })
    }
    catch (error) {
      warnings.push(`Could not read ${importer}/package.json: ${errorMessage(error)}`)
    }
  }
  if (manager.name === 'yarn' && !yarnSource)
    warnings.push('Yarn resolutions unavailable; dependency baselines may use manifest minimums.')
  if (manager.name === 'bun' && !bunLock)
    warnings.push('Bun resolutions unavailable; dependency baselines may use manifest minimums.')
  return { packages, warning: warnings.join(' ') || null, manager }
}
export function resolveDependency(name: string, range: unknown, resolved?: string | null): {
  status: 'unsupported'
  message: string
} | {
  status: 'ready'
  current: string
  source: string
} {
  if (typeof range !== 'string')
    return { status: 'unsupported', message: 'Invalid dependency specifier' }
  if (/^(?:workspace:|link:|file:|git\+|github:|https?:|catalog:)/.test(range))
    return { status: 'unsupported', message: 'Local, catalog or non-registry dependency' }
  if (range.startsWith('npm:'))
    return { status: 'unsupported', message: 'npm alias (not yet supported)' }
  const validRange = semver.validRange(range)
  if (!validRange)
    return { status: 'unsupported', message: 'Non-SemVer specifier' }
  const current = semver.valid(resolved) || semver.minVersion(validRange)?.version
  if (!current)
    return { status: 'unsupported', message: 'Could not determine a baseline version' }
  return {
    current,
    source: semver.valid(resolved)
      ? 'lockfile'
      : 'manifest (minimum range)',
    status: 'ready',
  }
}
