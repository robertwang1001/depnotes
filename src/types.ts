/** Shared contracts for the scanner, dashboard, and injectable network clients. */
export type DependencySection = 'dependencies' | 'devDependencies' | 'optionalDependencies'
export type ManagerName = 'npm' | 'pnpm' | 'yarn' | 'bun'
export type Theme = 'system' | 'light' | 'dark'
export type UpdateKind = 'major' | 'minor' | 'patch' | 'prerelease' | 'unknown'
export type DependencyStatus = 'unsupported' | 'outdated' | 'deferred' | 'unknown-age' | 'current' | 'error'
export interface PackageManifest {
  name?: string
  packageManager?: string
  devEngines?: {
    packageManager?: {
      name: string
      version?: string
    }
  }
  engines?: Record<string, string>
  workspaces?: string[] | {
    packages: string[]
  }
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  version?: string
  repository?: string | {
    url?: string
  }
  homepage?: string
  bugs?: {
    url?: string
  }
}
export interface Packument extends PackageManifest {
  'dist-tags'?: {
    latest?: string
  }
  'versions'?: Record<string, PackageManifest>
  'time'?: Record<string, string>
}
export interface HttpMetrics {
  requests: number
  hits: number
  retries: number
  failures: number
  revalidated?: number
  entries?: number
  inFlight?: number
}
/** JSON remains unknown until the caller selects the endpoint's payload shape. */
export interface JsonClient {
  json: (url: string, headers?: Record<string, string>) => Promise<unknown>
  metrics?: () => HttpMetrics
}
export interface DependencyInput {
  name: string
  range: string
  section: DependencySection
  importer: string
  workspaceName: string
  resolved?: string
}
export interface DependencyItem extends Omit<DependencyInput, 'resolved'> {
  status: DependencyStatus
  current?: string
  source?: string
  latest?: string
  latestAvailable?: string
  compatible?: string | null
  repo?: string | null
  kind?: UpdateKind | null
  deferred?: string[]
  unknown?: string[]
  message?: string
}
export interface DepnotesOverrides {
  minimumReleaseAge?: number
  minimumReleaseAgeExclude?: string[]
  scanCacheSeconds?: number
  notesCacheSeconds?: number
  theme?: Theme
}
export interface ProjectConfig extends Required<DepnotesOverrides> {
  source: string
  excludeSource: string
  overrides: DepnotesOverrides
  userOverrides: DepnotesOverrides
}
export interface ScanDiagnostic {
  name: string
  importer: string
  status: DependencyStatus
  elapsedMs: number
  message: string | null
}
export interface ScanInfo {
  durationMs: number
  scannedAt: string
  cached: boolean
  requests?: HttpMetrics
}
export interface ScanResult {
  project: string
  packageName: string
  warning: string | null
  manager: {
    name: string
    version: string | null
    versionSource: string | null
    detectedBy: string
    lockfile: string | null
    detectedLockfiles: string[]
    invokedVersion: string | null
    warnings: string[]
  }
  runtime: {
    node: string
    platform: string
    architecture: string
    engines: Record<string, string>
  }
  workspaces: {
    importer: string
    name: string
  }[]
  config: ProjectConfig
  items: DependencyItem[]
  diagnostics: {
    total: number
    byStatus: Record<string, number>
    slowest: ScanDiagnostic[]
  }
  scanInfo?: ScanInfo
}
export type ScanProgress = {
  type: 'start'
  total: number
} | {
  type: 'item'
  index: number
  total: number
  item: DependencyItem
  diagnostic: ScanDiagnostic
}
export type ScanEvent = ScanProgress | {
  type: 'complete'
  result: ScanResult
} | {
  type: 'failure'
  error: string
}
export interface ReleaseRequest {
  name: string
  from: string
  to: string
  repo: string
}
export interface GithubRelease {
  tag_name: string
  name?: string
  body?: string
  html_url: string
  published_at?: string
  draft?: boolean
  prerelease?: boolean
}
export interface ChangelogSection {
  version: string
  heading: string
  body: string
  truncated: boolean
}
export interface RepositoryNotes {
  changelog: {
    url: string
    path: string
    sections: ChangelogSection[]
  } | null
  guides: {
    title: string
    url: string
  }[]
  warnings: string[]
}
export interface ReleaseNotes {
  repo?: string
  releases: {
    tag: string
    title: string
    body: string
    url: string
    published?: string
  }[]
  changelog?: RepositoryNotes['changelog']
  guides?: RepositoryNotes['guides']
  warnings: string[]
  complete: boolean
  coverage?: string
  message: string
}
