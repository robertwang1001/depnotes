import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { inspectGit, summarizeGitStatus } from '../src/git-safety.js'

const exec = promisify(execFile)
test('porcelain parser distinguishes staged, unstaged, untracked and renames', () => {
  const summary = summarizeGitStatus('M  a.txt\0 M b.txt\0?? new.txt\0R  to.txt\0from.txt\0')
  assert.equal(summary.staged, 2)
  assert.equal(summary.unstaged, 1)
  assert.equal(summary.untracked, 1)
  assert.equal(summary.dirty, true)
})
test('Git preflight detects changes without mutating the index', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'depnotes-git-'))
  try {
    try {
      await exec('git', ['init', '-q'], { cwd: dir })
    }
    catch {
      t.skip('git unavailable')
      return
    }
    await exec('git', ['config', 'user.email', 'example@example.test'], { cwd: dir })
    await exec('git', ['config', 'user.name', 'Test User'], { cwd: dir })
    await writeFile(path.join(dir, 'a.txt'), 'original')
    await exec('git', ['add', 'a.txt'], { cwd: dir })
    await exec('git', ['commit', '-qm', 'initial'], { cwd: dir })
    const clean = await inspectGit(dir)
    assert.equal(clean.state, 'clean')
    await writeFile(path.join(dir, 'a.txt'), 'changed')
    await writeFile(path.join(dir, 'b.txt'), 'new')
    const dirty = await inspectGit(dir)
    assert.equal(dirty.state, 'dirty')
    assert.equal(dirty.unstaged, 1)
    assert.equal(dirty.untracked, 1)
    await exec('git', ['add', 'a.txt'], { cwd: dir })
    const staged = await inspectGit(dir)
    assert.equal(staged.staged, 1)
    assert.equal(staged.untracked, 1)
    const { stdout } = await exec('git', ['diff', '--cached', '--name-only'], { cwd: dir })
    assert.equal(stdout.trim(), 'a.txt')
  }
  finally {
    await rm(dir, { recursive: true, force: true })
  }
})
test('Git preflight returns unknown instead of treating failure as clean', async () => {
  const result = await inspectGit(os.tmpdir(), {
    run: async () => {
      const error = Object.assign(new Error('missing'), { code: 'ENOENT' })
      throw error
    },
  })
  assert.equal(result.state, 'unknown')
  assert.match(result.reason!, /not installed/)
})
