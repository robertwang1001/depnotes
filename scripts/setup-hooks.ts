import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// npm installs from ZIP/tarballs must remain usable without a .git directory.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const git = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' })
if (git.status !== 0 || !git.stdout?.trim() || !existsSync(join(root, 'node_modules', 'simple-git-hooks'))) {
  console.log('Skipping Git hook installation (not a Git checkout or tools unavailable).')
  process.exit(0)
}
if (git.stdout.trim() !== root) {
  console.log('Skipping hooks in nested/consumer projects.')
  process.exit(0)
}
const result = spawnSync('pnpm', ['exec', 'simple-git-hooks'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
process.exit(result.status ?? 1)
