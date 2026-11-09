import type { GitStatus } from '../src/git-safety.js'
import type { renderNotesForDashboard } from '../src/markdown.js'
import type { DependencyItem, ProjectConfig, ScanInfo, ScanResult } from '../src/types.js'
import type { UpgradeResult } from '../src/upgrade.js'

export type DashboardNotes = ReturnType<typeof renderNotesForDashboard>
export interface DashboardState {
  items: DependencyItem[]
  workspaces: ScanResult['workspaces']
  selected: DependencyItem | null
  shown: number
  notes: Map<string, DashboardNotes>
  scanController: AbortController | null
  notesController: AbortController | null
  scanId: number
  stream: EventSource | null
  lastData: ScanResult | null
  lastScanInfo?: ScanInfo
  renderScheduled: boolean
  upgradeSelections: Map<string, DependencyItem>
  statusFilter: string
}
export interface SettingsResponse {
  config: ProjectConfig
  configFile: string
  userConfigFile: string
}
export interface UpgradePreview {
  token: string
  git: GitStatus
  items: {
    name: string
    from: string
    to: string
    workspace: string
    section: string
  }[]
  commands: {
    command: string
    importer: string
    section: string
  }[]
}
export interface UpgradeResponse {
  ok?: boolean
  error?: string
  warning?: string
  results?: (UpgradeResult & {
    command: string
  })[]
  pending?: {
    command: string
  }[]
  gitAfter?: GitStatus
}
