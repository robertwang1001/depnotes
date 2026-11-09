import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readWorkspace, resolveDependency } from '../src/lockfile.js'

test('scans root and workspace importers in last lockfile document', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dep-review-'))
  try {
    await mkdir(path.join(dir, 'packages', 'web'), { recursive: true })
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'root',
      dependencies: { react: '^19.0.0' },
    }))
    await writeFile(path.join(dir, 'packages/web/package.json'), JSON.stringify({
      name: 'web',
      dependencies: { zod: '^4.0.0' },
    }))
    await writeFile(path.join(dir, 'pnpm-lock.yaml'), `---\nlockfileVersion: '9.0'\nimporters:\n  .:\n    packageManagerDependencies: {}\n---\nlockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      react:\n        specifier: ^19.0.0\n        version: 19.2.0\n  packages/web:\n    dependencies:\n      zod:\n        specifier: ^4.0.0\n        version: 4.1.0\n`)
    const result = await readWorkspace(dir)
    assert.equal(result.packages.length, 2)
    assert.equal(result.packages[0].resolutions['dependencies:react'], '19.2.0')
    assert.equal(result.packages[1].resolutions['dependencies:zod'], '4.1.0')
  }
  finally {
    await rm(dir, { recursive: true, force: true })
  }
})
test('handles complex ranges, prereleases and non-registry specifiers', () => {
  assert.equal(readyVersion(resolveDependency('foo', '>=1.2.0 <2 || ^3.0.0', '1.8.0')), '1.8.0')
  assert.equal(readyVersion(resolveDependency('foo', '^1.0.0', null)), '1.0.0')
  assert.equal(resolveDependency('foo', 'workspace:*', null).status, 'unsupported')
  assert.equal(resolveDependency('foo', 'npm:bar@^1.0.0', null).status, 'unsupported')
})
function readyVersion(result: ReturnType<typeof resolveDependency>) {
  if (result.status !== 'ready')
    throw new Error(result.message)
  assert.equal(result.status, 'ready')
  return result.current
}
