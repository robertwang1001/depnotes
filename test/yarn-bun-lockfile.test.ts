import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import YAML from 'yaml'
import { extractBunResolutions, extractYarnResolutions, parseBunLock, readWorkspace } from '../src/lockfile.js'

const manifest = {
  dependencies: { 'react': '^19.0.0', '@scope/lib': '~2.1.0' },
  devDependencies: { typescript: '^5.0.0' },
}
test('Yarn Classic: scoped and unscoped direct deps', () => {
  const lock = `# yarn lockfile v1\nreact@^19.0.0:\n  version "19.2.0"\n\n"@scope/lib@~2.1.0":\n  version "2.1.4"\n\ntypescript@^5.0.0:\n  version "5.9.3"\n`
  assert.deepEqual(extractYarnResolutions(lock, manifest), { 'dependencies:react': '19.2.0', 'dependencies:@scope/lib': '2.1.4', 'devDependencies:typescript': '5.9.3' })
})
test('modern Yarn: __metadata and resolution entries', () => {
  const lock = `__metadata:\n  version: 8\n  cacheKey: 10\n"react@npm:^19.0.0":\n  version: 19.2.0\n  resolution: "react@npm:19.2.0"\n"typescript@npm:^5.0.0":\n  version: 5.9.3\n  resolution: "typescript@npm:5.9.3"\n`
  assert.deepEqual(extractYarnResolutions(lock, manifest, YAML.parse(lock)), { 'dependencies:react': '19.2.0', 'devDependencies:typescript': '5.9.3' })
})
test('bun.lock: comments, trailing commas and strings containing comment-like text', () => {
  const lock = parseBunLock(`{\n  // comment\n  "link": "https://example.com/a//b",\n  "workspaces": {"": {"dependencies": {"react": "^19.0.0",},},},\n  "packages": {"react": ["react@19.2.0", {}, "",],},\n}`)
  assert.equal(lock.link, 'https://example.com/a//b')
  assert.equal(extractBunResolutions(lock, {
    dependencies: { react: '^19.0.0' },
  })['dependencies:react'], '19.2.0')
})
test('bun.lock: mismatched specifiers cannot be treated as lockfile resolutions', () => {
  const lock = {
    workspaces: {
      '': {
        dependencies: { react: '^18.0.0' },
      },
    },
    packages: {
      react: ['react@19.2.0', {}, ''],
    },
  }
  assert.deepEqual(extractBunResolutions(lock, {
    dependencies: { react: '^19.0.0' },
  }), {})
})
test('readWorkspace uses Bun text resolutions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'depnotes-bun-'))
  try {
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: 'demo',
      packageManager: 'bun@1.2.0',
      dependencies: { react: '^19.0.0' },
    }))
    await writeFile(path.join(root, 'bun.lock'), JSON.stringify({
      lockfileVersion: 1,
      workspaces: {
        '': {
          dependencies: { react: '^19.0.0' },
        },
      },
      packages: {
        react: ['react@19.2.0', {}, ''],
      },
    }))
    const result = await readWorkspace(root)
    assert.equal(result.packages[0].resolutions['dependencies:react'], '19.2.0')
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})
