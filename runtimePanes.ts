import {
  clearPaneLabelSync,
  clearPaneLabelsForTeam,
  killPane,
  paneExists,
  resolvePaneBinding,
} from './tmux.js'
import type { TeamState } from './types.js'
import { TEAM_LEAD } from './types.js'

const paneReconcileCache = new Map<string, number>()
const paneReconcileRevisionCache = new Map<string, number>()
const PANE_RECONCILE_TTL_MS = 2000

export function invalidatePaneReconcileCache(teamName?: string): void {
  if (teamName) {
    paneReconcileCache.delete(teamName)
    paneReconcileRevisionCache.delete(teamName)
  } else {
    paneReconcileCache.clear()
    paneReconcileRevisionCache.clear()
  }
}

export function healMemberPaneBinding(member: TeamState['members'][string]): void {
  if (!member.paneId) return
  const binding = resolvePaneBinding(member.paneId)
  if (!binding) {
    const priorPaneId = member.paneId
    member.paneId = undefined
    member.windowTarget = undefined
    member.status = 'error'
    member.lastError = 'tmux pane disappeared'
    member.lastWakeReason = 'pane lost'
    member.updatedAt = Date.now()
    if (priorPaneId) {
      invalidatePaneReconcileCache()
    }
    return
  }
  if (member.paneId !== binding.paneId || member.windowTarget !== binding.target) {
    member.paneId = binding.paneId
    member.windowTarget = binding.target
    member.updatedAt = Date.now()
  }
}

export function reconcileTeamPanes(team: TeamState, options?: { force?: boolean }): boolean {
  const now = Date.now()
  const revision = team.revision ?? 0
  const lastAt = paneReconcileCache.get(team.name)
  const lastRevision = paneReconcileRevisionCache.get(team.name)
  if (!options?.force && lastAt !== undefined && now - lastAt < PANE_RECONCILE_TTL_MS && lastRevision === revision) {
    return false
  }
  paneReconcileCache.set(team.name, now)
  paneReconcileRevisionCache.set(team.name, revision)

  let changed = false
  for (const member of Object.values(team.members)) {
    const beforePane = member.paneId
    const beforeTarget = member.windowTarget
    const beforeStatus = member.status
    const beforeError = member.lastError
    const beforeWake = member.lastWakeReason
    healMemberPaneBinding(member)
    if (
      member.paneId !== beforePane ||
      member.windowTarget !== beforeTarget ||
      member.status !== beforeStatus ||
      member.lastError !== beforeError ||
      member.lastWakeReason !== beforeWake
    ) {
      changed = true
    }
  }
  return changed
}

function killTeamPanes(team: TeamState, options?: { includeLeader?: boolean; preservePaneId?: string }): void {
  for (const member of Object.values(team.members)) {
    if (!options?.includeLeader && member.name === TEAM_LEAD) continue
    if (!member.paneId) continue
    if (member.paneId === options?.preservePaneId) continue
    if (!paneExists(member.paneId)) continue
    killPane(member.paneId)
  }
}

export function clearAndKillTeamPanes(team: TeamState, options?: { includeLeaderPane?: boolean; preservePaneId?: string }): void {
  void clearPaneLabelsForTeam(team)
  if (options?.preservePaneId) {
    clearPaneLabelSync(options.preservePaneId)
  }
  killTeamPanes(team, {
    includeLeader: options?.includeLeaderPane,
    preservePaneId: options?.preservePaneId,
  })
}
