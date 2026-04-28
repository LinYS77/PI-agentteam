import * as fs from 'node:fs'
import type { ExtensionContext } from '@mariozechner/pi-coding-agent'
import {
  clearSessionContext,
  getMailboxPath,
  getSessionContextPath,
  listTeams,
  readTeamState,
  removeMember,
  updateTeamState,
  writeSessionContext,
} from '../state.js'
import { getCurrentTeamName, getSessionFile } from '../session.js'
import {
  captureCurrentPaneBinding,
  clearPaneLabelSync,
  killPane,
  listAgentTeamPanes,
  paneExists,
  syncPaneLabelsForTeam,
} from '../tmux.js'
import { TEAM_LEAD } from '../types.js'
import type { TeamState } from '../types.js'
import type { CommandHandlerDeps } from './shared.js'

export function removeSelectedMember(
  ctx: ExtensionContext,
  deps: CommandHandlerDeps,
  teamName: string,
  memberName: string,
): boolean {
  if (memberName === TEAM_LEAD) {
    ctx.ui.notify('team-lead cannot be removed from /team', 'warning')
    return false
  }

  const team = readTeamState(teamName)
  const member = team?.members[memberName]
  if (!team || !member) {
    ctx.ui.notify(`Member ${memberName} no longer exists`, 'warning')
    return false
  }

  const paneId = member.paneId
  const sessionFile = member.sessionFile
  const currentPane = currentPaneId()
  updateTeamState(team.name, latest => {
    removeMember(latest, memberName)
  })

  clearSessionFileAndBinding(sessionFile)
  removeMailbox(team.name, memberName)

  if (paneId === currentPane) {
    clearPaneLabelSync(paneId)
  } else if (paneId && paneExists(paneId)) {
    killPane(paneId)
  }

  deps.invalidateStatus(ctx)
  ctx.ui.notify(`Removed ${memberName}`, 'info')
  return true
}

function currentPane(): { paneId: string; target: string } | null {
  return captureCurrentPaneBinding()
}

function currentPaneId(): string | undefined {
  return currentPane()?.paneId
}

function clearSessionFileAndBinding(sessionFile?: string): void {
  if (!sessionFile) return
  clearSessionContext(sessionFile)
  if (sessionFile.startsWith('ephemeral:')) return
  try {
    fs.rmSync(sessionFile, { force: true })
  } catch {
    // ignore
  }
}

function removeMailbox(teamName: string, memberName: string): void {
  try {
    fs.rmSync(getMailboxPath(teamName, memberName), { force: true })
  } catch {
    // ignore
  }
}

function removeSessionContextOnly(sessionFile?: string): void {
  if (!sessionFile) return
  try {
    fs.rmSync(getSessionContextPath(sessionFile), { force: true })
  } catch {
    // ignore
  }
}

function staleMemberForMissingLeader(
  team: TeamState,
  currentPaneIdValue: string | undefined,
  currentTarget: string | undefined,
): string | undefined {
  if (!currentPaneIdValue) return undefined
  for (const member of Object.values(team.members)) {
    if (member.name === TEAM_LEAD) continue
    if (member.paneId === currentPaneIdValue) return member.name
    if (!member.paneId && currentTarget && member.windowTarget === currentTarget) return member.name
  }
  return undefined
}

export function deleteSelectedTeam(
  ctx: ExtensionContext,
  deps: CommandHandlerDeps,
  teamName: string,
): boolean {
  const team = readTeamState(teamName)
  if (!team) {
    ctx.ui.notify(`Team ${teamName} no longer exists`, 'warning')
    return false
  }

  const currentTeamName = getCurrentTeamName(ctx)
  const currentPane = currentPaneId()
  const leaderPaneId = team.members[TEAM_LEAD]?.paneId

  deps.deleteTeamRuntime(team, {
    includeLeaderPane: leaderPaneId !== currentPane,
    preservePaneId: currentPane,
  })

  if (currentTeamName === team.name) {
    clearSessionContext(getSessionFile(ctx))
  }

  deps.invalidateStatus(ctx)
  ctx.ui.notify(`Deleted team ${team.name}`, 'info')
  return true
}

export function cleanupAllAgentTeamData(
  ctx: ExtensionContext,
  deps: CommandHandlerDeps,
): { deletedTeams: number; killedPanes: number } {
  const currentTeamName = getCurrentTeamName(ctx)
  const teams = listTeams()
  const currentPane = currentPaneId()

  const knownPaneIds = new Set<string>()
  for (const team of teams) {
    for (const member of Object.values(team.members)) {
      if (member.paneId) knownPaneIds.add(member.paneId)
    }
  }

  const orphanPanes = listAgentTeamPanes()
    .filter(pane => pane.paneId !== currentPane && !knownPaneIds.has(pane.paneId))

  let deletedTeams = 0
  for (const team of teams) {
    const leaderPaneId = team.members[TEAM_LEAD]?.paneId
    deps.deleteTeamRuntime(team, {
      includeLeaderPane: leaderPaneId !== currentPane,
      preservePaneId: currentPane,
    })
    deletedTeams += 1
  }

  if (currentTeamName) {
    clearSessionContext(getSessionFile(ctx))
  }

  if (currentPane) {
    clearPaneLabelSync(currentPane)
  }

  let killedPanes = 0
  for (const pane of orphanPanes) {
    killPane(pane.paneId)
    killedPanes += 1
  }

  deps.invalidateStatus(ctx)
  ctx.ui.notify(`Deleted ${deletedTeams} team(s), killed ${killedPanes} stale pane(s)`, 'info')
  return { deletedTeams, killedPanes }
}

export function recoverTeamAsCurrentLeader(
  ctx: ExtensionContext,
  deps: CommandHandlerDeps,
  teamName: string,
): TeamState | null {
  const sessionFile = getSessionFile(ctx)
  const pane = currentPane()
  const recovered = updateTeamState(teamName, team => {
    const now = Date.now()
    team.leaderSessionFile = sessionFile
    team.leaderCwd = ctx.cwd
    const staleMember = staleMemberForMissingLeader(team, pane?.paneId, pane?.target)
    if (staleMember) {
      const staleSessionFile = team.members[staleMember]?.sessionFile
      removeMember(team, staleMember)
      removeSessionContextOnly(staleSessionFile)
      removeMailbox(team.name, staleMember)
    }
    const previous = team.members[TEAM_LEAD]
    team.members[TEAM_LEAD] = {
      ...(previous ?? {
        name: TEAM_LEAD,
        role: 'leader',
        createdAt: team.createdAt,
        updatedAt: now,
        status: 'idle' as const,
      }),
      name: TEAM_LEAD,
      role: 'leader',
      cwd: ctx.cwd,
      sessionFile,
      paneId: pane?.paneId,
      windowTarget: pane?.target,
      status: 'idle',
      lastError: undefined,
      lastWakeReason: 'recovered as current leader',
      updatedAt: now,
    }
  })

  if (!recovered) {
    ctx.ui.notify(`Team ${teamName} no longer exists`, 'warning')
    return null
  }

  writeSessionContext(sessionFile, {
    teamName: recovered.name,
    memberName: TEAM_LEAD,
  })
  void syncPaneLabelsForTeam(recovered)
  deps.invalidateStatus(ctx)
  ctx.ui.notify(`Recovered team ${recovered.name} as current leader`, 'info')
  return recovered
}
