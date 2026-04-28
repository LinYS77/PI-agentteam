import type { ExtensionContext } from '@mariozechner/pi-coding-agent'
import {
  appendTaskNote,
  deleteTeamState,
  ensureAttachedSessionContext,
  peekUnreadMailbox,
  readTeamState,
  updateTeamState,
} from './state.js'
import { getCurrentMemberName, getCurrentTeamName, getSessionFile } from './session.js'
import {
  captureCurrentPaneBinding,
  syncPaneLabelsForTeam,
} from './tmux.js'
export { isInsideTmux as isLeaderInsideTmux } from './tmux/core.js'
import {
  defaultThreadIdForTask,
  normalizeMessageType,
  normalizePriority,
  normalizeWakeHint,
} from './protocol.js'
import { TEAM_LEAD } from './types.js'
import { oneLine } from './utils.js'
import type {
  TeamMessagePriority,
  TeamMessageType,
  TeamMessageWakeHint,
  TeamState,
  TeamTask,
} from './types.js'
import {
  assertValidOwner,
  classifySpawnTask,
  normalizeOwnerName,
  sanitizeTeamName,
  sanitizeWorkerName,
} from './runtimeRules.js'
import {
  ensureTeamStorageReady,
  invalidateMailboxEnsureCache,
} from './runtimeStorage.js'
import {
  clearAndKillTeamPanes,
  healMemberPaneBinding,
  invalidatePaneReconcileCache,
  reconcileTeamPanes,
} from './runtimePanes.js'
import {
  cancelPendingNudge,
  wakeLeaderIfNeeded,
  wakeWorker,
} from './runtimeWake.js'
import type { WakeNudgeConfig, WakeResult } from './runtimeWake.js'

export type AttachedSessionContext = {
  context: { teamName: string | null; memberName: string | null }
  source: 'cached' | 'derived' | 'cleared' | 'none'
}

export type { WakeNudgeConfig, WakeResult }

export {
  assertValidOwner,
  cancelPendingNudge,
  classifySpawnTask,
  ensureTeamStorageReady,
  healMemberPaneBinding,
  invalidatePaneReconcileCache,
  normalizeOwnerName,
  reconcileTeamPanes,
  sanitizeTeamName,
  sanitizeWorkerName,
  wakeLeaderIfNeeded,
  wakeWorker,
}

export function ensureTeamForSession(ctx: ExtensionContext): TeamState | null {
  const teamName = getCurrentTeamName(ctx)
  if (!teamName) return null
  const team = readTeamState(teamName)
  if (!team) return null
  ensureTeamStorageReady(team)
  if (reconcileTeamPanes(team, { force: true })) {
    updateTeamState(team.name, () => team)
  }
  return team
}

export function currentActor(ctx: ExtensionContext): string {
  return getCurrentMemberName(ctx) ?? TEAM_LEAD
}

export function appendStructuredTaskNote(
  task: TeamTask,
  author: string,
  text: string,
  details?: {
    threadId?: string
    messageType?: TeamMessageType
    requestId?: string
    linkedMessageId?: string
    metadata?: Record<string, unknown>
  },
): void {
  appendTaskNote(task, author, text, {
    threadId: details?.threadId ?? defaultThreadIdForTask(task.id),
    messageType: details?.messageType,
    requestId: details?.requestId,
    linkedMessageId: details?.linkedMessageId,
    metadata: details?.metadata,
  })
}

export function maybeLinkTaskNoteToMessage(
  task: TeamTask,
  author: string,
  payload: {
    text: string
    type?: TeamMessageType
    taskId?: string
    threadId?: string
    requestId?: string
    metadata?: Record<string, unknown>
  },
): void {
  if (!payload.taskId || payload.taskId !== task.id) return
  appendStructuredTaskNote(task, author, `Linked message: ${oneLine(payload.text)}`, {
    messageType: payload.type,
    threadId: payload.threadId ?? defaultThreadIdForTask(task.id),
    requestId: payload.requestId,
    metadata: payload.metadata,
  })
}

export function attachCurrentSessionIfNeeded(ctx: ExtensionContext): AttachedSessionContext {
  return ensureAttachedSessionContext(getSessionFile(ctx))
}

export function refreshForSession(
  ctx: ExtensionContext,
  attached?: AttachedSessionContext,
  options?: { forceReconcile?: boolean },
): void {
  const resolved = attached ?? attachCurrentSessionIfNeeded(ctx)
  const team = resolved.context.teamName ? readTeamState(resolved.context.teamName) : null
  if (team) {
    ensureTeamStorageReady(team)
    const changed = reconcileTeamPanes(team, options?.forceReconcile ? { force: true } : undefined)
    const currentPane = captureCurrentPaneBinding()
    let leaderChanged = false
    if (
      resolved.context.memberName === TEAM_LEAD &&
      currentPane &&
      !team.members[TEAM_LEAD]?.paneId
    ) {
      team.members[TEAM_LEAD] = {
        ...(team.members[TEAM_LEAD] ?? {
          name: TEAM_LEAD,
          role: 'leader',
          cwd: ctx.cwd,
          sessionFile: getSessionFile(ctx),
          status: 'idle',
          createdAt: team.createdAt,
          updatedAt: Date.now(),
        }),
        paneId: currentPane.paneId,
        windowTarget: currentPane.target,
      }
      leaderChanged = true
    }
    if (changed || leaderChanged) {
      updateTeamState(team.name, () => team)
    }
    void syncPaneLabelsForTeam(team)
  }
  ctx.ui.setStatus('agentteam', undefined)
  ctx.ui.setWidget('agentteam', undefined)
}

export function buildSessionStatusKey(
  ctx: ExtensionContext,
  attached: AttachedSessionContext,
): string {
  const sessionFile = getSessionFile(ctx)
  const teamName = attached.context.teamName
  const memberName = attached.context.memberName
  if (!teamName || !memberName) {
    return `${sessionFile}|${attached.source}|unbound`
  }

  const team = readTeamState(teamName)
  if (!team) {
    return `${sessionFile}|${attached.source}|${teamName}|missing`
  }

  const actor = team.members[memberName]
  const revision = team.revision ?? 0
  const memberCount = Object.keys(team.members).length
  const taskCount = Object.keys(team.tasks).length
  if (!actor) {
    return `${sessionFile}|${attached.source}|${teamName}|${memberName}|rev:${revision}|members:${memberCount}|tasks:${taskCount}|actor:missing`
  }

  return `${sessionFile}|${attached.source}|${teamName}|${memberName}|rev:${revision}|members:${memberCount}|tasks:${taskCount}|actor:${actor.status}:${actor.updatedAt}:${actor.lastWakeReason ?? ''}:${actor.lastError ?? ''}`
}

export function deleteTeamRuntime(team: TeamState, options?: { includeLeaderPane?: boolean; preservePaneId?: string }): void {
  clearAndKillTeamPanes(team, options)
  deleteTeamState(team.name)
  invalidateMailboxEnsureCache(team.name)
  invalidatePaneReconcileCache(team.name)
}

export function deliverLeaderMailbox(
  ctx: ExtensionContext,
): Array<{
  id: string
  teamName: string
  from: string
  text: string
  summary?: string
  type?: TeamMessageType
  taskId?: string
  threadId?: string
  requestId?: string
  replyTo?: string
  priority?: TeamMessagePriority
  wakeHint?: TeamMessageWakeHint
  createdAt: number
}> {
  const teamName = getCurrentTeamName(ctx)
  const memberName = getCurrentMemberName(ctx)
  if (!teamName || memberName !== TEAM_LEAD) return []
  const team = readTeamState(teamName)
  if (team) ensureTeamStorageReady(team)
  if (team && reconcileTeamPanes(team)) {
    updateTeamState(team.name, () => team)
  }
  const unread = peekUnreadMailbox(teamName, TEAM_LEAD)
  return unread.map(msg => {
    const type = normalizeMessageType(msg.type)
    return {
      id: msg.id,
      teamName,
      from: msg.from,
      text: msg.text,
      summary: msg.summary,
      type,
      taskId: msg.taskId,
      threadId: msg.threadId,
      requestId: msg.requestId,
      replyTo: msg.replyTo,
      priority: normalizePriority(msg.priority),
      wakeHint: normalizeWakeHint(type, msg.wakeHint, TEAM_LEAD),
      createdAt: msg.createdAt,
    }
  })
}
