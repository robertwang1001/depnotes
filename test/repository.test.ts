import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { resolveGithubRepository, scanProject } from '../src/core.js'

const abbreviated = {
  'dist-tags': { latest: '2.0.0' },
  'versions': { '1.0.0': {}, '1.5.0': {}, '2.0.0': {} },
}
test('resolves repository from version manifest without full metadata download', async () => {
  const calls: string[] = []
  const client = {
    json: async (url: string) => {
      calls.push(url)
      return {
        repository: { type: 'git', url: 'git+https://github.com/example/library.git' },
      }
    },
  }
  const repo = await resolveGithubRepository({
    name: '@example/library',
    latest: '2.0.0',
    current: '1.0.0',
    packument: abbreviated,
    client,
  })
  assert.equal(repo, 'example/library')
  assert.deepEqual(calls, ['https://registry.npmjs.org/%40example%2Flibrary/2.0.0'])
})
test('does not fetch a version manifest when repository metadata already exists', async () => {
  const repo = await resolveGithubRepository({
    name: 'library',
    latest: '2.0.0',
    current: '1.0.0',
    packument: { repository: 'https://github.com/example/library' },
    client: {
      json: () => {
        throw new Error('unnecessary request')
      },
    },
  })
  assert.equal(repo, 'example/library')
})
test('falls back to installed-version manifest and GitHub homepage', async () => {
  const calls: string[] = []
  const repo = await resolveGithubRepository({
    name: 'library',
    latest: '2.0.0',
    current: '1.0.0',
    packument: abbreviated,
    client: {
      json: async (url: string) => {
        calls.push(url)
        return url.endsWith('/1.0.0')
          ? { homepage: 'https://github.com/example/library#readme' }
          : {}
      },
    },
  })
  assert.equal(repo, 'example/library')
  assert.equal(calls.length, 2)
})
test('scanner retrieves repositories for outdated dependencies after abbreviated registry request', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'depnotes-repo-'))
  try {
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'test-app',
      dependencies: { react: '^1.0.0' },
    }))
    await writeFile(path.join(dir, 'depnotes.config.json'), JSON.stringify({ minimumReleaseAge: 0 }))
    const calls: {
      url: string
      headers?: Record<string, string>
    }[] = []
    const result = await scanProject(dir, {
      client: {
        json: async (url, headers) => {
          calls.push({ url, headers })
          if (url.endsWith('/react'))
            return abbreviated
          if (url.endsWith('/react/2.0.0')) {
            return {
              repository: { url: 'git+https://github.com/facebook/react.git' },
            }
          }
          throw new Error(`Unexpected URL ${url}`)
        },
      },
    })
    assert.equal(result.items[0].status, 'outdated')
    assert.equal(result.items[0].repo, 'facebook/react')
    assert.match(calls[0].headers!.Accept, /npm\.install-v1/)
    assert.equal(calls.length, 2)
  }
  finally {
    await rm(dir, { recursive: true, force: true })
  }
})
