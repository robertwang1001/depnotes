// Offline synthetic benchmark: no registry/GitHub traffic, no project writes.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { createFixtureClient } from '../e2e/fixture-client.js'
import { scanProject } from '../src/core.js'

const root = await mkdtemp(path.join(os.tmpdir(), 'depnotes-bench-'))
try {
  const n = Number(process.env.DEPNOTES_BENCH_WORKSPACES || 25)
  if (!Number.isInteger(n) || n < 1 || n > 200)
    throw new Error('DEPNOTES_BENCH_WORKSPACES must be between 1 and 200')
  process.env.XDG_CONFIG_HOME = path.join(root, 'config')
  process.env.HOME = root
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'synthetic',
    packageManager: 'npm@10.9.0',
    workspaces: ['packages/*'],
  }))
  await mkdir(path.join(root, 'packages'))
  for (let i = 0; i < n; i++) {
    const folder = path.join(root, 'packages', String(i))
    await mkdir(folder)
    await writeFile(path.join(folder, 'package.json'), JSON.stringify({
      name: `bench-${i}`,
      dependencies: { 'react': '^19.0.0', 'tiny-dep': '^1.0.0' },
    }))
  }
  const client = createFixtureClient({ delayMs: 5 })
  const start = performance.now()
  const result = await scanProject(root, { client })
  const elapsed = performance.now() - start
  console.log(JSON.stringify({
    type: 'synthetic-offline',
    workspaces: n,
    dependencies: result.items.length,
    ms: Number(elapsed.toFixed(1)),
    requests: client.metrics().requests,
  }, null, 2))
}
finally {
  await rm(root, { recursive: true, force: true })
}
