import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const root = fileURLToPath(new URL('../../', import.meta.url))
const temporary = await mkdtemp(path.join(tmpdir(), 'depnotes-package-'))
const consumer = path.join(temporary, 'package.json')
const windows = process.platform === 'win32'

function run(command: string, args: string[], cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: windows && command !== process.execPath,
    env: {
      ...process.env,
      npm_config_cache: path.join(temporary, 'npm-cache'),
    },
  })
  if (result.error)
    throw result.error
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status}):\n${result.stderr}\n${result.stdout}`)
  return result.stdout
}

try {
  const manifest: { name: string, version: string, packageManager: string } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  // The caller builds first. Suppressing lifecycle scripts keeps this check from rebuilding.
  const output = run('npm', [
    'pack',
    '--json',
    '--ignore-scripts',
    '--pack-destination',
    temporary,
  ])
  const [packed]: { filename: string, files: { path: string }[] }[] = JSON.parse(output)
  const files = new Set(packed.files.map(file => file.path))
  for (const required of [
    'LICENSE',
    'dist/bin/cli.js',
    'dist/src/core.js',
    'dist/src/core.d.ts',
    'dist/src/core.js.map',
    'dist/public/index.html',
    'dist/public/app.js',
    'dist/public/dom.js',
    'dist/public/format.js',
    'dist/public/notes.js',
  ])
    assert.ok(files.has(required), `Package is missing ${required}`)
  assert.ok(![...files].some(file => /^(?:src|test|e2e|dist\/test|dist\/e2e)\//.test(file)), 'Package contains development fixtures or tests')

  await writeFile(consumer, JSON.stringify({
    name: 'depnotes-package-smoke',
    private: true,
    type: 'module',
    packageManager: manifest.packageManager,
  }))
  // Reuse this checkout’s store and consult the registry if package metadata is missing.
  const modules = YAML.parse(await readFile(path.join(root, 'node_modules/.modules.yaml'), 'utf8')) as { storeDir: string }
  run('pnpm', [
    'add',
    '--prefer-offline',
    '--ignore-scripts',
    '--store-dir',
    modules.storeDir,
    path.join(temporary, packed.filename),
  ], temporary)

  const installedRoot = path.join(temporary, 'node_modules/depnotes')
  const sourceMap = JSON.parse(await readFile(path.join(installedRoot, 'dist/src/core.js.map'), 'utf8')) as { sourcesContent?: string[] }
  assert.ok(sourceMap.sourcesContent?.[0]?.includes('scanProject'), 'Installed source map must include the TypeScript source')
  const executable = path.join(installedRoot, 'dist/bin/cli.js')
  assert.equal(run(process.execPath, [executable, '--version'], temporary).trim(), manifest.version)
  const help = run(process.execPath, [executable, '--help'], temporary)
  assert.ok(help.includes(`Depnotes v${manifest.version}`))
  assert.match(help, /Usage:/)
  // Exercise the public package export and a deterministic registry scan in the consumer.
  const consumerCheck = `
    import assert from 'node:assert/strict';
    import { mkdtemp, writeFile, rm } from 'node:fs/promises';
    import { tmpdir } from 'node:os';
    import path from 'node:path';
    import { scanProject } from 'depnotes/core';
    const root = await mkdtemp(path.join(tmpdir(), 'depnotes-consumer-project-'));
    try {
      await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { react: '^19.0.0' } }));
      await writeFile(path.join(root, 'depnotes.config.json'), JSON.stringify({ minimumReleaseAge: 0 }));
      const client = { json: async () => ({ 'dist-tags': { latest: '19.2.0' }, versions: { '19.0.0': {}, '19.2.0': {} }, repository: { url: 'https://github.com/facebook/react' } }) };
      const result = await scanProject(root, { client });
      assert.equal(result.items[0].status, 'outdated');
      assert.equal(result.items[0].latest, '19.2.0');
    } finally { await rm(root, { recursive: true, force: true }); }
  `
  run(process.execPath, ['--input-type=module', '-e', consumerCheck], temporary)

  // A real installed CLI serves the same assets as an installed user receives.
  const server = spawn(process.execPath, [executable, '--no-open', '--dir', root], {
    cwd: temporary,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    const address = await new Promise<string>((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      const timeout = setTimeout(() => reject(new Error('Installed CLI did not start within 10 seconds')), 10000)
      server.stderr.on('data', (chunk) => {
        stderr += String(chunk)
      })
      server.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      server.once('exit', (code) => {
        clearTimeout(timeout)
        reject(new Error(`Installed CLI exited (${code}): ${stderr}`))
      })
      server.stdout.on('data', (chunk) => {
        stdout += String(chunk)
        const match = stdout.match(/Dashboard: (http:\/\/127\.0\.0\.1:\d+)/)
        if (match) {
          clearTimeout(timeout)
          resolve(match[1])
        }
      })
    })
    for (const asset of [
      '/',
      '/app.js',
      '/dom.js',
      '/format.js',
      '/notes.js',
      '/style.css',
      '/logo.svg',
      '/api/health',
    ]) {
      const response = await fetch(`${address}${asset}`)
      assert.equal(response.status, 200, `${asset} returned ${response.status}`)
      assert.ok((await response.text()).length > 0, `${asset} was empty`)
    }
  }
  finally {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill()
      await new Promise<void>(resolve => server.once('close', () => resolve()))
    }
  }
  console.log(`Installed ${manifest.name}@${manifest.version}: CLI, core scan, source maps, and dashboard assets passed.`)
}
finally {
  await rm(temporary, { recursive: true, force: true })
}
