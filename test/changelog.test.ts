import assert from 'node:assert/strict'
import test from 'node:test'
import { discoverRepositoryNotes, extractVersion, parseChangelog } from '../src/changelog.js'

test('parse only version headings in the upgrade interval', () => {
  const markdown = `# Changelog\n## v3.0.0\nBreaking v3.\n### Fixes\nFixed.\n## 2.5.0\nMinor.\n## 2.4.0\nOld.\n## v4.0.0\nFuture.`
  const sections = parseChangelog(markdown.replaceAll('\\n', '\n'), { name: 'demo', from: '2.4.0', to: '3.0.0' })
  assert.deepEqual(sections.map(x => x.version), ['3.0.0', '2.5.0'])
  assert.match(sections[0].body, /Fixed/)
})
test('do not treat prose containing versions as version headings', () => {
  assert.equal(extractVersion('Migration from version 3.0.0', 'demo'), null)
  assert.equal(extractVersion('demo@2.0.0', 'demo'), '2.0.0')
  assert.equal(extractVersion('[2.1.0] - 2026-11-01', 'demo'), '2.1.0')
  assert.equal(extractVersion('Version 2.2.0', 'demo'), '2.2.0')
})
test('discover notes with mock GitHub API', async () => {
  const calls = []
  const client = {
    json: async (url: string) => {
      calls.push(url)
      if (url.endsWith('/contents')) {
        return [
          { name: 'CHANGELOG.md', path: 'CHANGELOG.md', type: 'file' },
          { name: 'MIGRATION.md', path: 'MIGRATION.md', type: 'file' },
        ]
      }
      if (url.endsWith('/CHANGELOG.md')) {
        const contents = '## 2.0.0\nBreaking update.\n## 1.0.0\nOld.'
        return {
          encoding: 'base64',
          size: contents.length,
          content: Buffer.from(contents).toString('base64'),
        }
      }
      throw new Error('unexpected request')
    },
  }
  const result = await discoverRepositoryNotes({
    repo: 'owner/repo',
    name: 'demo',
    from: '1.0.0',
    to: '2.0.0',
    client,
  })
  assert.equal(result.changelog!.sections.length, 1)
  assert.equal(result.guides.length, 1)
  assert.equal(calls.length, 2)
})
test('missing changelog is a warning, not false coverage', async () => {
  const result = await discoverRepositoryNotes({
    repo: 'owner/repo',
    name: 'demo',
    from: '1.0.0',
    to: '2.0.0',
    client: {
      json: async url => url.endsWith('/contents')
        ? []
        : Promise.reject(new Error('Not found')),
    },
  })
  assert.equal(result.changelog, null)
  assert.ok(result.warnings.length)
})
