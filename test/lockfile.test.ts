import assert from 'node:assert/strict'
import test from 'node:test'
import { extractResolutions } from '../src/lockfile.js'

test('reads exact pnpm importer resolutions and strips peer suffix', () => {
  const lock = {
    importers: {
      '.': {
        dependencies: {
          react: { specifier: '^19.0.0', version: '19.2.0' },
          next: { specifier: '^15', version: '15.4.0(react@19.2.0)' },
          local: { specifier: 'workspace:*', version: 'link:../local' },
        },
        devDependencies: {
          typescript: { specifier: '^5.0.0', version: '5.9.3' },
        },
      },
    },
  }
  assert.deepEqual(extractResolutions(lock), { 'dependencies:react': '19.2.0', 'dependencies:next': '15.4.0', 'devDependencies:typescript': '5.9.3' })
})
test('handles missing importer', () => assert.deepEqual(extractResolutions({ importers: {} }, '.'), {}))
