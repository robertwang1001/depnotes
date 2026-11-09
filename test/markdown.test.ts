import type { ReleaseNotes } from '../src/types.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_MARKDOWN_LENGTH, renderMarkdown, renderNotesForDashboard } from '../src/markdown.js'

test('formats headings, links, lists, and fenced code', () => {
  const { html } = renderMarkdown('## Changes\n\n- **Fixed** a bug\n- [Docs](https://example.com)\n\n```js\nconst x = 1;\n```')
  assert.match(html, /<h2>Changes<\/h2>/)
  assert.match(html, /<strong>Fixed<\/strong>/)
  assert.match(html, /<ul>/)
  assert.match(html, /<pre><code class="language-js">/)
  assert.match(html, /rel="noopener noreferrer"/)
})
test('does not execute raw HTML, unsafe links, or remote images', () => {
  const { html } = renderMarkdown('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n![remote](https://example.com/pixel.png)')
  assert.doesNotMatch(html, /<script|<img|<[^>]*\sonerror=|href="javascript:/i)
  assert.match(html, /&lt;script&gt;/)
})
test('limits rendered content and preserves terminal payload structure', () => {
  const result = renderMarkdown('a'.repeat(MAX_MARKDOWN_LENGTH + 50))
  assert.equal(result.truncated, true)
  const data: ReleaseNotes = {
    warnings: [],
    complete: false,
    message: '',
    releases: [
      {
        body: '**hello**',
        tag: 'v1.2.0',
        title: '1.2.0',
        url: 'https://example.org/release',
      },
    ],
    changelog: {
      url: 'https://example.org/changelog',
      path: 'CHANGELOG.md',
      sections: [
        {
          body: '- A',
          heading: '1.2.0',
          version: '1.2.0',
          truncated: false,
        },
      ],
    },
  }
  const rendered = renderNotesForDashboard(data)
  assert.match(rendered.releases[0].html, /<strong>hello<\/strong>/)
  assert.equal('body' in rendered.releases[0], false)
  assert.match(rendered.changelog!.sections[0].html, /<li>A<\/li>/)
  assert.equal(data.releases[0].body, '**hello**')
})
