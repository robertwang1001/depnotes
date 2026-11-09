import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, listen } from '../src/server.js'
import { createFixtureClient } from './fixture-client.js'

const dir = path.dirname(fileURLToPath(import.meta.url))
// Isolate user-level settings from the developer's actual configuration.
const settingsRoot = mkdtempSync(path.join(tmpdir(), 'depnotes-e2e-'))
process.env.XDG_CONFIG_HOME = settingsRoot
process.env.HOME = settingsRoot
const project = path.join(dir, 'fixture')
const server = createServer({
  project,
  client: createFixtureClient(),
  scanTtl: 0,
})
const address = await listen(server, {
  port: Number(process.env.DEPNOTES_E2E_PORT || 4178),
})
console.log(`Depnotes E2E fixture server: ${address}`)
function close() {
  return server.close(() => {
    rmSync(settingsRoot, { force: true, recursive: true })
    process.exit(0)
  })
}
process.on('SIGTERM', close)
process.on('SIGINT', close)
