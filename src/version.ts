import { readFileSync } from 'node:fs'
import { findPackageJSON } from 'node:module'

// Resolve the owning package from this module, including in installed packages.
const manifestPath = findPackageJSON(import.meta.url)
if (!manifestPath)
  throw new Error('Could not locate the Depnotes package manifest')

const manifest: { version: string } = JSON.parse(readFileSync(manifestPath, 'utf8'))
export const VERSION = manifest.version
