import { spawnSync } from 'node:child_process'
import { chmod, cp, mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'dist')
await rm(output, { recursive: true, force: true })
const compiler = path.join(root, 'node_modules/typescript/bin/tsc')
const result = spawnSync(process.execPath, [compiler], { cwd: root, stdio: 'inherit' })
if (result.error)
  throw result.error
if (result.status !== 0)
  process.exit(result.status ?? 1)
await chmod(path.join(output, 'bin/cli.js'), 0o755)

// Keep compiled browser modules alongside the unchanged static assets.
await mkdir(path.join(output, 'public'), { recursive: true })
for (const file of await readdir(path.join(root, 'public'))) {
  if (!file.endsWith('.ts')) {
    await cp(path.join(root, 'public', file), path.join(output, 'public', file))
  }
}
await cp(path.join(root, 'e2e/fixture'), path.join(output, 'e2e/fixture'), { recursive: true })
