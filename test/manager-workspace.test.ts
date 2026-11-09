import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { extractNpmResolutions, matchesWorkspace, readWorkspace } from '../src/lockfile.js'

test('resolves npm lockfile direct versions and package.json workspaces', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'depnotes-npm-'))
  try {
    await mkdir(path.join(dir, 'packages', 'web'), { recursive: true })
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'root',
      packageManager: 'npm@10.9.0',
      workspaces: ['packages/*'],
      dependencies: { react: '^19.0.0' },
    }))
    await writeFile(path.join(dir, 'packages/web/package.json'), JSON.stringify({
      name: 'web',
      dependencies: { zod: '^4.0.0' },
    }))
    await writeFile(path.join(dir, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': {
          dependencies: { react: '^19.0.0' },
        },
        'node_modules/react': { version: '19.2.0' },
        'packages/web': {
          name: 'web',
          dependencies: { zod: '^4.0.0' },
        },
        'packages/web/node_modules/zod': { version: '4.1.0' },
      },
    }))
    const result = await readWorkspace(dir)
    assert.equal(result.manager.name, 'npm')
    assert.equal(result.packages.length, 2)
    assert.equal(result.packages[0].resolutions['dependencies:react'], '19.2.0')
    assert.equal(result.packages[1].resolutions['dependencies:zod'], '4.1.0')
  }
  finally {
    await rm(dir, { recursive: true, force: true })
  }
})
test('npm version resolution does not invent absent versions', () => {
  assert.deepEqual(extractNpmResolutions({
    packages: {
      '': {
        dependencies: { react: '^19' },
      },
    },
  }, '.'), {})
})
test('workspace patterns include and exclude directories', () => {
  assert.equal(matchesWorkspace('packages/web', ['packages/*']), true)
  assert.equal(matchesWorkspace('packages/test', ['packages/*', '!packages/test']), false)
  assert.equal(matchesWorkspace('apps/web', ['packages/*']), false)
})
