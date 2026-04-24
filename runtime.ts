import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ExtensionContext } from '@mariozechner/pi-coding-agent'
import {
  appendTaskNote,
  deleteTeamState,
  ensureAttachedSessionContext,
  ensureMailbox,
  getMailboxPath,
  getTeamStatePath,
  markMailboxMessagesRead,
  peekUnreadMailbox,
  readTeamState,
  updateMemberStatus,
  writeTeamState,
} from './state.js'
import { getCurrentMemberName, getCurrentTeamName, getSessionFile } from './session.js'
import {
  captureCurrentPaneBinding,
  clearPaneLabelsForTeam,
  killPane,
  paneExists,
  resolvePaneBinding,
  sendEnterToPane,
  sendPromptToPane,
  syncPaneLabelsForTeam,
} from './tmux.js'
import {
  defaultThreadIdForTask,
  normalizeMessageType,
  normalizePriority,
  normalizeWakeHint,
  shouldWakeRecipient,
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

export type AttachedSessionContext = {
  context: { teamName: string | null; memberName: string | null }
  source: 'cached' | 'derived' | 'cleared' | 'none'
}

export type WakeResult =
  | { ok: true; recipient: string; wakeHint: TeamMessageWakeHint; reason: string; prompt: string; nudgeScheduled?: boolean }
  | { ok: false; recipient: string; wakeHint?: TeamMessageWakeHint; reason: string; error?: string }

export type WakeNudgeConfig = {
  enabled: boolean
  delayMs: number
}

const DEFAULT_WAKE_NUDGE_CONFIG: WakeNudgeConfig = {
  enabled: true,
  delayMs: 8000,
}

export function sanitizeWorkerName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
}

export function sanitizeTeamName(name: string): string {
  return sanitizeWorkerName(name)
}

export function normalizeOwnerName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return ''
  return trimmed === TEAM_LEAD ? TEAM_LEAD : sanitizeWorkerName(trimmed)
}

export function assertValidOwner(team: TeamState, owner: string): void {
  if (owner === TEAM_LEAD) return
  if (!team.members[owner]) {
    throw new Error(`Owner ${owner} not found in current team`)
  }
}

function isIdleLikeTask(task?: string): boolean {
  const text = task?.trim().toLowerCase()
  if (!text) return true
  return [
    /^wake\s+instruction\s*:?$/i,
    /^instruction\s*:?$/i,
    /^stay idle[.!\s]*$/i,
    /^do not perform any actions?[.!\s]*$/i,
    /^wait for instructions?[.!\s]*$/i,
    /until explicitly instructed/i,
    /不要进行任何操作/,
    /保持空闲/,
    /先待命/,
    /不要开始/,
    /只创建/,
  ].some(pattern => pattern.test(text))
}

function isDeferredFollowupTask(task?: string): boolean {
  const text = task?.trim().toLowerCase()
  if (!text) return false
  return [
    /先等待/,
    /等待.*(报告|消息|结果|完成)/,
    /收到.*后/,
    /wait\s+for\s+.*(report|message|result)/i,
    /after\s+.*(report|message|result)/i,
    /once\s+.*(report|message|result)/i,
  ].some(pattern => pattern.test(text))
}

export function classifySpawnTask(task?: string): { initialTask?: string; bootPrompt?: string } {
  const text = task?.trim()
  if (!text || isIdleLikeTask(text)) return {}
  if (isDeferredFollowupTask(text)) return { bootPrompt: text }
  return { initialTask: text }
}

export function ensureTeamForSession(ctx: ExtensionContext): TeamState | null {
  const teamName = getCurrentTeamName(ctx)
  if (!teamName) return null
  const team = readTeamState(teamName)
  if (!team) return null
  ensureTeamStorageReady(team)
  if (reconcileTeamPanes(team)) {
    writeTeamState(team)
  }
  return team
}

export function currentActor(ctx: ExtensionContext): string {
  return getCurrentMemberName(ctx) ?? TEAM_LEAD
}

async function wakeLeaderInternal(
  team: TeamState,
  message: {
    type?: TeamMessageType
    wakeHint?: TeamMessageWakeHint
    from?: string
    summary?: string
    text?: string
  },
): Promise<WakeResult> {
  const type = normalizeMessageType(message.type)
  const wakeHint = normalizeWakeHint(type, message.wakeHint, TEAM_LEAD)
  const leader = team.members[TEAM_LEAD]
  if (!leader || !leader.paneId) return { ok: false, recipient: TEAM_LEAD, wakeHint, reason: 'leader pane binding missing' }
  if (!shouldWakeRecipient(wakeHint)) return { ok: false, recipient: TEAM_LEAD, wakeHint, reason: 'wake hint does not require wake' }
  if (!paneExists(leader.paneId)) return { ok: false, recipient: TEAM_LEAD, wakeHint, reason: 'leader pane missing' }

  const sender = message.from ? `from ${message.from}` : 'from teammate'
  const summary = oneLine(message.summary ?? message.text ?? type)
  const prompt = `Agentteam signal (${type}) ${sender}: ${summary}. Please triage unread leader mailbox now (agentteam_receive) and coordinate next step.`

  try {
    await sendPromptToPane(leader.paneId, prompt)
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error)
    updateMemberStatus(team, TEAM_LEAD, {
      status: 'error',
      lastWakeReason: 'leader wake failed',
      lastError: err,
    })
    return { ok: false, recipient: TEAM_LEAD, wakeHint, reason: 'wake failed', error: err }
  }

  updateMemberStatus(team, TEAM_LEAD, {
    status: 'running',
    lastWakeReason: `signal ${type}`,
    lastError: undefined,
  })
  return { ok: true, recipient: TEAM_LEAD, wakeHint, reason: `signal ${type}`, prompt }
}

function buildMemberTurnPrompt(team: TeamState, memberName: string, explicitTask?: string): string | null {
  const member = team.members[memberName]
  if (!member || member.name === TEAM_LEAD) return null
  const unread = peekUnreadMailbox(team.name, memberName)
  const assigned = Object.values(team.tasks)
    .filter(task => task.owner === memberName && task.status !== 'completed')
    .sort((a, b) => a.id.localeCompare(b.id))

  const hasTrigger = Boolean(member.bootPrompt || explicitTask || unread.length > 0 || assigned.length > 0)
  if (!hasTrigger) return null

  const sections: string[] = []
  if (member.bootPrompt) {
    sections.push(`Boot: ${oneLine(member.bootPrompt)}`)
  }
  if (assigned.length > 0) {
    sections.push(
      `Assigned tasks: ${assigned.map(task => `${task.id} ${oneLine(task.title)} — ${oneLine(task.description)}`).join(' | ')}`,
    )
  }
  if (unread.length > 0) {
    sections.push(
      `Messages: ${unread.map(msg => `from ${msg.from}: ${oneLine(msg.text)}`).join(' | ')}`,
    )
  }
  if (explicitTask) {
    sections.push(`Instruction: ${oneLine(explicitTask)}`)
  }
  sections.push('Do the work now and report progress concisely through shared tasks/messages when useful.')
  return sections.join(' || ')
}

const pendingNudges = new Map<string, NodeJS.Timeout>()

export function cancelPendingNudge(memberName: string): void {
  const timer = pendingNudges.get(memberName)
  if (timer !== undefined) {
    clearTimeout(timer)
    pendingNudges.delete(memberName)
  }
}

async function wakeWorkerInternal(
  team: TeamState,
  memberName: string,
  explicitTask?: string,
  nudgeConfig: WakeNudgeConfig = DEFAULT_WAKE_NUDGE_CONFIG,
): Promise<WakeResult> {
  const member = team.members[memberName]
  if (!member || member.name === TEAM_LEAD) return { ok: false, recipient: memberName, reason: 'member not found or leader' }
  healMemberPaneBinding(member)
  if (!member.paneId) return { ok: false, recipient: memberName, reason: 'member pane binding missing' }
  if (member.status === 'running' && !explicitTask && member.lastWakeReason === 'processing prompt') {
    return { ok: false, recipient: memberName, reason: 'member already processing prompt' }
  }

  const unread = peekUnreadMailbox(team.name, memberName)
  const prompt = buildMemberTurnPrompt(team, memberName, explicitTask)
  if (!prompt) return { ok: false, recipient: memberName, reason: 'no prompt-worthy task, boot prompt, or unread message' }

  const wakeReason = explicitTask ? 'direct assignment' : unread.length > 0 ? 'mailbox/task update' : 'task update'
  cancelPendingNudge(memberName)
  updateMemberStatus(team, memberName, {
    status: 'running',
    lastWakeReason: wakeReason,
    lastError: undefined,
    bootPrompt: undefined,
  })
  writeTeamState(team)

  try {
    await sendPromptToPane(member.paneId, prompt)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    healMemberPaneBinding(member)
    updateMemberStatus(team, memberName, {
      status: 'error',
      lastWakeReason: 'wake failed',
      lastError: message,
    })
    writeTeamState(team)
    return { ok: false, recipient: memberName, reason: 'wake failed', error: message }
  }

  markMailboxMessagesRead(
    team.name,
    memberName,
    unread.map(msg => msg.id),
  )

  let nudgeScheduled = false
  if (nudgeConfig.enabled && nudgeConfig.delayMs > 0) {
    // Reliability nudge: some shells/TUI setups occasionally lose the first Enter-triggered run.
    // Cancellable: cleared on agent_start so we never send Enter while agent is already responding.
    const wakeAt = Date.now()
    const nudgeTimer = setTimeout(() => {
      pendingNudges.delete(memberName)
      try {
        const latest = readTeamState(team.name)
        const m = latest?.members?.[memberName]
        if (!latest || !m || m.status !== 'running' || !m.paneId || !paneExists(m.paneId)) return
        if (m.updatedAt > wakeAt + 2000) return
        const pendingUnread = peekUnreadMailbox(latest.name, memberName)
        if (pendingUnread.length === 0) {
          sendEnterToPane(m.paneId)
        }
      } catch {
        // ignore best-effort nudge failures
      }
    }, nudgeConfig.delayMs)
    nudgeTimer.unref?.()
    pendingNudges.set(memberName, nudgeTimer)
    nudgeScheduled = true
  }

  return { ok: true, recipient: memberName, wakeHint: explicitTask ? 'hard' : 'soft', reason: wakeReason, prompt, nudgeScheduled }
}

export async function wakeLeaderIfNeeded(
  team: TeamState,
  message: {
    type?: TeamMessageType
    wakeHint?: TeamMessageWakeHint
    from?: string
    summary?: string
    text?: string
  },
): Promise<WakeResult> {
  return wakeLeaderInternal(team, message)
}

export async function wakeWorker(
  team: TeamState,
  memberName: string,
  explicitTask?: string,
  nudgeConfig: WakeNudgeConfig = DEFAULT_WAKE_NUDGE_CONFIG,
): Promise<WakeResult> {
  return wakeWorkerInternal(team, memberName, explicitTask, nudgeConfig)
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
): void {
  const resolved = attached ?? attachCurrentSessionIfNeeded(ctx)
  const team = resolved.context.teamName ? readTeamState(resolved.context.teamName) : null
  if (team) {
    ensureTeamStorageReady(team)
    const changed = reconcileTeamPanes(team)
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
      writeTeamState(team)
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

const ensuredMailboxCache = new Set<string>()

function mailboxEnsureKey(teamName: string, memberName: string): string {
  return `${teamName}:${memberName}`
}

function invalidateMailboxEnsureCache(teamName?: string): void {
  if (!teamName) {
    ensuredMailboxCache.clear()
    return
  }
  const prefix = `${teamName}:`
  for (const key of ensuredMailboxCache) {
    if (key.startsWith(prefix)) {
      ensuredMailboxCache.delete(key)
    }
  }
}

export function ensureTeamStorageReady(team: TeamState): void {
  const statePath = getTeamStatePath(team.name)
  fs.mkdirSync(path.dirname(statePath), { recursive: true })

  const memberNames = [TEAM_LEAD, ...Object.values(team.members)
    .map(member => member.name)
    .filter(name => name !== TEAM_LEAD)]
  const validKeys = new Set(memberNames.map(memberName => mailboxEnsureKey(team.name, memberName)))

  const prefix = `${team.name}:`
  for (const key of ensuredMailboxCache) {
    if (key.startsWith(prefix) && !validKeys.has(key)) {
      ensuredMailboxCache.delete(key)
    }
  }

  for (const memberName of memberNames) {
    const key = mailboxEnsureKey(team.name, memberName)
    const mailboxPath = getMailboxPath(team.name, memberName)
    if (ensuredMailboxCache.has(key) && fs.existsSync(mailboxPath)) {
      continue
    }
    ensureMailbox(team.name, memberName)
    ensuredMailboxCache.add(key)
  }
}

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

export function reconcileTeamPanes(team: TeamState): boolean {
  const now = Date.now()
  const revision = team.revision ?? 0
  const lastAt = paneReconcileCache.get(team.name)
  const lastRevision = paneReconcileRevisionCache.get(team.name)
  if (lastAt !== undefined && now - lastAt < PANE_RECONCILE_TTL_MS && lastRevision === revision) {
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

export function healMemberPaneBinding(member: TeamState['members'][string]): void {
  if (!member.paneId) return
  const binding = resolvePaneBinding(member.paneId)
  if (!binding) {
    const priorPaneId = member.paneId
    member.paneId = undefined
    member.windowTarget = undefined
    if (member.status === 'running' || member.status === 'queued') {
      member.status = 'idle'
    }
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

function killTeamPanes(team: TeamState, options?: { includeLeader?: boolean }): void {
  for (const member of Object.values(team.members)) {
    if (!options?.includeLeader && member.name === TEAM_LEAD) continue
    if (!member.paneId) continue
    if (!paneExists(member.paneId)) continue
    killPane(member.paneId)
  }
}

export function deleteTeamRuntime(team: TeamState, options?: { includeLeaderPane?: boolean }): void {
  void clearPaneLabelsForTeam(team)
  killTeamPanes(team, { includeLeader: options?.includeLeaderPane })
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
    writeTeamState(team)
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
