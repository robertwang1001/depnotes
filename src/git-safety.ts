import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { errorCode } from './validation.js'

export interface GitStatus {
  state: 'clean' | 'dirty' | 'unknown'
  root?: string
  reason?: string
  staged?: number
  unstaged?: number
  untracked?: number
  conflicts?: number
  dirty?: boolean
}
const execFileAsync = promisify(execFile)
const gitOptions = { timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true }
// Git porcelain v1 -z is stable and handles arbitrary file names. Never mutate Git state.
export function summarizeGitStatus(raw: string) {
  const records = raw.split('\0')
  const summary = {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicts: 0,
  }
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (!record || record.length < 3)
      continue
    const x = record[0]
    const y = record[1]
    if (x === '?' && y === '?') {
      summary.untracked++
      continue
    }
    if ('U'.includes(x) || 'U'.includes(y) || (x === 'A' && y === 'A') || (x === 'D' && y === 'D'))
      summary.conflicts++
    if (x !== ' ' && x !== '?')
      summary.staged++
    if (y !== ' ' && y !== '?')
      summary.unstaged++
    // In -z mode renames/copies have a second NUL-terminated path.
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C')
      i++
  }
  return {
    ...summary,
    dirty: Object.values(summary).some(Boolean),
  }
}
export async function inspectGit(project: string, { run = execFileAsync }: {
  run?: (command: string, args: string[], options: {
    cwd: string
    timeout: number
    maxBuffer: number
    windowsHide: boolean
    encoding?: 'utf8'
  }) => Promise<{ stdout: string }>
} = {}): Promise<GitStatus> {
  const cwd = path.resolve(project)
  try {
    const { stdout: root } = await run('git', ['rev-parse', '--show-toplevel'], { ...gitOptions, cwd })
    const gitRoot = path.resolve(root.trim())
    const { stdout: status } = await run('git', [
      '--no-optional-locks',
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=normal',
    ], { ...gitOptions, cwd: gitRoot, encoding: 'utf8' })
    const counts = summarizeGitStatus(status)
    return {
      state: counts.dirty ? 'dirty' : 'clean',
      root: gitRoot,
      ...counts,
    }
  }
  catch (error) {
    return {
      state: 'unknown',
      reason: errorCode(error) === 'ENOENT'
        ? 'Git is not installed or not on PATH'
        : 'Git status unavailable (not a repository, permission issue, or timeout)',
    }
  }
}
