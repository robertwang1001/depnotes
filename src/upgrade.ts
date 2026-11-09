import type { DependencySection } from './types.js'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

export interface UpgradeItem {
  name: string
  status: string
  section: string
  current?: string
  latest?: string
  range: string
  importer: string
}
export interface EligibleUpgradeItem extends UpgradeItem {
  current: string
  latest: string
  section: DependencySection
}
export interface UpgradeResult {
  ok: boolean
  exitCode: number | null
  output: string
  signal?: NodeJS.Signals | null
  timedOut?: boolean
}
// The scanner already determines SemVer eligibility. These strict checks only
// constrain the executable command inputs, without another dependency import.
const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Z.-]+)?(?:\+[0-9A-Z.-]+)?$/i
function higherVersion(next: string, previous: string) {
  const a = next.split(/[.+-]/).slice(0, 3).map(Number)
  const b = previous.split(/[.+-]/).slice(0, 3).map(Number)
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i])
      return a[i] > b[i]
  }
  return next !== previous && !next.includes('-') && previous.includes('-')
}
const managers = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const sections = new Set(['dependencies', 'devDependencies', 'optionalDependencies'])
const packagePattern = /^(?:@[a-z0-9][\w.~-]*\/)?[a-z0-9][\w.~-]*$/i
const MAX_OUTPUT = 16000
export function validateUpgradeItem(item: UpgradeItem): asserts item is EligibleUpgradeItem {
  if (!item || item.status !== 'outdated' || !sections.has(item.section))
    throw new Error('Only eligible direct dependencies can be upgraded')
  if (!packagePattern.test(item.name) || !item.latest || !versionPattern.test(item.latest) || !item.current || !versionPattern.test(item.current) || !higherVersion(item.latest, item.current))
    throw new Error('Invalid package name or upgrade version')
  if (typeof item.range !== 'string' || !(/^[~^]?\d+(?:\.\d+){0,2}(?:-[0-9A-Z.-]+)?$/i.test(item.range)) || item.range.length > 120)
    throw new Error('Non-registry or unsupported dependency declaration')
  if (typeof item.importer !== 'string' || (item.importer !== '.' && (!/^(?:[\w.-]+\/)*[\w.-]+$/.test(item.importer) || item.importer.split('/').includes('..'))))
    throw new Error('Invalid workspace importer')
}
export function upgradeCommand(manager: string, item: UpgradeItem) {
  if (!managers.has(manager))
    throw new Error(`Unsupported package manager: ${manager}`)
  validateUpgradeItem(item)
  const flagByManager: Record<string, Record<DependencySection, string[]>> = {
    npm: {
      dependencies: [],
      devDependencies: ['--save-dev'],
      optionalDependencies: ['--save-optional'],
    },
    pnpm: {
      dependencies: [],
      devDependencies: ['--save-dev'],
      optionalDependencies: ['--save-optional'],
    },
    yarn: {
      dependencies: [],
      devDependencies: ['--dev'],
      optionalDependencies: ['--optional'],
    },
    bun: {
      dependencies: [],
      devDependencies: ['--dev'],
      optionalDependencies: ['--optional'],
    },
  }
  const flags = flagByManager[manager][item.section]
  const version = `${item.name}@${item.latest}`
  // Use native package-manager writes, so the corresponding lockfile is updated.
  // Array arguments + shell:false prevent shell interpolation of package names.
  const command = manager
  const args = [
    manager === 'npm'
      ? 'install'
      : 'add',
    version,
    ...flags,
  ]
  return {
    command,
    args,
    display: [command, ...args].join(' '),
  }
}
export async function validateWorkspace(project: string, item: UpgradeItem) {
  validateUpgradeItem(item)
  const root = await fs.realpath(project)
  const target = await fs.realpath(path.resolve(root, item.importer))
  if (target !== root && !target.startsWith(root + path.sep))
    throw new Error('Workspace resolves outside project')
  const manifest = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8'))
  if (manifest[item.section]?.[item.name] !== item.range)
    throw new Error('Dependency declaration changed since the scan. Rescan before upgrading.')
  return target
}
export async function runUpgrade({ command, args, cwd, timeoutMs = 180000, spawnImpl = spawn }: {
  command: string
  args: string[]
  cwd: string
  timeoutMs?: number
  spawnImpl?: typeof spawn
}): Promise<UpgradeResult> {
  if (process.platform === 'win32' && spawnImpl === spawn)
    throw new Error('Windows execution is not yet supported; please use the previewed package-manager command manually.')
  return await new Promise<UpgradeResult>((resolve, reject) => {
    const child = spawnImpl(command, args, {
      cwd,
      shell: false,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let timedOut = false
    const append = (chunk: Buffer) => {
      if (output.length < MAX_OUTPUT)
        output += String(chunk).slice(0, MAX_OUTPUT - output.length)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)
    const killTimer = setTimeout(() => {
      if (timedOut)
        child.kill('SIGKILL')
    }, timeoutMs + 5000)
    killTimer.unref?.()
    child.once('error', (error) => {
      clearTimeout(timeout)
      clearTimeout(killTimer)
      reject(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      clearTimeout(killTimer)
      resolve({
        ok: code === 0 && !timedOut,
        exitCode: code,
        signal,
        timedOut,
        output: output.trim(),
      })
    })
  })
}
// Preserve each workspace and dependency section. Never combine incompatible
// save flags; one package-manager command per (workspace, section) group.
export function batchUpgradeCommands(manager: string, items: UpgradeItem[]) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100)
    throw new Error('Select between 1 and 100 eligible dependencies')
  const unique = new Set<string>()
  const groups = new Map<string, EligibleUpgradeItem[]>()
  for (const item of items) {
    validateUpgradeItem(item)
    const id = JSON.stringify([item.importer, item.section, item.name])
    if (unique.has(id))
      throw new Error(`Duplicate upgrade: ${item.name}`)
    unique.add(id)
    const group = JSON.stringify([item.importer, item.section])
    if (!groups.has(group))
      groups.set(group, [])
    groups.get(group)!.push(item)
  }
  return [
    ...groups.values(),
  ].map((group) => {
    const first = upgradeCommand(manager, group[0])
    const specs = group.map(item => `${item.name}@${item.latest}`)
    const args = [
      first.args[0],
      ...specs,
      ...first.args.slice(2),
    ]
    return {
      command: first.command,
      args,
      display: [first.command, ...args].join(' '),
      items: group,
      importer: group[0].importer,
      section: group[0].section,
    }
  })
}
