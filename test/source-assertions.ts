import assert from 'node:assert/strict'
/** Formatting changes must not invalidate source-shape smoke checks. */
export function matchesSource(source: string, pattern: RegExp): void {
  assert.match(source.replace(/\s+/g, ''), new RegExp(pattern.source.replace(/\s+/g, ''), pattern.flags))
}
