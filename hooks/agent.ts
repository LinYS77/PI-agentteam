import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent'
import { readTeamState, updateMemberStatus, writeTeamState } from '../state.js'
import { getCurrentMemberName, getCurrentTeamName } from '../session.js'
import { TEAM_LEAD } from '../types.js'

type AgentHookDeps = {
  cancelPendingNudge: (memberName: string) => void
  resetMailboxSyncKey: () => void
  runMailboxSync: (ctx: ExtensionContext) => void
  invalidateStatus: (ctx: ExtensionContext) => void
}

export function registerAgentHooks(pi: ExtensionAPI, deps: AgentHookDeps): void {
  pi.on('agent_start', async (_event, ctx) => {
    const teamName = getCurrentTeamName(ctx)
    const memberName = getCurrentMemberName(ctx)
    if (!teamName || !memberName || memberName === TEAM_LEAD) return

    const team = readTeamState(teamName)
    if (!team) return

    deps.cancelPendingNudge(memberName)

    updateMemberStatus(team, memberName, {
      status: 'running',
      lastWakeReason: 'processing prompt',
      lastError: undefined,
    })
    writeTeamState(team)
    deps.invalidateStatus(ctx)
  })

  pi.on('agent_end', async (_event, ctx) => {
    const teamName = getCurrentTeamName(ctx)
    const memberName = getCurrentMemberName(ctx)
    if (teamName && memberName && memberName !== TEAM_LEAD) {
      const team = readTeamState(teamName)
      if (team) {
        updateMemberStatus(team, memberName, {
          status: 'idle',
          lastWakeReason: 'finished turn',
          lastError: undefined,
        })
        writeTeamState(team)
      }
    }

    deps.resetMailboxSyncKey()
    deps.runMailboxSync(ctx)
    deps.invalidateStatus(ctx)
  })
}
