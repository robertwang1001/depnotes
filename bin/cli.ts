#!/usr/bin/env node
import type { JsonClient } from '../src/types.js'
import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { errorCode, errorMessage } from '../src/validation.js'
import { VERSION } from '../src/version.js'

type BrowserSpawner = (command: string, args: string[], options: {
  detached: boolean
  stdio: 'ignore'
  windowsHide: boolean
}) => { on: (event: 'error', listener: (error: Error) => void) => unknown, unref: () => void }
interface CliOptions {
  command: string
  dir: string
  port: number
  open: boolean
  json: boolean
  all: boolean
  package?: string
}
export const HELP = `Depnotes v${VERSION}

Usage:
  depnotes [--dir PATH] [--port PORT] [--no-open]
  depnotes list [--dir PATH] [--json] [--all]
  depnotes check PACKAGE [--dir PATH]

Commands:
  (default)      Launch the local web dashboard
  list           Print available upgrades (or all dependencies with --all)
  check PACKAGE  Print GitHub release notes for one outdated package

Options:
  -d, --dir PATH   Directory containing package.json (default: current directory)
  -p, --port N     Local server port (default: automatic)
  --no-open       Don't launch a browser
  --json          Machine-readable JSON for list
  --all           Include current and skipped dependencies in list
  -h, --help      Show this help
  -v, --version   Print version

Environment:
  GITHUB_TOKEN    Optional token to increase GitHub API rate limits
`
export function parseArgs(args: string[]) {
  const out: CliOptions = {
    command: 'dashboard',
    dir: process.cwd(),
    port: 0,
    open: true,
    json: false,
    all: false,
  }
  const tokens = [...args]
  if (tokens[0] && !tokens[0].startsWith('-'))
    out.command = tokens.shift()!
  if (out.command === 'check') {
    if (!tokens[0] || tokens[0].startsWith('-'))
      throw new Error('check requires a package name')
    out.package = tokens.shift()
  }
  for (let i = 0; i < tokens.length; i++) {
    const flag = tokens[i]
    if (flag === '--dir' || flag === '-d') {
      if (!tokens[i + 1])
        throw new Error(`${flag} requires a value`)
      out.dir = path.resolve(tokens[++i])
    }
    else if (flag === '--port' || flag === '-p') {
      const value = tokens[++i]
      if (!/^\d+$/.test(value || '') || Number(value) > 65535)
        throw new Error('Port must be between 0 and 65535')
      out.port = Number(value)
    }
    else if (flag === '--no-open') {
      out.open = false
    }
    else if (flag === '--json') {
      out.json = true
    }
    else if (flag === '--all') {
      out.all = true
    }
    else if (flag === '--help' || flag === '-h') {
      out.command = 'help'
    }
    else if (flag === '--version' || flag === '-v') {
      out.command = 'version'
    }
    else {
      throw new Error(`Unknown option: ${flag}`)
    }
  }
  if (![
    'dashboard',
    'list',
    'check',
    'help',
    'version',
  ].includes(out.command)) {
    throw new Error(`Unknown command: ${out.command}`)
  }
  return out
}
export function openBrowser(url: string, { platform = process.platform, spawnImpl = spawn }: {
  platform?: NodeJS.Platform
  spawnImpl?: BrowserSpawner
} = {}) {
  const settings = platform === 'win32'
    ? {
        cmd: 'cmd',
        args: ['/c', 'start', '', url],
      }
    : platform === 'darwin'
      ? {
          cmd: 'open',
          args: [url],
        }
      : {
          cmd: 'xdg-open',
          args: [url],
        }
  const child = spawnImpl(settings.cmd, settings.args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', error => console.error(`Could not open browser automatically: ${errorMessage(error)}`))
  child.unref()
}
export async function run(options: CliOptions, { client, out = console.log }: {
  client?: JsonClient
  out?: (value: string) => void
} = {}) {
  if (options.command === 'help') {
    out(HELP)
    return
  }
  if (options.command === 'version') {
    out(VERSION)
    return
  }
  // Give an actionable error before loading optional third-party dependencies.
  try {
    const manifest = JSON.parse(await readFile(path.join(options.dir, 'package.json'), 'utf8'))
    if (!manifest || typeof manifest !== 'object')
      throw new Error('Invalid manifest')
  }
  catch (error) {
    throw new Error(`Cannot read project package.json in ${options.dir}. Run depnotes from a project directory or use --dir PATH. (${errorMessage(error)})`)
  }
  let core
  try {
    core = await import('../src/core.js')
  }
  catch (error) {
    if (errorCode(error) === 'ERR_MODULE_NOT_FOUND')
      throw new Error(`Depnotes dependencies are missing. Go to the extracted Depnotes directory and run npm install, then npm link. (${errorMessage(error)})`)
    throw error
  }
  const { scanProject, createClient, getReleaseNotes } = core
  const effectiveClient = client ?? createClient()
  if (options.command === 'dashboard') {
    const { createServer, listen } = await import('../src/server.js')
    const server = createServer({ project: options.dir, client: effectiveClient })
    const url = await listen(server, { port: options.port })
    out(`Depnotes v${VERSION} is running\nDashboard: ${url}\nProject: ${options.dir}\nPress Ctrl+C to stop.`)
    if (options.open)
      openBrowser(url)
    return server
  }
  const result = await scanProject(options.dir, { client: effectiveClient })
  if (options.command === 'list') {
    const matches = options.all
      ? result.items
      : result.items.filter(x => x.status === 'outdated')
    if (options.json) {
      out(JSON.stringify({ ...result, items: matches }, null, 2))
      return
    }
    if (result.warning)
      out(`Warning: ${result.warning}`)
    out(`Project manager: ${result.manager.name}${result.manager.version
      ? `@${result.manager.version}`
      : ''} (${result.manager.detectedBy}); lockfile: ${result.manager.lockfile || 'none'}`)
    out(`Node runtime: ${result.runtime.node}`)
    out(`Release-age policy: ${result.config.minimumReleaseAge} minutes (${result.config.source})`)
    if (!matches.length) {
      out('No matching dependencies.')
      return
    }
    const rows = matches.map(x => [
      x.workspaceName,
      x.name,
      x.current || '—',
      x.latest || '—',
      x.kind || x.status,
    ])
    const titles = [
      'WORKSPACE',
      'PACKAGE',
      'INSTALLED',
      'TARGET',
      'UPDATE',
    ]
    const widths = titles.map((t, i) => Math.max(t.length, ...rows.map(r => String(r[i]).length)))
    out([titles, ...rows].map(row => row.map((v, i) => String(v).padEnd(widths[i])).join('  ').trimEnd()).join('\n'))
    return
  }
  const matches = result.items.filter(x => x.name === options.package && x.status === 'outdated')
  if (!matches.length)
    throw new Error(`No outdated dependency named ${options.package} found`)
  for (const item of matches) {
    out(`\n${item.name} (${item.workspaceName}): ${item.current} → ${item.latest}`)
    if (!item.repo) {
      out('No GitHub repository found in registry metadata.')
      continue
    }
    const notes = await getReleaseNotes({
      name: item.name,
      from: item.current!,
      to: item.latest!,
      repo: item.repo,
    }, { client: effectiveClient })
    out(notes.message || '')
    if (notes.changelog?.url) {
      out(`\nChangelog: ${notes.changelog.url}`)
      for (const section of notes.changelog.sections)
        out(`\n${section.heading}\n${section.body}`)
    }
    if (notes.guides?.length)
      out(`\nMigration references:\n${notes.guides.map(g => `- ${g.title}: ${g.url}`).join('\n')}`)
    if (notes.warnings?.length) {
      for (const warning of notes.warnings)
        out(`Warning: ${warning}`)
    }
    for (const release of notes.releases)
      out(`\n${release.title} — ${release.url}\n${release.body}`)
  }
}
// npm link runs this executable through a symlink. Resolve both paths.
export function isEntrypoint(invokedPath = process.argv[1], moduleUrl = import.meta.url) {
  if (!invokedPath)
    return false
  try {
    return realpathSync(path.resolve(invokedPath)) === realpathSync(fileURLToPath(moduleUrl))
  }
  catch {
    return false
  }
}
const entry = isEntrypoint()
if (entry) {
  try {
    const options = parseArgs(process.argv.slice(2))
    await run(options)
  }
  catch (error) {
    console.error(`Error: ${errorMessage(error)}`)
    process.exitCode = 1
  }
}
