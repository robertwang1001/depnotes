/** The dashboard IDs form a typed contract with index.html. */
interface DashboardElements {
  'theme-quick': HTMLElementTagNameMap['select']
  'diagnostics-open': HTMLElementTagNameMap['button']
  'settings-open': HTMLElementTagNameMap['button']
  'refresh': HTMLElementTagNameMap['button']
  'project': HTMLElementTagNameMap['strong']
  'project-path': HTMLElementTagNameMap['small']
  'toolchain': HTMLElementTagNameMap['div']
  'policy': HTMLElementTagNameMap['small']
  'scan-meta': HTMLElementTagNameMap['small']
  'stats': HTMLElementTagNameMap['div']
  'scan-progress': HTMLElementTagNameMap['div']
  'scan-progress-label': HTMLElementTagNameMap['span']
  'scan-progress-bar': HTMLElementTagNameMap['progress']
  'global-message': HTMLElementTagNameMap['div']
  'view-label': HTMLElementTagNameMap['span']
  'result-count': HTMLElementTagNameMap['span']
  'search': HTMLElementTagNameMap['input']
  'workspace': HTMLElementTagNameMap['select']
  'filter': HTMLElementTagNameMap['select']
  'sort': HTMLElementTagNameMap['select']
  'batch-count': HTMLElementTagNameMap['span']
  'batch-clear': HTMLElementTagNameMap['button']
  'batch-preview': HTMLElementTagNameMap['button']
  'list': HTMLElementTagNameMap['div']
  'visible-count': HTMLElementTagNameMap['span']
  'load-more': HTMLElementTagNameMap['button']
  'detail': HTMLElementTagNameMap['section']
  'upgrade-dialog': HTMLElementTagNameMap['dialog']
  'upgrade-title': HTMLElementTagNameMap['h2']
  'upgrade-description': HTMLElementTagNameMap['p']
  'upgrade-items': HTMLElementTagNameMap['div']
  'upgrade-command': HTMLElementTagNameMap['pre']
  'upgrade-git': HTMLElementTagNameMap['div']
  'upgrade-git-consent': HTMLElementTagNameMap['label']
  'upgrade-git-ack': HTMLElementTagNameMap['input']
  'upgrade-result': HTMLElementTagNameMap['div']
  'upgrade-cancel': HTMLElementTagNameMap['button']
  'upgrade-confirm': HTMLElementTagNameMap['button']
  'diagnostics-dialog': HTMLElementTagNameMap['dialog']
  'diagnostics-title': HTMLElementTagNameMap['h2']
  'diagnostics-close': HTMLElementTagNameMap['button']
  'diagnostics-content': HTMLElementTagNameMap['div']
  'settings-dialog': HTMLElementTagNameMap['dialog']
  'settings-form': HTMLElementTagNameMap['form']
  'settings-title': HTMLElementTagNameMap['h2']
  'settings-close': HTMLElementTagNameMap['button']
  'settings-scope': HTMLElementTagNameMap['select']
  'settings-path': HTMLElementTagNameMap['p']
  'age-source': HTMLElementTagNameMap['small']
  'setting-age': HTMLElementTagNameMap['input']
  'exclude-source': HTMLElementTagNameMap['small']
  'setting-excludes': HTMLElementTagNameMap['textarea']
  'setting-theme': HTMLElementTagNameMap['select']
  'setting-scan-cache': HTMLElementTagNameMap['input']
  'setting-notes-cache': HTMLElementTagNameMap['input']
  'settings-status': HTMLElementTagNameMap['div']
  'settings-defaults': HTMLElementTagNameMap['button']
  'settings-save': HTMLElementTagNameMap['button']
}
export function element<K extends keyof DashboardElements>(id: K): DashboardElements[K]
export function element(id: string): HTMLElement
export function element(id: string): HTMLElement {
  const node = document.getElementById(id)
  if (!node)
    throw new Error(`Missing dashboard element: ${id}`)
  return node
}
export function create<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: unknown): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined)
    node.textContent = String(text)
  return node
}
export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error)
}

export function external(label: string, url: string) {
  const a = create('a', '', label)
  if (!/^https:\/\//.test(url || ''))
    return create('span', '', label)
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  return a
}
