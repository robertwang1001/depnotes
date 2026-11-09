import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { batchUpgradeCommands, runUpgrade, upgradeCommand, validateWorkspace } from '../src/upgrade.js'

const item = {
  name: '@scope/react',
  current: '1.0.0',
  latest: '2.0.0',
  status: 'outdated',
  section: 'devDependencies',
  range: '^1.0.0',
  importer: '.',
}
test('manager upgrade commands are exact, argument-vector based, and preserve section', () => {
  for (const manager of ['pnpm', 'npm', 'yarn', 'bun']) {
    const command = upgradeCommand(manager, item)
    assert.equal(command.command, manager)
    assert.equal(command.args[1], '@scope/react@2.0.0')
    assert.ok(command.args.includes(['npm', 'pnpm'].includes(manager)
      ? '--save-dev'
      : '--dev'))
  }
})
test('unsupported package identifiers, targets and protocols are rejected', () => {
  for (const change of [
    { name: '$(touch /tmp/pwn)' },
    { latest: 'beta' },
    { range: 'workspace:*' },
    { status: 'deferred' },
    { importer: '../outside' },
  ]) {
    assert.throws(() => upgradeCommand('pnpm', {
      ...item,
      ...change,
    }))
  }
})
test('workspace manifest is rechecked immediately before execution', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'depnotes-upgrade-'))
  try {
    const cwd = path.join(temp, 'packages', 'web')
    await mkdir(cwd, { recursive: true })
    await writeFile(path.join(cwd, 'package.json'), JSON.stringify({
      devDependencies: { '@scope/react': '^1.0.0' },
    }))
    assert.equal(await validateWorkspace(temp, { ...item, importer: 'packages/web' }), await realpath(cwd))
    await assert.rejects(validateWorkspace(temp, { ...item, importer: 'packages/web', range: '^0.5.0' }), /changed/)
    await symlink(os.tmpdir(), path.join(temp, 'escape'))
    await assert.rejects(validateWorkspace(temp, { ...item, importer: 'escape' }), /outside/)
  }
  finally {
    await rm(temp, { recursive: true, force: true })
  }
})
test('process runner collects output and returns exit status without invoking a shell', async () => {
  const result = await runUpgrade({
    command: process.execPath,
    args: ['-e', 'console.log("ok")'],
    cwd: os.tmpdir(),
  })
  assert.equal(result.ok, true)
  assert.match(result.output, /ok/)
  const failed = await runUpgrade({
    command: process.execPath,
    args: ['-e', 'process.exit(2)'],
    cwd: os.tmpdir(),
  })
  assert.equal(failed.ok, false)
  assert.equal(failed.exitCode, 2)
})
test('batch planning groups by importer and section without mixing save flags', () => {
  const items = [
    item,
    { ...item, name: 'typescript', latest: '6.0.0' },
    {
      ...item,
      name: 'react',
      importer: 'apps/web',
      section: 'dependencies',
    },
    { ...item, name: 'eslint', section: 'dependencies' },
  ]
  for (const manager of ['npm', 'pnpm', 'yarn', 'bun']) {
    const commands = batchUpgradeCommands(manager, items)
    assert.equal(commands.length, 3)
    const dev = commands.find(c => c.importer === '.' && c.section === 'devDependencies')
    assert.ok(dev!.args.includes('@scope/react@2.0.0'))
    assert.ok(dev!.args.includes('typescript@6.0.0'))
    assert.ok(dev!.args.includes(['npm', 'pnpm'].includes(manager)
      ? '--save-dev'
      : '--dev'))
    assert.ok(!commands.find(c => c.importer === '.' && c.section === 'dependencies')!.args.includes('typescript@6.0.0'))
  }
})
test('batch planning rejects duplicates, empty and unsupported selections', () => {
  assert.throws(() => batchUpgradeCommands('pnpm', []), /Select/)
  assert.throws(() => batchUpgradeCommands('pnpm', [item, item]), /Duplicate/)
  assert.throws(() => batchUpgradeCommands('pnpm', [
    item,
    { ...item, range: 'workspace:*' },
  ]), /Non-registry/)
  assert.throws(() => batchUpgradeCommands('pnpm', Array.from({ length: 101 }, () => ({ ...item }))), /Select/)
})
