import type { ExtensionContext } from '@mariozechner/pi-coding-agent'
import type { TeamState } from '../types.js'

export type CommandHandlerDeps = {
  sanitizeWorkerName: (name: string) => string
  ensureTeamForSession: (ctx: ExtensionContext) => TeamState | null
  deleteTeamRuntime: (team: TeamState, options?: { includeLeaderPane?: boolean }) => void
  invalidateStatus: (ctx: ExtensionContext) => void
  resetMailboxSyncKey: () => void
  runMailboxSync: (ctx: ExtensionContext) => void
}
