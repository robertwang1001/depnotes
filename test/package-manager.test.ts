import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { detectPackageManager, parsePackageManager } from '../src/package-manager.js'

async function fixture(fn: (directory: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'depnotes-manager-'))
  try {
    await fn(dir)
  }
  finally {
    await rm(dir, { recursive: true, force: true })
  }
}
test('recognizes declared packageManager and integrity hashes', () => {
  assert.deepEqual(parsePackageManager('pnpm@10.23.0+sha512.hash'), { name: 'pnpm', version: '10.23.0', source: 'packageManager' })
  assert.equal(parsePackageManager('nope'), null)
})
test('declared manager wins over stale lockfiles with warning', () => fixture(async (dir) => {
  await writeFile(path.join(dir, 'package-lock.json'), '{}')
  const manager = await detectPackageManager(dir, { packageManager: 'yarn@4.9.0' })
  assert.equal(manager.name, 'yarn')
  assert.equal(manager.version, '4.9.0')
  assert.match(manager.warnings.join(' '), /Declared yarn/)
}))
test('infers Bun from the modern text lockfile', () => fixture(async (dir) => {
  await writeFile(path.join(dir, 'bun.lock'), '{}')
  const manager = await detectPackageManager(dir, {})
  assert.equal(manager.name, 'bun')
  assert.equal(manager.lockfile, 'bun.lock')
}))
test('ambiguous lockfiles are reported, not silently interpreted', () => fixture(async (dir) => {
  await writeFile(path.join(dir, 'bun.lock'), '{}')
  await writeFile(path.join(dir, 'yarn.lock'), '')
  const manager = await detectPackageManager(dir, {})
  assert.equal(manager.detectedBy, 'fallback')
  assert.match(manager.warnings.join(' '), /Multiple lockfile/)
}))
test('devEngines.packageManager is accepted if top-level declaration absent', () => fixture(async (dir) => {
  const manager = await detectPackageManager(dir, {
    devEngines: {
      packageManager: { name: 'npm', version: '^10.0.0' },
    },
  })
  assert.equal(manager.name, 'npm')
  assert.equal(manager.version, '^10.0.0')
}))
