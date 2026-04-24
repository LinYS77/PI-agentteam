import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import {
  clearSessionContext,
  readTeamState,
} from '../state.js'
import { getCurrentTeamName, getSessionFile } from '../session.js'
import { openTeamPanel } from '../teamPanel.js'
import {
  ensureSwarmWindow,
  focusPane,
  paneExists,
} from '../tmux.js'
import { TEAM_LEAD } from '../types.js'
import type { CommandHandlerDeps } from './shared.js'

export function registerTeamCommands(pi: ExtensionAPI, deps: CommandHandlerDeps): void {
  const runTeamSync = (ctx: Parameters<CommandHandlerDeps['runMailboxSync']>[0]): void => {
    deps.resetMailboxSyncKey()
    deps.runMailboxSync(ctx)
    deps.invalidateStatus(ctx)
    ctx.ui.notify('Synced agentteam mailbox', 'info')
  }

  pi.registerCommand('team', {
    description: 'Open the current session\'s agentteam panel',
    handler: async (_args, ctx) => {
      const teamName = getCurrentTeamName(ctx)
      if (!teamName) {
        ctx.ui.notify('Current session is not attached to an agentteam. Create one first.', 'warning')
        return
      }
      const team = readTeamState(teamName)
      if (!team) {
        clearSessionContext(getSessionFile(ctx))
        deps.invalidateStatus(ctx)
        ctx.ui.notify(`Attached team ${teamName} no longer exists; binding cleared`, 'warning')
        return
      }
      const result = await openTeamPanel(ctx, teamName, () => {
        deps.resetMailboxSyncKey()
        deps.runMailboxSync(ctx)
      })
      if (result?.type === 'open-session') {
        const team = readTeamState(teamName)
        const member = team?.members
          ? Object.values(team.members).find(m => m.sessionFile === result.sessionFile)
          : undefined
        if (member?.paneId && paneExists(member.paneId)) {
          focusPane(member.paneId)
          ctx.ui.notify(`Focused pane for ${member.name}`, 'info')
        } else {
          ctx.ui.notify('No tmux pane registered for that teammate', 'warning')
        }
      }
      if (result?.type === 'open-leader-session') {
        const team = readTeamState(teamName)
        const swarm = await ensureSwarmWindow(team?.members?.[TEAM_LEAD] ? {
          target: team.members[TEAM_LEAD]!.windowTarget,
          leaderPaneId: team.members[TEAM_LEAD]!.paneId,
        } : undefined)
        focusPane(swarm.leaderPaneId)
        ctx.ui.notify('Focused leader pane', 'info')
      }
      if (result?.type === 'open-task') {
        const team = readTeamState(teamName)
        const task = result.taskId ? team?.tasks[result.taskId] : undefined
        if (!task) {
          ctx.ui.notify(`Task ${result.taskId} not found`, 'warning')
          return
        }
        const owner = task.owner
        const ownerMember = owner ? team?.members[owner] : undefined
        if (ownerMember?.paneId && paneExists(ownerMember.paneId)) {
          focusPane(ownerMember.paneId)
          ctx.ui.notify(`Focused ${owner} for ${task.id}`, 'info')
          return
        }
        if (task.owner) {
          ctx.ui.notify(`Task ${task.id} owner ${task.owner} has no live pane`, 'warning')
          return
        }
        ctx.ui.notify(`Task ${task.id} is unassigned`, 'info')
      }
    },
  })

  // Keep mailbox-sync style command registered after /team so /team remains primary in command completion.
  pi.registerCommand('team-sync', {
    description: 'Pull agentteam mailbox updates into the current leader session',
    handler: async (_args, ctx) => {
      runTeamSync(ctx)
    },
  })

  pi.registerCommand('team-delete', {
    description: 'Delete the current session-attached team',
    handler: async (args, ctx) => {
      const currentTeamName = getCurrentTeamName(ctx)
      if (!currentTeamName) {
        ctx.ui.notify('Current session has no attached team', 'warning')
        return
      }
      if (args.trim()) {
        ctx.ui.notify('team-delete only deletes the current attached team; extra argument was ignored', 'warning')
      }

      const team = readTeamState(currentTeamName)
      if (!team) {
        clearSessionContext(getSessionFile(ctx))
        deps.invalidateStatus(ctx)
        ctx.ui.notify(`Attached team ${currentTeamName} no longer exists; binding cleared`, 'warning')
        return
      }

      const ok = await ctx.ui.confirm('Delete current team?', `Delete current agentteam ${currentTeamName}? This removes its state, mailboxes, teammate panes, and bindings.`)
      if (!ok) return

      deps.deleteTeamRuntime(team, { includeLeaderPane: false })
      clearSessionContext(getSessionFile(ctx))
      deps.invalidateStatus(ctx)
      ctx.ui.notify(`Deleted current team ${currentTeamName}`, 'info')
    },
  })
}
