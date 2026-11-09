import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { isReleaseAgeExcluded, loadProjectConfig, selectAgeEligibleVersion } from '../src/config.js'

test('three-day default with workspace and app overrides', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'depnotes-policy-'))
  try {
    assert.equal((await loadProjectConfig(dir)).minimumReleaseAge, 4320)
    await writeFile(path.join(dir, 'pnpm-workspace.yaml'), 'minimumReleaseAge: 1440\nminimumReleaseAgeExclude:\n  - "@test/*"\n')
    let config = await loadProjectConfig(dir)
    assert.equal(config.minimumReleaseAge, 1440)
    assert.deepEqual(config.minimumReleaseAgeExclude, ['@test/*'])
    await writeFile(path.join(dir, 'depnotes.config.json'), JSON.stringify({ minimumReleaseAge: 0 }))
    config = await loadProjectConfig(dir)
    assert.equal(config.minimumReleaseAge, 0)
    assert.deepEqual(config.minimumReleaseAgeExclude, ['@test/*'])
  }
  finally {
    await rm(dir, { recursive: true, force: true })
  }
})
test('package and version-specific exceptions', () => {
  assert.equal(isReleaseAgeExcluded('@test/pkg', '2.0.0', ['@test/*']), true)
  assert.equal(isReleaseAgeExcluded('react', '2.0.0', ['react@1.2.3 || 2.0.0']), true)
  assert.equal(isReleaseAgeExcluded('react', '3.0.0', ['react@1.2.3 || 2.0.0']), false)
})
test('chooses aged candidate and reports recent candidates', () => {
  const now = Date.parse('2026-11-10T00:00:00Z')
  const choice = selectAgeEligibleVersion({
    name: 'pkg',
    current: '1.0.0',
    versions: [
      { version: '2.0.0' },
      { version: '1.8.0' },
    ],
    times: { '2.0.0': '2026-11-09T00:00:00Z', '1.8.0': '2026-11-01T00:00:00Z' },
    minimumReleaseAge: 4320,
    now,
  })
  assert.equal(choice.target, '1.8.0')
  assert.deepEqual(choice.deferred, ['2.0.0'])
})
test('missing timestamps are not silently accepted', () => {
  const choice = selectAgeEligibleVersion({
    name: 'pkg',
    versions: [
      { version: '2.0.0' },
    ],
    times: {},
    minimumReleaseAge: 4320,
  })
  assert.equal(choice.target, null)
  assert.deepEqual(choice.unknown, ['2.0.0'])
})
