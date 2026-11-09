import type { DepnotesOverrides, ProjectConfig, Theme } from './types.js'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import YAML from 'yaml'
import { errorCode, errorMessage, hasDefined } from './validation.js'

export const DEFAULT_MINIMUM_RELEASE_AGE = 3 * 24 * 60 // minutes
export const DEFAULT_SCAN_CACHE_SECONDS = 30
export const DEFAULT_NOTES_CACHE_SECONDS = 120
export const SETTINGS_FIELDS = [
  'minimumReleaseAge',
  'minimumReleaseAgeExclude',
  'scanCacheSeconds',
  'notesCacheSeconds',
  'theme',
]
export function userConfigPath({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const base = platform === 'win32'
    ? (env.APPDATA || path.join(home, 'AppData', 'Roaming'))
    : platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : (env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME)
          ? env.XDG_CONFIG_HOME
          : path.join(home, '.config'))
  return path.join(base, 'depnotes', 'config.json')
}
function validateAge(value: unknown, source: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(value))
    throw new Error(`${source}: minimumReleaseAge must be a non-negative integer (minutes)`)
  return value
}
function validateExcludes(value: unknown, source: string): string[] {
  if (!Array.isArray(value) || !value.every(x => typeof x === 'string' && x.trim()))
    throw new Error(`${source}: minimumReleaseAgeExclude must be an array of nonempty strings`)
  return value
}
function validateSeconds(value: unknown, source: string, field: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 3600)
    throw new Error(`${source}: ${field} must be an integer between 0 and 3600 seconds`)
  return value
}
export function validateDepnotesOverrides(input: unknown): DepnotesOverrides {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('depnotes.config.json must contain an object')
  const own = input as Record<string, unknown>
  for (const key of Object.keys(own)) {
    if (!SETTINGS_FIELDS.includes(key))
      throw new Error(`Unknown Depnotes setting: ${key}`)
  }
  const clean: DepnotesOverrides = {}
  if (Object.hasOwn(own, 'minimumReleaseAge'))
    clean.minimumReleaseAge = validateAge(own.minimumReleaseAge, 'depnotes.config.json')
  if (Object.hasOwn(own, 'minimumReleaseAgeExclude'))
    clean.minimumReleaseAgeExclude = validateExcludes(own.minimumReleaseAgeExclude, 'depnotes.config.json')
  for (const key of ['scanCacheSeconds', 'notesCacheSeconds'] as const) {
    if (Object.hasOwn(own, key))
      clean[key] = validateSeconds(own[key], 'depnotes.config.json', key)
  }
  if (Object.hasOwn(own, 'theme')) {
    if (own.theme !== 'system' && own.theme !== 'light' && own.theme !== 'dark')
      throw new Error('theme must be system, light, or dark')
    clean.theme = own.theme
  }
  return clean
}
async function optionalRead(file: string) {
  try {
    return await fs.readFile(file, 'utf8')
  }
  catch (error) {
    if (errorCode(error) === 'ENOENT')
      return null
    throw error
  }
}
export async function loadProjectConfig(directory: string, { manager = 'pnpm' } = {}): Promise<ProjectConfig> {
  const project = path.resolve(directory)
  let age = DEFAULT_MINIMUM_RELEASE_AGE
  let source = 'Depnotes default'
  let excludes: string[] = []
  let scanCacheSeconds = DEFAULT_SCAN_CACHE_SECONDS
  let notesCacheSeconds = DEFAULT_NOTES_CACHE_SECONDS
  let excludeSource = 'Depnotes default'
  let own: DepnotesOverrides = {}
  let theme: Theme = 'system'
  const globalFile = userConfigPath()
  let globalOwn: DepnotesOverrides = {}
  const workspaceFile = path.join(project, 'pnpm-workspace.yaml')
  const workspaceText = manager === 'pnpm'
    ? await optionalRead(workspaceFile)
    : null
  if (workspaceText !== null) {
    const doc = YAML.parseDocument(workspaceText)
    if (doc.errors.length)
      throw new Error(`pnpm-workspace.yaml: ${doc.errors[0].message}`)
    const settings = doc.toJS() || {}
    if (Object.hasOwn(settings, 'minimumReleaseAge')) {
      age = validateAge(settings.minimumReleaseAge, 'pnpm-workspace.yaml')
      source = 'pnpm-workspace.yaml'
    }
    if (Object.hasOwn(settings, 'minimumReleaseAgeExclude')) {
      excludes = validateExcludes(settings.minimumReleaseAgeExclude, 'pnpm-workspace.yaml')
      excludeSource = 'pnpm-workspace.yaml'
    }
  }
  const globalText = await optionalRead(globalFile)
  if (globalText !== null) {
    try {
      globalOwn = validateDepnotesOverrides(JSON.parse(globalText))
    }
    catch (error) {
      throw new Error(`${globalFile}: ${errorMessage(error)}`)
    }
  }
  const configFile = path.join(project, 'depnotes.config.json')
  const configText = await optionalRead(configFile)
  if (configText !== null) {
    try {
      own = JSON.parse(configText)
    }
    catch (error) {
      throw new Error(`depnotes.config.json: ${errorMessage(error)}`)
    }
    own = validateDepnotesOverrides(own)
  }
  // Each layer changes only the fields it explicitly supplies.
  for (const [overrides, label] of [
    [globalOwn, 'user config'],
    [own, 'depnotes.config.json'],
  ] as const) {
    if (hasDefined(overrides, 'minimumReleaseAge')) {
      age = overrides.minimumReleaseAge
      source = label
    }
    if (hasDefined(overrides, 'minimumReleaseAgeExclude')) {
      excludes = overrides.minimumReleaseAgeExclude
      excludeSource = label
    }
    scanCacheSeconds = overrides.scanCacheSeconds ?? scanCacheSeconds
    notesCacheSeconds = overrides.notesCacheSeconds ?? notesCacheSeconds
    theme = overrides.theme ?? theme
  }
  return {
    minimumReleaseAge: age,
    minimumReleaseAgeExclude: excludes,
    source,
    excludeSource,
    scanCacheSeconds,
    notesCacheSeconds,
    theme,
    overrides: own,
    userOverrides: globalOwn,
  }
}
// pnpm supports package patterns and version-qualified exceptions. We handle
// those locally, without allowing patterns to become arbitrary regular expressions.
function matchesPackage(pattern: string, name: string) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(name)
}
export function isReleaseAgeExcluded(name: string, version: string, entries: string[] = []) {
  return entries.some((entry) => {
    const separator = entry.startsWith('@')
      ? entry.indexOf('@', 1)
      : entry.indexOf('@')
    const packagePart = separator >= 0
      ? entry.slice(0, separator)
      : entry
    if (!matchesPackage(packagePart, name))
      return false
    if (separator < 0)
      return true
    return entry.slice(separator + 1).split(/\s*\|\|\s*/).includes(version)
  })
}
export function selectAgeEligibleVersion({ name, versions, times, current, minimumReleaseAge, excludes = [], now = Date.now() }: {
  name: string
  versions: {
    version: string
  }[]
  times?: Record<string, string>
  current?: string
  latest?: string
  minimumReleaseAge: number
  excludes?: string[]
  now?: number
}) {
  const cutoff = now - minimumReleaseAge * 60000
  const valid = versions.filter(v => v && v.version && v.version !== current) // caller supplies sorted SemVer versions
  const deferred: string[] = []
  const unknown: string[] = []
  for (const { version } of valid) {
    if (isReleaseAgeExcluded(name, version, excludes) || minimumReleaseAge === 0)
      return { target: version, deferred, unknown }
    const time = times?.[version]
    const published = typeof time === 'string'
      ? Date.parse(time)
      : NaN
    if (!Number.isFinite(published)) {
      unknown.push(version)
      continue
    }
    if (published > cutoff) {
      deferred.push(version)
      continue
    }
    return { target: version, deferred, unknown }
  }
  return { target: null, deferred, unknown }
}
// Only the dedicated Depnotes config file is writable; package-manager files are read-only.
export async function saveProjectConfig(directory: string, overrides: unknown) {
  return saveConfigFile(path.join(path.resolve(directory), 'depnotes.config.json'), overrides)
}
export async function saveUserConfig(overrides: unknown) {
  return saveConfigFile(userConfigPath(), overrides)
}
async function saveConfigFile(target: string, overrides: unknown) {
  const clean = validateDepnotesOverrides(overrides)
  const stat = await fs.lstat(target).catch((error) => {
    if (errorCode(error) === 'ENOENT')
      return null
    throw error
  })
  if (stat && !stat.isFile())
    throw new Error('Config path must be a regular file')
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  if (Object.keys(clean).length === 0) {
    await fs.rm(target, { force: true })
    return clean
  }
  const temp = path.join(path.dirname(target), `.depnotes.config.${process.pid}.${crypto.randomUUID()}.tmp`)
  try {
    await fs.writeFile(temp, `${JSON.stringify(clean, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await fs.rename(temp, target)
  }
  finally {
    await fs.rm(temp, { force: true }).catch(() => {
    })
  }
  return clean
}
