import type { PackageManifest } from './types.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { errorCode } from './validation.js'

const lockfiles = {
  pnpm: ['pnpm-lock.yaml'],
  npm: ['npm-shrinkwrap.json', 'package-lock.json'],
  yarn: ['yarn.lock'],
  bun: ['bun.lock', 'bun.lockb'],
}
const managers = new Set(Object.keys(lockfiles))
export function parsePackageManager(value: unknown) {
  if (typeof value !== 'string')
    return null
    // packageManager may end in a Corepack integrity hash, which is not part of the version.
  const match = /^(pnpm|npm|yarn|bun)@([^+\s]+)(?:\+.+)?$/.exec(value)
  return match
    ? { name: match[1], version: match[2], source: 'packageManager' }
    : null
}
export async function detectPackageManager(project: string, manifest: PackageManifest) {
  const declared = parsePackageManager(manifest.packageManager)
  const dev = manifest.devEngines?.packageManager
  const devEngine = !declared && dev && managers.has(dev.name)
    ? {
        name: dev.name,
        version: typeof dev.version === 'string'
          ? dev.version
          : null,
        source: 'devEngines.packageManager',
      }
    : null
  const found = []
  for (const [name, files] of Object.entries(lockfiles)) {
    for (const file of files) {
      try {
        await fs.access(path.join(project, file))
        found.push({ name, file })
        break
      }
      catch (error) {
        if (errorCode(error) !== 'ENOENT')
          throw error
      }
    }
  }
  const configured = declared || devEngine
  const inferred = found.length === 1
    ? found[0]
    : null
  const name = configured?.name || inferred?.name || 'npm'
  const warnings = []
  if (manifest.packageManager && !declared)
    warnings.push('Unrecognized packageManager declaration; falling back to lockfile detection.')
  if (!configured && found.length > 1)
    warnings.push(`Multiple lockfile types found: ${found.map(x => x.file).join(', ')}. Package manager cannot be inferred reliably; defaulting to npm.`)
  if (configured && found.length && !found.some(x => x.name === configured.name))
    warnings.push(`Declared ${configured.name} but detected ${found.map(x => x.file).join(', ')}; check for stale lockfiles.`)
  const active = found.find(x => x.name === name)
  if (!active && found.length === 0)
    warnings.push('No lockfile found: installed versions may be estimated from manifest ranges.')
  const ua = process.env.npm_config_user_agent || ''
  const uaMatch = new RegExp(`(?:^|\\s)${name}/([^\\s]+)`).exec(ua)
  return {
    name,
    version: configured?.version || null,
    versionSource: configured?.source || null,
    detectedBy: configured?.source || (inferred ? 'lockfile' : 'fallback'),
    lockfile: active?.file || null,
    detectedLockfiles: found.map(x => x.file),
    invokedVersion: uaMatch?.[1] || null,
    warnings,
  }
}
