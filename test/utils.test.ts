import assert from 'node:assert/strict'
import test from 'node:test'
import { classify, compareVersions, githubRepo, parseVersion, relevantReleases } from '../src/utils.js'

test('parse versions and ignore non-registry specs', () => {
  assert.equal(parseVersion('^1.2.3'), '1.2.3')
  assert.equal(parseVersion('workspace:*'), null)
})
test('version ordering and risk classification', () => {
  assert.equal(compareVersions('1.0.0', '2.0.0'), -1)
  assert.equal(classify('1.0.0', '2.0.0'), 'major')
  assert.equal(classify('1.2.0', '1.3.0'), 'minor')
})
test('repository normalization', () => {
  assert.equal(githubRepo({ url: 'git+https://github.com/owner/repo.git' }), 'owner/repo')
})
test('release filtering', () => {
  const releases = [
    { html_url: 'https://example.org/release', tag_name: 'v1.1.0' },
    { html_url: 'https://example.org/release', tag_name: 'v1.2.0' },
    { html_url: 'https://example.org/release', tag_name: 'v2.0.0' },
  ]
  assert.equal(relevantReleases(releases, '1.0.0', '1.2.0', 'demo').length, 2)
})
