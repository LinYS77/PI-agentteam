import type { ExtensionContext } from '@mariozechner/pi-coding-agent'
import type { TeamState } from '../types.js'

export type CommandHandlerDeps = {
  deleteTeamRuntime: (team: TeamState, options?: { includeLeaderPane?: boolean; preservePaneId?: string }) => void
  invalidateStatus: (ctx: ExtensionContext) => void
  resetMailboxSyncKey: () => void
  runMailboxSync: (ctx: ExtensionContext) => void
}
