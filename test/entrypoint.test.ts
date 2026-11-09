import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { isEntrypoint } from '../bin/cli.js'

const version = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version
const executable = fileURLToPath(new URL('../bin/cli.js', import.meta.url))
test('recognizes actual entry file', () => assert.equal(isEntrypoint(executable), true))
test('recognizes symlinked npm bin', () => {
  const dir = mkdtempSync(join(tmpdir(), 'depnotes-bin-'))
  try {
    const symlink = join(dir, 'depnotes')
    symlinkSync(executable, symlink)
    assert.equal(isEntrypoint(symlink), true)
    const result = spawnSync(process.execPath, [symlink, '--version'], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), version)
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('direct invocation prints help', () => {
  const result = spawnSync(process.execPath, [executable, '--help'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Usage:/)
})
