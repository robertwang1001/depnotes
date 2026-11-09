import type { GithubRelease, Packument } from '../src/types.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createFixtureClient } from '../e2e/fixture-client.js'

test('fixture provides deterministic npm registry metadata without network', async () => {
  const client = createFixtureClient({ delayMs: 0 })
  const metadata = await client.json('https://registry.npmjs.org/react') as Packument
  assert.equal(metadata['dist-tags']!.latest, '19.2.0')
  assert.ok(metadata.time!['19.2.0'])
  assert.equal(client.metrics().requests, 1)
})
test('fixture supplies changelog-shaped GitHub release data', async () => {
  const client = createFixtureClient({ delayMs: 0 })
  const releases = await client.json('https://api.github.com/repos/facebook/react/releases?per_page=100&page=1') as GithubRelease[]
  assert.equal(releases[0].tag_name, 'v19.2.0')
  assert.match(releases[0].body!, /\*\*Better rendering\*\*/)
})
test('unrecognized fixture package fails instead of using live network', async () => {
  const client = createFixtureClient({ delayMs: 0 })
  await assert.rejects(() => client.json('https://registry.npmjs.org/no-such-test-package'), /Fixture package not found/)
})
