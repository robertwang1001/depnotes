import type { AddressInfo } from 'node:net'
import type { GitStatus } from './git-safety.js'
import type { DependencyItem, JsonClient, ReleaseRequest, ScanEvent, ScanInfo, ScanResult } from './types.js'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadProjectConfig, saveProjectConfig, saveUserConfig, userConfigPath } from './config.js'
import { createClient, getReleaseNotes, scanProject } from './core.js'
import { inspectGit } from './git-safety.js'
import { renderNotesForDashboard } from './markdown.js'
import { createScanJournal } from './scan-journal.js'
import { batchUpgradeCommands, runUpgrade, validateWorkspace } from './upgrade.js'
import { errorMessage } from './validation.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public')
const assets: Record<string, string> = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/app.js': 'app.js',
  '/dom.js': 'dom.js',
  '/format.js': 'format.js',
  '/notes.js': 'notes.js',
  '/style.css': 'style.css',
  '/logo.svg': 'logo.svg',
  '/favicon.svg': 'favicon.svg',
}
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
}
function respond(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(data))
}
export function createServer({ project = process.cwd(), client = createClient(), scanTtl = 30000, notesTtl = 120000, upgradeRunner = runUpgrade, gitInspector = inspectGit }: {
  project?: string
  client?: JsonClient
  scanTtl?: number
  notesTtl?: number
  upgradeRunner?: typeof runUpgrade
  gitInspector?: typeof inspectGit
} = {}) {
  let scanCached: {
    at: number
    value: ScanResult
    info: ScanInfo
  } | null = null
  let scanPending: Promise<ScanResult> | null = null
  let lastScanFailure: {
    at: string
    message: string
  } | null = null
  const upgradePlans = new Map<string, {
    items: DependencyItem[]
    commands: ReturnType<typeof batchUpgradeCommands>
    git: GitStatus
    createdAt: number
  }>()
  let upgradeRunning = false
  const journal = createScanJournal()
  const publish = (event: ScanEvent) => journal.publish(event)
  let cacheSettings = { scanCacheSeconds: scanTtl / 1000, notesCacheSeconds: notesTtl / 1000 }
  type DashboardNotes = ReturnType<typeof renderNotesForDashboard>
  const notesCache = new Map<string, {
    at: number
    value: DashboardNotes
  }>()
  const notesPending = new Map<string, Promise<DashboardNotes>>()
  const getScan = async () => {
    if (scanCached && Date.now() - scanCached.at < cacheSettings.scanCacheSeconds * 1000) {
      return {
        ...scanCached.value,
        scanInfo: { ...scanCached.info, cached: true },
      }
    }
    if (scanPending)
      return scanPending
    const start = performance.now()
    journal.begin()
    scanPending = scanProject(project, { client, onProgress: publish }).then((value) => {
      const info = {
        durationMs: Math.round(performance.now() - start),
        scannedAt: new Date().toISOString(),
        cached: false,
        requests: typeof client.metrics === 'function'
          ? client.metrics()
          : undefined,
      }
      cacheSettings = { scanCacheSeconds: value.config.scanCacheSeconds, notesCacheSeconds: value.config.notesCacheSeconds }
      scanCached = {
        at: Date.now(),
        value,
        info,
      }
      const result = { ...value, scanInfo: info }
      return result
    }).catch((error) => {
      lastScanFailure = {
        at: new Date().toISOString(),
        message: errorMessage(error),
      }
      throw error
    }).finally(() => {
      scanPending = null
      journal.end()
    })
    return scanPending
  }
  const getNotes = async (params: ReleaseRequest) => {
    const key = JSON.stringify([
      params.name,
      params.from,
      params.to,
      params.repo,
    ])
    const cached = notesCache.get(key)
    if (cached && Date.now() - cached.at < cacheSettings.notesCacheSeconds * 1000)
      return cached.value
    if (notesPending.has(key))
      return notesPending.get(key)
    const task = getReleaseNotes(params, { client }).then(renderNotesForDashboard).then((value) => {
      notesCache.delete(key)
      notesCache.set(key, {
        at: Date.now(),
        value,
      })
      while (notesCache.size > 100)
        notesCache.delete(notesCache.keys().next().value!)
      return value
    }).finally(() => notesPending.delete(key))
    notesPending.set(key, task)
    return task
  }
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      if (url.pathname === '/api/upgrade/preview' || url.pathname === '/api/upgrade/apply') {
        if (req.method !== 'POST')
          return respond(res, 405, { error: 'Method not allowed' })
        const host = req.headers.host || ''
        if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host) || req.headers.origin !== `http://${host}`)
          return respond(res, 403, { error: 'Upgrades must be initiated from the local dashboard' })
        if (!String(req.headers['content-type'] || '').startsWith('application/json'))
          return respond(res, 415, { error: 'Expected JSON' })
        let text = ''
        for await (const chunk of req) {
          text += chunk
          if (text.length > 4096)
            return respond(res, 413, { error: 'Request too large' })
        }
        let body
        try {
          body = JSON.parse(text)
        }
        catch {
          return respond(res, 400, { error: 'Invalid JSON' })
        }
        if (url.pathname.endsWith('/preview')) {
          if (upgradeRunning || scanPending)
            return respond(res, 409, { error: 'A scan or upgrade is in progress' })
          if (!scanCached || Date.now() - scanCached.at > 300000)
            return respond(res, 409, { error: 'Scan results are missing or stale. Rescan first.' })
          const selections = Array.isArray(body.items)
            ? body.items
            : [body]
          if (!selections.length || selections.length > 100)
            return respond(res, 400, { error: 'Select 1 to 100 upgrades' })
          const items = []
          const seen = new Set()
          for (const selection of selections) {
            const item = scanCached.value.items.find(x => x.name === selection?.name && x.importer === selection?.importer && x.section === selection?.section && x.latest === selection?.target && x.status === 'outdated')
            if (!item)
              return respond(res, 400, { error: 'A selection is not eligible in the latest scan. Rescan and select again.' })
            const id = JSON.stringify([item.importer, item.section, item.name])
            if (seen.has(id))
              return respond(res, 400, { error: `Duplicate selected dependency: ${item.name}` })
            seen.add(id)
            items.push(item)
          }
          try {
            // Validate all manifest declarations before a preview is issued.
            for (const item of items)
              await validateWorkspace(project, item)
            const commands = batchUpgradeCommands(scanCached.value.manager.name, items)
            const token = randomUUID()
            upgradePlans.clear()
            const git = await gitInspector(project)
            upgradePlans.set(token, {
              items,
              commands,
              git,
              createdAt: Date.now(),
            })
            return respond(res, 200, {
              token,
              git,
              items: items.map(item => ({
                name: item.name,
                from: item.current,
                to: item.latest,
                workspace: item.workspaceName,
                importer: item.importer,
                section: item.section,
              })),
              commands: commands.map(cmd => ({
                command: cmd.display,
                importer: cmd.importer,
                section: cmd.section,
                packages: cmd.items.length,
              })),
              warning: 'Commands run sequentially and stop on the first failure. Previous successful commands are not rolled back. Package-manager scripts may execute. Commit your work before continuing.',
            })
          }
          catch (error) {
            return respond(res, 400, {
              error: errorMessage(error),
            })
          }
        }
        if (upgradeRunning)
          return respond(res, 409, { error: 'An upgrade is already running' })
        const plan = upgradePlans.get(body.token)
        upgradePlans.delete(body.token)
        if (!plan || Date.now() - plan.createdAt > 120000)
          return respond(res, 409, { error: 'Upgrade confirmation expired. Preview again.' })
        if (body.confirm !== true)
          return respond(res, 400, { error: 'Explicit confirmation required' })
        if (plan.git.state !== 'clean' && body.acknowledgeGitRisk !== true)
          return respond(res, 400, { error: 'Acknowledge the Git working-tree risk before upgrading' })
        if (scanPending)
          return respond(res, 409, { error: 'Wait for the scan to finish' })
        upgradeRunning = true
        try {
          // Revalidate *all* selections immediately before running the first command.
          const workspaces = new Map<string, string>()
          for (const item of plan.items)
            workspaces.set(item.importer, await validateWorkspace(project, item))
          const results = []
          for (const cmd of plan.commands) {
            let result
            try {
              result = await upgradeRunner({
                command: cmd.command,
                args: cmd.args,
                cwd: workspaces.get(cmd.importer)!,
              })
            }
            catch (error) {
              result = { ok: false, exitCode: null, output: `Command could not start or failed unexpectedly: ${errorMessage(error)}` }
            }
            results.push({
              ...result,
              command: cmd.display,
              importer: cmd.importer,
              section: cmd.section,
            })
            if (!result.ok)
              break
          }
          scanCached = null
          notesCache.clear()
          upgradePlans.clear()
          const ok = results.length === plan.commands.length && results.every(r => r.ok)
          const pending = plan.commands.slice(results.length).map(cmd => ({
            command: cmd.display,
            importer: cmd.importer,
            section: cmd.section,
            packages: cmd.items.map(item => item.name),
          }))
          const gitAfter = await gitInspector(project)
          return respond(res, ok ? 200 : 500, {
            ok,
            results,
            pending,
            gitAfter,
            completed: results.filter(r => r.ok).length,
            total: plan.commands.length,
            warning: ok ? 'All selected upgrades completed. Rescan and run your project tests.' : 'Upgrade stopped after a failure. Some files may have changed. Review command outputs and your Git diff before retrying.',
          })
        }
        catch (error) {
          scanCached = null
          return respond(res, 500, { error: `Upgrade failed: ${errorMessage(error)}` })
        }
        finally {
          upgradeRunning = false
        }
      }
      if (url.pathname === '/api/settings') {
        if (req.method === 'GET') {
          const { detectPackageManager } = await import('./package-manager.js')
          const manifest = JSON.parse(await fs.readFile(path.join(path.resolve(project), 'package.json'), 'utf8'))
          const manager = await detectPackageManager(project, manifest)
          const config = await loadProjectConfig(project, { manager: manager.name })
          return respond(res, 200, {
            config,
            configFile: path.join(path.resolve(project), 'depnotes.config.json'),
            userConfigFile: userConfigPath(),
            manager: manager.name,
          })
        }
        if (req.method !== 'PUT')
          return respond(res, 405, { error: 'Method not allowed' })
        const origin = req.headers.origin
        const expected = `http://${req.headers.host}`
        if (!origin || origin !== expected || !/^127\.0\.0\.1(?::\d+)?$|^localhost(?::\d+)?$/.test(req.headers.host || ''))
          return respond(res, 403, { error: 'Settings changes are restricted to the local dashboard' })
        if (!String(req.headers['content-type'] || '').startsWith('application/json'))
          return respond(res, 415, { error: 'Expected JSON' })
        let body = ''
        for await (const chunk of req) {
          body += chunk
          if (body.length > 16384)
            return respond(res, 413, { error: 'Settings request is too large' })
        }
        let payload
        try {
          payload = JSON.parse(body)
        }
        catch {
          return respond(res, 400, { error: 'Invalid JSON' })
        }
        const scope = url.searchParams.get('scope') || 'user'
        if (!['user', 'project'].includes(scope))
          return respond(res, 400, { error: 'Invalid settings scope' })
        try {
          if (scope === 'user')
            await saveUserConfig(payload)
          else
            await saveProjectConfig(project, payload)
        }
        catch (error) {
          return respond(res, 400, {
            error: errorMessage(error),
          })
        }
        scanCached = null
        notesCache.clear()
        upgradePlans.clear()
        const { detectPackageManager } = await import('./package-manager.js')
        const manifest = JSON.parse(await fs.readFile(path.join(path.resolve(project), 'package.json'), 'utf8'))
        const manager = await detectPackageManager(project, manifest)
        const config = await loadProjectConfig(project, { manager: manager.name })
        cacheSettings = { scanCacheSeconds: config.scanCacheSeconds, notesCacheSeconds: config.notesCacheSeconds }
        return respond(res, 200, {
          config,
          configFile: path.join(path.resolve(project), 'depnotes.config.json'),
          userConfigFile: userConfigPath(),
          manager: manager.name,
        })
      }
      if (req.method !== 'GET')
        return respond(res, 405, { error: 'Method not allowed' })
      if (url.pathname === '/api/scan/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Content-Type-Options': 'nosniff',
        })
        res.flushHeaders()
        let closed = false
        const emit = (event: ScanEvent) => {
          if (!closed && !res.destroyed)
            res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
        }
        const heartbeat = setInterval(() => {
          if (!closed && !res.destroyed)
            res.write(': heartbeat\n\n')
        }, 15000)
        let unsubscribe = () => {
        }
        const cleanup = () => {
          closed = true
          clearInterval(heartbeat)
          unsubscribe()
        }
        res.on('close', cleanup)
        if (url.searchParams.has('fresh') && !scanPending)
          scanCached = null
        // Initiate synchronously so the journal is reset before we subscribe.
        // Late subscribers replay all progress already emitted by the active scan.
        const job = getScan()
        try {
          unsubscribe = journal.subscribe(emit, { replay: journal.active })
          const result = await job
          emit({ type: 'complete', result })
        }
        catch (error) {
          emit({
            type: 'failure',
            error: errorMessage(error),
          })
        }
        finally {
          cleanup()
          if (!res.destroyed)
            res.end()
        }
        return
      }
      if (url.pathname === '/api/scan') {
        if (url.searchParams.has('fresh'))
          scanCached = null
        try {
          return respond(res, 200, await getScan())
        }
        catch (error) {
          console.error('[depnotes] scan failed:', error)
          return respond(res, 503, { error: `Scan failed: ${errorMessage(error)}`, lastSuccess: scanCached?.info?.scannedAt || null, retryable: true })
        }
      }
      if (url.pathname === '/api/health') {
        return respond(res, 200, {
          ok: true,
          scanning: !!scanPending,
          streamSubscribers: journal.subscriberCount,
          lastScanFailure,
        })
      }
      if (url.pathname === '/api/notes') {
        const { name, from, to, repo } = Object.fromEntries(url.searchParams)
        if (!name || !from || !to || !repo)
          return respond(res, 400, { error: 'Missing release request parameter' })
        if (name.length > 214 || from.length > 80 || to.length > 80 || repo.length > 200)
          return respond(res, 400, { error: 'Invalid release request length' })
        try {
          return respond(res, 200, await getNotes({ name, from, to, repo }))
        }
        catch (error) {
          return respond(res, 400, {
            error: errorMessage(error),
          })
        }
      }
      const asset = assets[url.pathname]
      if (!asset)
        return respond(res, 404, { error: 'Not found' })
      const data = await fs.readFile(path.join(root, asset))
      res.writeHead(200, {
        'Content-Type': mime[path.extname(asset)],
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
        'Content-Security-Policy': 'default-src \'self\'; script-src \'self\'; style-src \'self\'; connect-src \'self\'; img-src \'self\'; base-uri \'none\'; object-src \'none\'; frame-ancestors \'none\'',
      })
      res.end(data)
    }
    catch (error) {
      if (!res.headersSent && !res.destroyed) {
        respond(res, 500, {
          error: errorMessage(error),
        })
      }
      else if (!res.destroyed) {
        res.end()
      }
    }
  })
}
export async function listen(server: http.Server, { host = '127.0.0.1', port = 0 } = {}) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  return `http://${host}:${(server.address() as AddressInfo).port}`
}
