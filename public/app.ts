import type { DependencyItem, DepnotesOverrides, ScanProgress, ScanResult } from '../src/types.js'
import type { DashboardState, SettingsResponse, UpgradePreview, UpgradeResponse } from './types.js'
import { element as $, create, errorMessage, external } from './dom.js'
import { count, duration, formatScanAge } from './format.js'
import { notice, showNotes } from './notes.js'

const state: DashboardState = {
  items: [],
  workspaces: [],
  selected: null,
  shown: 40,
  notes: new Map(),
  scanController: null,
  notesController: null,
  scanId: 0,
  stream: null,
  lastData: null,
  renderScheduled: false,
  upgradeSelections: new Map(),
  statusFilter: 'outdated',
}
const risk: Record<string, number> = { major: 0, minor: 1, patch: 2 }
function message(value: string, kind = 'info') {
  const el = $('global-message')
  el.textContent = value
  el.className = `message ${kind}`
  el.hidden = !value
}
function filteredItems() {
  const search = $('search').value.trim().toLowerCase()
  const workspace = $('workspace').value
  const filter = $('filter').value
  const sort = $('sort').value
  return state.items.filter(x => (state.statusFilter === 'outdated'
    ? x.status === 'outdated'
    : state.statusFilter === 'issues'
      ? !['outdated', 'current'].includes(x.status)
      : state.statusFilter === 'deferred'
        ? x.status === 'deferred'
        : state.statusFilter === 'errors'
          ? x.status === 'error'
          : true) && (workspace === 'all' || x.importer === workspace) && (filter === 'all' || x.kind === filter) && (x.name.toLowerCase().includes(search) || x.workspaceName.toLowerCase().includes(search)))
    .sort((a, b) => sort === 'name'
      ? a.name.localeCompare(b.name)
      : sort === 'workspace'
        ? a.workspaceName.localeCompare(b.workspaceName) || a.name.localeCompare(b.name)
        : (risk[a.kind || 'unknown'] ?? 3) - (risk[b.kind || 'unknown'] ?? 3) || a.name.localeCompare(b.name))
}
function selectionKey(item: DependencyItem) {
  return JSON.stringify([item.importer, item.section, item.name])
}
function updateBatchToolbar() {
  const n = state.upgradeSelections.size
  $('batch-count').textContent = `${n} selected`
  $('batch-clear').disabled = n === 0
  $('batch-preview').disabled = n === 0
}
function renderList() {
  const list = $('list')
  const all = filteredItems()
  const visible = all.slice(0, state.shown)
  const fragment = document.createDocumentFragment()
  for (const item of visible) {
    const row = create('div', 'package')
    row.tabIndex = 0
    row.setAttribute('role', 'button')
    row.setAttribute('aria-current', item === state.selected
      ? 'true'
      : 'false')
    if (item.status === 'outdated') {
      const chooser = create('label', 'selection-label')
      const checkbox = create('input')
      checkbox.type = 'checkbox'
      checkbox.checked = state.upgradeSelections.has(selectionKey(item))
      checkbox.setAttribute('aria-label', `Select ${item.name} in ${item.workspaceName} for upgrade`)
      checkbox.addEventListener('click', event => event.stopPropagation())
      checkbox.addEventListener('change', () => {
        const key = selectionKey(item)
        if (checkbox.checked)
          state.upgradeSelections.set(key, item)
        else
          state.upgradeSelections.delete(key)
        updateBatchToolbar()
      })
      chooser.append(checkbox, create('span', '', 'Select upgrade'))
      row.append(chooser)
    }
    const head = create('div', 'package-header')
    head.append(create('span', 'package-name', item.name), create('span', `badge ${item.kind || item.status}`, item.kind || item.status))
    row.append(head, create('div', 'package-sub', `${item.current || '—'} → ${item.latest || item.latestAvailable || '—'}`), create('div', 'package-sub', `${item.workspaceName} · ${item.section}${item.source?.startsWith('manifest')
      ? ' · estimated baseline'
      : ''}`))
    if (item.message && item.status !== 'outdated')
      row.append(create('div', 'package-sub issue-reason', item.message))
    else if (item.deferred?.length)
      row.append(create('div', 'package-sub issue-reason', `${item.deferred.length} newer version(s) deferred by release age`))
    row.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('.selection-label'))
        return
      selectItem(item)
    })
    row.addEventListener('keydown', (event) => {
      if (event.target === row && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault()
        selectItem(item)
      }
    })
    fragment.append(row)
  }
  if (!all.length)
    fragment.append(create('div', 'placeholder', state.items.length ? 'No matching dependencies for this view. Try adjusting the filters.' : 'No dependencies to display.'))
  list.replaceChildren(fragment)
  updateBatchToolbar()
  list.setAttribute('aria-busy', 'false')
  $('result-count').textContent = `(${count(all.length)})`
  $('visible-count').textContent = all.length
    ? `Showing ${count(visible.length)} of ${count(all.length)}`
    : ''
  $('load-more').hidden = visible.length === all.length
}
function updateStats(data: ScanResult) {
  state.lastData = data
  $('project').textContent = data.packageName || '(unnamed project)'
  $('project-path').textContent = data.project || ''
  const runtime = data.runtime
  const manager = data.manager
  const toolchain = $('toolchain')
  toolchain.replaceChildren()
  const pills = [
    ['Manager', `${manager.name || 'unknown'}${manager.version
      ? ` @ ${manager.version}`
      : ''}`],
    ['Lockfile', manager.lockfile || 'not found'],
    ['Node', runtime.node || 'unknown'],
  ]
  if (runtime.engines?.node)
    pills.push(['Required Node', runtime.engines.node])
  if (manager.invokedVersion)
    pills.push(['Invoked manager', manager.invokedVersion])
  for (const [label, value] of pills) {
    const chip = create('span', 'toolchain-chip')
    chip.append(create('b', '', label), create('span', '', value))
    toolchain.append(chip)
  }
  const info = create('small', 'toolchain-source', `Manager detected by ${manager.detectedBy || 'fallback'} · ${manager.version ? 'Version is declared, not verified installed' : 'No declared manager version'}${manager.name === 'yarn' || manager.name === 'bun'
    ? ' · Installed baselines estimated'
    : ''}`)
  toolchain.append(info)
  const scanInfo = data.scanInfo
  state.lastScanInfo = scanInfo
  const scanned = scanInfo
    ? formatScanAge(scanInfo.scannedAt)
    : null
  $('scan-meta').textContent = scanInfo
    ? `Scanned ${scanned!.label} · ${scanInfo.durationMs >= 1000
      ? `${(scanInfo.durationMs / 1000).toFixed(1)} s`
      : `${scanInfo.durationMs} ms`}${scanInfo.cached ? ' · cached' : ''}`
    : ''
  $('scan-meta').title = scanned?.exact || ''
  const config = data.config
  $('policy').replaceChildren(create('span', '', 'Minimum release age: '), create('strong', 'policy-value', duration(Number(config.minimumReleaseAge ?? 4320))), create('span', '', ` · ${config.source || 'default'}`))
  applyTheme(config.theme || 'system')
  const counts = {
    outdated: state.items.filter(x => x.status === 'outdated').length,
    major: state.items.filter(x => x.status === 'outdated' && x.kind === 'major').length,
    deferred: state.items.filter(x => x.status === 'deferred').length,
    issues: state.items.filter(x => !['outdated', 'current'].includes(x.status)).length,
    errors: state.items.filter(x => x.status === 'error').length,
  }
  const definitions: [
    string,
    number,
    string,
        string?,
  ][] = [
    ['Updates', counts.outdated, 'outdated'],
    [
      'Major',
      counts.major,
      'outdated',
      'major',
    ],
    ['Deferred', counts.deferred, 'deferred'],
    ['Skipped / errors', counts.issues, 'issues'],
  ]
  const frag = document.createDocumentFragment()
  for (const [label, value, view, kind] of definitions) {
    const button = create('button', 'stat stat-button')
    button.type = 'button'
    button.setAttribute('aria-label', `Show ${value} ${label.toLowerCase()} dependencies`)
    button.dataset.view = view
    button.setAttribute('aria-pressed', String(state.statusFilter === view && (!kind || $('filter').value === kind)))
    button.append(create('strong', '', count(value)), create('span', '', label))
    button.addEventListener('click', () => {
      state.statusFilter = view
      state.shown = 40
      $('search').value = ''
      $('workspace').value = 'all'
      $('filter').value = kind || 'all'
      syncView()
      renderList()
      emptyDetail()
      $('list').focus()
    })
    frag.append(button)
  }
  $('stats').replaceChildren(frag)
  syncView()
}
function syncView() {
  $('view-label').textContent = state.statusFilter === 'outdated'
    ? 'Available updates'
    : state.statusFilter === 'deferred'
      ? 'Age-deferred packages'
      : state.statusFilter === 'issues'
        ? 'Skipped and failed dependencies'
        : 'All dependencies'
  for (const el of $('stats').querySelectorAll<HTMLButtonElement>('.stat-button')) {
    el.setAttribute('aria-pressed', String(el.dataset.view === state.statusFilter && (el.textContent?.includes('Major')
      ? $('filter').value === 'major'
      : true)))
  }
  $('filter').disabled = state.statusFilter !== 'outdated'
}
function emptyDetail() {
  const empty = create('div', 'empty-state')
  empty.append(create('div', 'empty-icon', '≡'), create('h2', '', 'Nothing selected yet'), create('p', '', 'Choose an update to review its release notes.'))
  $('detail').replaceChildren(empty)
}
function applyScan(data: ScanResult) {
  state.upgradeSelections.clear()
  state.items = data.items || []
  state.workspaces = data.workspaces || []
  state.selected = null
  state.shown = 40
  state.notes.clear()
  const ws = $('workspace')
  const previous = ws.value
  ws.replaceChildren(new Option('All workspaces', 'all'))
  for (const item of state.workspaces)
    ws.add(new Option(`${item.name} (${item.importer})`, item.importer))
  if ([...ws.options].some(opt => opt.value === previous))
    ws.value = previous
  updateStats(data)
  renderList()
  emptyDetail()
  if (data.warning)
    message(data.warning, 'warning')
}
function renderProgress(completed: number, total: number) {
  $('scan-progress').hidden = false
  $('scan-progress-label').textContent = `Checking dependencies: ${count(completed)} / ${count(total)}`
  $('scan-progress-bar').max = Math.max(total, 1)
  $('scan-progress-bar').value = completed
}
async function scan() {
  state.stream?.close()
  state.scanController?.abort()
  state.notesController?.abort()
  const id = ++state.scanId
  const previous = state.lastData
  state.upgradeSelections.clear()
  updateBatchToolbar()
  $('refresh').disabled = true
  $('refresh').textContent = 'Scanning…'
  $('list').setAttribute('aria-busy', 'true')
  message('')
  const pending: DependencyItem[] = []
  let completed = 0
  let total = 0
  let finished = false
  let usingFallback = false
  let lastEventIndex = -1
  const finish = () => {
    if (finished || id !== state.scanId)
      return
    finished = true
    state.stream?.close()
    state.stream = null
    $('scan-progress').hidden = true
    $('refresh').disabled = false
    $('refresh').textContent = '↻ Rescan'
    $('list').setAttribute('aria-busy', 'false')
  }
  const fail = (reason: string) => {
    if (id !== state.scanId || finished)
      return
    finish()
    if (previous)
      applyScan(previous)
    message(`Scan failed: ${reason}. Previous results are kept. Check the Depnotes terminal and retry.`, 'error')
  }
  const complete = (data: ScanResult) => {
    if (id !== state.scanId || finished)
      return
    applyScan(data)
    finish()
  }
  // Progressive results can be selected while other requests are pending.
  const acceptItem = (event: Extract<ScanProgress, {
    type: 'item'
  }>) => {
    if (id !== state.scanId || finished)
      return
    // An SSE connection may reconnect and replay already seen progress.
    // The sequence index makes updates idempotent.
    if (Number.isInteger(event.index) && event.index <= lastEventIndex)
      return
    if (Number.isInteger(event.index))
      lastEventIndex = event.index
    if (total === 0)
      total = event.total
    pending.push(event.item)
    completed = pending.length
    state.items = pending
    // Batch DOM updates; rendering all rows on every package would be quadratic.
    if (!state.renderScheduled) {
      state.renderScheduled = true
      requestAnimationFrame(() => {
        state.renderScheduled = false
        if (id === state.scanId && !finished) {
          renderList()
          $('view-label').textContent = `Scanning · ${completed}/${total}`
        }
      })
    }
    renderProgress(completed, total)
  }
  const fallback = async () => {
    if (id !== state.scanId || finished || usingFallback)
      return
    usingFallback = true
    state.stream?.close()
    state.stream = null
    try {
      const controller = new AbortController()
      state.scanController = controller
      const response = await fetch('/api/scan', { signal: controller.signal, cache: 'no-store' })
      const data = await response.json()
      if (!response.ok)
        throw new Error(data.error || `HTTP ${response.status}`)
      complete(data)
    }
    catch (error) {
      if (!(error instanceof Error && error instanceof Error && error.name === 'AbortError'))
        fail(errorMessage(error) || 'Could not connect to local server')
    }
  }
  if (typeof EventSource === 'undefined') {
    fallback()
    return
  }
  try {
    const stream = new EventSource(`/api/scan/events${previous ? '?fresh=1' : ''}`)
    state.stream = stream
    stream.addEventListener('start', (ev) => {
      if (id !== state.scanId)
        return
      const data = JSON.parse(ev.data)
      total = data.total
      renderProgress(0, total)
    })
    stream.addEventListener('item', ev => acceptItem(JSON.parse(ev.data)))
    stream.addEventListener('complete', ev => complete(JSON.parse(ev.data).result))
    stream.addEventListener('failure', ev => fail(JSON.parse(ev.data).error || 'Scan failed'))
    stream.onerror = () => {
      if (!finished)
        fallback()
    }
  }
  catch {
    fallback()
  }
}
async function selectItem(item: DependencyItem) {
  state.notesController?.abort()
  state.selected = item
  renderList()
  const pane = $('detail')
  pane.replaceChildren()
  const head = create('div', 'detail-top')
  head.append(create('h2', '', item.name), create('span', `badge ${item.kind || item.status}`, item.kind || item.status))
  pane.append(head, create('div', 'version-line', `${item.current || '—'} → ${item.latest || item.latestAvailable || '—'} · ${item.workspaceName}${item.source?.startsWith('manifest')
    ? ' · baseline estimated from manifest'
    : ''}`))
  if (item.status !== 'outdated') {
    pane.append(notice(item.message || `This package was ${item.status}.`, 'warning'))
    return
  }
  const sources = create('div', 'source-links')
  sources.append(external('npm ↗', `https://www.npmjs.com/package/${encodeURIComponent(item.name)}`))
  if (item.repo)
    sources.append(external('GitHub ↗', `https://github.com/${item.repo}`))
  pane.append(sources)
  if (item.compatible)
    pane.append(notice(`Highest available version matching ${item.range}: ${item.compatible}`))
  if (item.status === 'outdated') {
    const action = create('button', 'primary upgrade-action', `Upgrade to ${item.latest}`)
    action.type = 'button'
    action.addEventListener('click', () => previewUpgrade(item))
    pane.append(action)
  }
  if (!item.repo) {
    pane.append(notice('No GitHub repository was found in package metadata. Release notes cannot be discovered automatically.'))
    return
  }
  const cacheKey = JSON.stringify([
    item.name,
    item.current,
    item.latest,
    item.repo,
  ])
  if (state.notes.has(cacheKey)) {
    showNotes(state.notes.get(cacheKey)!)
    return
  }
  const loading = create('div', 'loading-panel')
  loading.append(create('div', 'skeleton'), create('div', 'skeleton'), create('div', 'skeleton'))
  pane.append(loading)
  const controller = new AbortController()
  state.notesController = controller
  try {
    const params = new URLSearchParams({
      name: item.name,
      from: item.current!,
      to: item.latest!,
      repo: item.repo,
    })
    const response = await fetch(`/api/notes?${params}`, { signal: controller.signal })
    const data = await response.json()
    if (!response.ok)
      throw new Error(data.error || `HTTP ${response.status}`)
    if (state.selected !== item)
      return
    state.notes.set(cacheKey, data)
    showNotes(data)
  }
  catch (error) {
    if ((error instanceof Error && error.name === 'AbortError') || state.selected !== item)
      return
    loading.remove()
    pane.append(notice(`Could not load release notes: ${errorMessage(error)}`, 'error'))
  }
}
for (const id of [
  'search',
  'filter',
  'workspace',
  'sort',
] as const) {
  $(id).addEventListener(id === 'search'
    ? 'input'
    : 'change', () => {
    state.shown = 40
    renderList()
  })
}
$('load-more').addEventListener('click', () => {
  state.shown += 40
  renderList()
})
$('refresh').addEventListener('click', () => scan())
scan()
const settingsDialog = $('settings-dialog')
let effectiveSettings: SettingsResponse | null = null
function applyTheme(theme: string) {
  const value = ['system', 'light', 'dark'].includes(theme)
    ? theme
    : 'system'
  document.documentElement.dataset.theme = value
  $('theme-quick').value = value
  $('setting-theme').value = value
}
$('theme-quick').addEventListener('change', async () => {
  const theme = $('theme-quick').value
  applyTheme(theme)
  try {
    // Fetch current settings first so the quick theme switch never erases other user preferences.
    const currentResponse = await fetch('/api/settings', { cache: 'no-store' })
    const current = await currentResponse.json()
    if (!currentResponse.ok)
      throw new Error(current.error || 'Could not read current settings')
    const response = await fetch('/api/settings?scope=user', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...current.config.userOverrides, theme }),
    })
    const data = await response.json()
    if (!response.ok)
      throw new Error(data.error || 'Could not save theme')
    effectiveSettings = data
  }
  catch (error) {
    message(`Could not save theme: ${errorMessage(error)}`, 'error')
  }
})
$('settings-scope').addEventListener('change', () => {
  if (effectiveSettings)
    populateSettings(effectiveSettings)
})
function settingsMessage(text: string, kind = 'info') {
  const el = $('settings-status')
  el.hidden = !text
  el.className = `message ${kind}`
  el.textContent = text
}
function populateSettings(data: SettingsResponse) {
  effectiveSettings = data
  const { config } = data
  $('setting-age').value = String(config.minimumReleaseAge / 1440)
  $('setting-excludes').value = config.minimumReleaseAgeExclude.join('\n')
  $('setting-scan-cache').value = String(config.scanCacheSeconds)
  $('setting-notes-cache').value = String(config.notesCacheSeconds)
  $('settings-path').textContent = $('settings-scope').value === 'user'
    ? data.userConfigFile
    : data.configFile
  $('setting-theme').value = config.theme || 'system'
  $('age-source').textContent = `from ${config.source}`
  $('exclude-source').textContent = `from ${config.excludeSource}`
  settingsMessage('')
}
async function openSettings() {
  settingsDialog.showModal()
  settingsMessage('Loading settings…')
  try {
    const response = await fetch('/api/settings', { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok)
      throw new Error(data.error || `HTTP ${response.status}`)
    populateSettings(data)
  }
  catch (error) {
    settingsMessage(`Could not read settings: ${errorMessage(error)}`, 'error')
  }
}
async function writeSettings(overrides: DepnotesOverrides) {
  const response = await fetch(`/api/settings?scope=${$('settings-scope').value}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(overrides),
  })
  const data = await response.json()
  if (!response.ok)
    throw new Error(data.error || `HTTP ${response.status}`)
  populateSettings(data)
  settingsDialog.close()
  await scan()
}
$('settings-open').addEventListener('click', openSettings)
$('settings-close').addEventListener('click', () => settingsDialog.close())
$('settings-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!effectiveSettings)
    return
  const age = Number($('setting-age').value) * 1440
  const scanCache = Number($('setting-scan-cache').value)
  const notesCache = Number($('setting-notes-cache').value)
  if (!Number.isSafeInteger(age) || age < 0 || age > 525600 || !Number.isSafeInteger(scanCache) || scanCache < 0 || scanCache > 3600 || !Number.isSafeInteger(notesCache) || notesCache < 0 || notesCache > 3600) {
    settingsMessage('Enter valid values: release age in 0–365 days and cache durations in 0–3600 seconds.', 'warning')
    return
  }
  const overrides = {
    minimumReleaseAge: age,
    minimumReleaseAgeExclude: $('setting-excludes').value.split(/\r?\n|,/).map(x => x.trim()).filter(Boolean),
    scanCacheSeconds: scanCache,
    notesCacheSeconds: notesCache,
    theme: $('setting-theme').value as 'system' | 'light' | 'dark',
  }
  $('settings-save').disabled = true
  try {
    await writeSettings(overrides)
  }
  catch (error) {
    settingsMessage(`Could not save settings: ${errorMessage(error)}`, 'error')
  }
  finally {
    $('settings-save').disabled = false
  }
})
$('settings-defaults').addEventListener('click', async () => {
  if (!confirm(`Remove all Depnotes overrides for the selected ${$('settings-scope').value} scope?`))
    return
  $('settings-defaults').disabled = true
  try {
    await writeSettings({})
  }
  catch (error) {
    settingsMessage(`Could not reset settings: ${errorMessage(error)}`, 'error')
  }
  finally {
    $('settings-defaults').disabled = false
  }
})
// Relative labels update while the dashboard is open, without rescanning.
setInterval(() => {
  if (state.lastScanInfo) {
    const t = formatScanAge(state.lastScanInfo.scannedAt)
    $('scan-meta').textContent = `Scanned ${t.label} · ${state.lastScanInfo.durationMs >= 1000
      ? `${(state.lastScanInfo.durationMs / 1000).toFixed(1)} s`
      : `${state.lastScanInfo.durationMs} ms`}${state.lastScanInfo.cached ? ' · cached' : ''}`
    $('scan-meta').title = t.exact
  }
}, 30000)
// Load the lightweight local preference before a potentially slow registry scan completes.
fetch('/api/settings', { cache: 'no-store' })
  .then(async (response) => {
    if (!response.ok)
      return null
    return response.json()
  })
  .then((data) => {
    if (data) {
      effectiveSettings = data
      applyTheme(data.config.theme || 'system')
    }
  })
  .catch(() => {
  })
function renderDiagnostics() {
  const parent = $('diagnostics-content')
  parent.replaceChildren()
  const data = state.lastData
  if (!data) {
    parent.append(create('p', 'subtle', 'No completed scan yet.'))
    return
  }
  const d = data.diagnostics
  const http = data.scanInfo?.requests
  const overview = create('div', 'diagnostics-overview')
  for (const [label, value] of [
    ['Dependencies checked', d.total ?? data.items?.length ?? 0],
    ['Network requests', http?.requests ?? '—'],
    ['Cache hits', http?.hits ?? '—'],
    ['Retries', http?.retries ?? '—'],
    ['Request failures', http?.failures ?? '—'],
  ]) {
    const box = create('div', 'diagnostic-metric')
    box.append(create('small', '', label), create('strong', '', value))
    overview.append(box)
  }
  parent.append(overview, create('h3', '', 'Slowest dependencies'))
  const table = create('table', 'diagnostic-table')
  const head = create('tr')
  for (const column of ['Package / workspace', 'Status', 'Elapsed'])
    head.append(create('th', '', column))
  table.append(head)
  for (const entry of d.slowest || []) {
    const row = create('tr')
    if (entry.status === 'error')
      row.className = 'diagnostic-error'
    const name = create('td')
    name.append(create('strong', '', entry.name), create('small', '', ` ${entry.importer || '.'}`))
    row.append(name, create('td', '', entry.status), create('td', '', `${entry.elapsedMs} ms`))
    if (entry.message) {
      row.title = entry.message
      name.append(create('div', 'diagnostic-reason', entry.message))
    }
    table.append(row)
  }
  parent.append(table)
}
$('diagnostics-open').addEventListener('click', () => {
  renderDiagnostics()
  $('diagnostics-dialog').showModal()
})
$('diagnostics-close').addEventListener('click', () => $('diagnostics-dialog').close())
// Upgrades are strictly opt-in; selections never trigger package-manager execution.
let pendingUpgrade: UpgradePreview | null = null
const upgradeDialog = $('upgrade-dialog')
async function previewUpgrade(item: DependencyItem) {
  return previewUpgrades([item])
}
async function previewUpgrades(items: DependencyItem[]) {
  if (!items.length)
    return
  try {
    const response = await fetch('/api/upgrade/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items.map(item => ({
          name: item.name,
          importer: item.importer,
          section: item.section,
          target: item.latest,
        })),
      }),
    })
    const data: UpgradePreview & {
      error?: string
    } = await response.json()
    if (!response.ok)
      throw new Error(data.error || `HTTP ${response.status}`)
    pendingUpgrade = data
    $('upgrade-description').textContent = `${data.items.length} dependencies · ${data.commands.length} package-manager command(s)`
    const chosen = $('upgrade-items')
    chosen.replaceChildren()
    for (const item of data.items)
      chosen.append(create('div', 'batch-item', `${item.name}: ${item.from} → ${item.to} · ${item.workspace} (${item.section})`))
    $('upgrade-command').textContent = data.commands.map(entry => `# ${entry.importer} · ${entry.section}\n${entry.command}`).join('\n\n')
    const git = data.git || { state: 'unknown' }
    const gitBox = $('upgrade-git')
    const consent = $('upgrade-git-consent')
    const ack = $('upgrade-git-ack')
    gitBox.className = `git-safety ${git.state === 'clean'
      ? 'git-clean'
      : 'git-warning'}`
    if (git.state === 'clean') {
      gitBox.textContent = 'Git working tree is clean. Your last commit is a recovery point.'
    }
    else if (git.state === 'dirty') {
      gitBox.textContent = `Uncommitted work detected: ${git.staged} staged, ${git.unstaged} unstaged, ${git.untracked} untracked${git.conflicts
        ? `, ${git.conflicts} conflicts`
        : ''}. Stage and commit your work before upgrading when practical.`
    }
    else {
      gitBox.textContent = `Git status could not be checked: ${git.reason || 'unknown reason'}. Review your work manually before upgrading.`
    }
    const needsAck = git.state !== 'clean'
    consent.hidden = !needsAck
    ack.checked = false
    $('upgrade-result').hidden = true
    $('upgrade-confirm').disabled = needsAck
    $('upgrade-cancel').disabled = false
    $('upgrade-confirm').textContent = 'Upgrade selected'
    $('upgrade-cancel').textContent = 'Cancel'
    upgradeDialog.showModal()
  }
  catch (error) {
    message(`Cannot preview upgrade: ${errorMessage(error)}`, 'error')
  }
}
$('upgrade-git-ack').addEventListener('change', () => {
  $('upgrade-confirm').disabled = !$('upgrade-git-ack').checked
})
$('batch-preview').addEventListener('click', () => previewUpgrades([
  ...state.upgradeSelections.values(),
]))
$('batch-clear').addEventListener('click', () => {
  state.upgradeSelections.clear()
  updateBatchToolbar()
  renderList()
})
$('upgrade-cancel').addEventListener('click', () => {
  if (!$('upgrade-cancel').disabled)
    upgradeDialog.close()
})
$('upgrade-confirm').addEventListener('click', async () => {
  if (!pendingUpgrade)
    return
  const button = $('upgrade-confirm')
  const result = $('upgrade-result')
  button.disabled = true
  button.textContent = 'Upgrading…'
  $('upgrade-cancel').disabled = true
  try {
    const response = await fetch('/api/upgrade/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pendingUpgrade.token, confirm: true, acknowledgeGitRisk: pendingUpgrade.git?.state !== 'clean' && $('upgrade-git-ack').checked }),
    })
    const data: UpgradeResponse = await response.json()
    result.hidden = false
    result.className = `message ${data.ok ? 'info' : 'error'}`
    const completed = (data.results || []).filter(r => r.ok).length
    const failed = (data.results || []).filter(r => !r.ok).length
    const remaining = data.pending || []
    const lines = [data.warning || data.error || 'Upgrade finished', `Commands: ${completed} succeeded · ${failed} failed · ${remaining.length} not attempted`]
    for (const r of data.results || [])
      lines.push(`\n${r.ok ? '✓' : '✗'} $ ${r.command}\n${r.output || '(no output)'}\nExit: ${r.exitCode ?? 'unknown'}`)
    if (remaining.length)
      lines.push(`\nNot attempted (after the first failure):\n${remaining.map(r => `• ${r.command}`).join('\n')}`)
    if (data.gitAfter?.state === 'dirty')
      lines.push('\nGit working tree contains changes. Review git status and git diff before retrying or committing.')
    lines.push('\nRun the project test/build commands to verify compatibility.')
    result.textContent = lines.join('\n')
    if (response.ok && data.ok) {
      button.textContent = 'Completed'
      state.upgradeSelections.clear()
      updateBatchToolbar()
      message(`${pendingUpgrade.items.length} dependencies upgraded. Rescan and run project tests.`)
    }
    else {
      button.textContent = 'Upgrade failed'
    }
  }
  catch (error) {
    result.hidden = false
    result.className = 'message error'
    result.textContent = `Upgrade request failed: ${errorMessage(error)}. Check the terminal and project files.`
    button.textContent = 'Upgrade failed'
  }
  finally {
    $('upgrade-cancel').disabled = false
    $('upgrade-cancel').textContent = 'Close'
  }
})
