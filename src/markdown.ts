import type { ReleaseNotes } from './types.js'
import MarkdownIt from 'markdown-it'
// All release notes are third-party content. Never interpret their raw HTML.
const md = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  breaks: false,
})
md.disable('image') // avoids silently loading third-party tracking pixels
const defaultLinkOpen = md.renderer.rules.link_open || ((tokens, idx, opts, env, self) => self.renderToken(tokens, idx, opts))
md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
  const token = tokens[idx]
  token.attrSet('target', '_blank')
  token.attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, idx, opts, env, self)
}
// Caps are applied per note. The UI renders HTML lazily on expansion.
export const MAX_MARKDOWN_LENGTH = 48000
export function renderMarkdown(source = '') {
  const input = String(source || '')
  return {
    html: md.render(input.slice(0, MAX_MARKDOWN_LENGTH)),
    truncated: input.length > MAX_MARKDOWN_LENGTH,
  }
}
// Keep the terminal/JSON core output as-is; only the browser response changes.
export function renderNotesForDashboard(data: ReleaseNotes) {
  const changelog = data.changelog
    ? {
        ...data.changelog,
        sections: (data.changelog.sections || []).map(({ body, ...part }) => ({
          ...part,
          ...renderMarkdown(body),
        })),
      }
    : null
  const releases = (data.releases || []).map(({ body, ...release }) => ({
    ...release,
    ...renderMarkdown(body),
  }))
  return { ...data, changelog, releases }
}
