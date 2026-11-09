import type { DashboardNotes } from './types.js'
import { element as $, create, external } from './dom.js'

export function notice(text: string, kind = '') {
  return create('div', `notice ${kind}`, text)
}
function section(title: string) {
  const section = create('section', 'section')
  section.append(create('h3', '', title))
  return section
}
// The server uses markdown-it with raw HTML and remote images disabled. HTML is
// inserted only from that safe renderer, never directly from a release payload.
function appendNote(container: HTMLElement, title: string, html: string, subtitle = '', open = false) {
  const details = create('details')
  details.open = open
  details.append(create('summary', '', title))
  if (subtitle)
    details.append(create('div', 'version-note', subtitle))
  const content = create('div', 'markdown-body')
  const render = () => {
    if (content.dataset.rendered)
      return
    // Parse only when expanded so large release histories don't inflate the DOM.
    content.innerHTML = html || '<p>No description provided.</p>'
    content.dataset.rendered = 'true'
  }
  details.addEventListener('toggle', () => {
    if (details.open)
      render()
  })
  details.append(content)
  container.append(details)
  if (open)
    render()
}
export function showNotes(data: DashboardNotes) {
  const pane = $('detail')
  pane.querySelector('.loading-panel')?.remove()
  const summary = create('div', 'section')
  summary.append(create('h3', '', 'Release-note coverage: unverified'), create('p', '', data.message || 'Coverage cannot be guaranteed.'))
  pane.append(summary)
  for (const warning of (data.warnings || []))
    pane.append(notice(warning, 'warning'))
  if (data.guides?.length) {
    const wrap = section('Migration references')
    for (const guide of data.guides) {
      const p = create('p')
      p.append(external(guide.title, guide.url))
      wrap.append(p)
    }
    pane.append(wrap)
  }
  let expandFirst = true
  if (data.changelog) {
    const wrap = section('Repository changelog')
    const p = create('p')
    p.append(external('Open full changelog ↗', data.changelog.url))
    wrap.append(p)
    if (!data.changelog.sections?.length)
      wrap.append(notice('No matching version sections found in the changelog.'))
    for (const part of data.changelog.sections || []) {
      appendNote(wrap, part.heading, part.html, part.truncated ? 'Content truncated. Open full changelog for context.' : '', expandFirst)
      expandFirst = false
    }
    pane.append(wrap)
  }
  if (data.releases?.length) {
    const wrap = section(`GitHub releases (${data.releases.length})`)
    for (const release of data.releases) {
      appendNote(wrap, release.title || release.tag, release.html, `${release.published?.slice(0, 10) || ''}${release.truncated ? ' · Preview truncated; open source for full note.' : ''}`, expandFirst)
      expandFirst = false
      const p = create('p')
      p.append(external('Open release ↗', release.url))
      wrap.append(p)
    }
    pane.append(wrap)
  }
  if (!data.releases?.length && !data.changelog?.sections?.length)
    pane.append(notice('No version-specific notes were found. Open the source repository and check the official migration documentation.'))
}
