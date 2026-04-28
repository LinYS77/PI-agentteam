import { setTimeout } from 'node:timers'
import {
  markMailboxMessagesDelivered,
  peekUnreadMailbox,
  readTeamState,
  updateMemberStatus,
  updateTeamState,
} from './state.js'
import {
  sendEnterToPane,
  sendPromptToPane,
  paneExists,
} from './tmux.js'
import {
  normalizeMessageType,
  normalizeWakeHint,
  shouldWakeRecipient,
} from './protocol.js'
import { TEAM_LEAD } from './types.js'
import type {
  TeamMessageType,
  TeamMessageWakeHint,
  TeamState,
} from './types.js'
import { oneLine } from './utils.js'
import { undeliveredMailboxMessages } from './messageLifecycle.js'
import { healMemberPaneBinding } from './runtimePanes.js'

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

const pendingNudges = new Map<string, NodeJS.Timeout>()

export function cancelPendingNudge(memberName: string): void {
  const timer = pendingNudges.get(memberName)
  if (timer !== undefined) {
    clearTimeout(timer)
    pendingNudges.delete(memberName)
  }
}

function updateMemberStatusPersisted(
  team: TeamState,
  memberName: string,
  patch: Parameters<typeof updateMemberStatus>[2],
): void {
  updateMemberStatus(team, memberName, patch)
  updateTeamState(team.name, latest => {
    updateMemberStatus(latest, memberName, patch)
  })
}

function buildMemberTurnPrompt(
  team: TeamState,
  memberName: string,
  explicitTask: string | undefined,
  unreadMessagesForPrompt: ReturnType<typeof peekUnreadMailbox>,
): string | null {
  const member = team.members[memberName]
  if (!member || member.name === TEAM_LEAD) return null
  const assigned = Object.values(team.tasks)
    .filter(task => task.owner === memberName && task.status !== 'completed')
    .sort((a, b) => a.id.localeCompare(b.id))

  const hasTrigger = Boolean(member.bootPrompt || explicitTask || unreadMessagesForPrompt.length > 0 || assigned.length > 0)
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
  if (unreadMessagesForPrompt.length > 0) {
    sections.push(
      `Messages: ${unreadMessagesForPrompt.map(msg => `from ${msg.from}: ${oneLine(msg.text)}`).join(' | ')}`,
    )
  }
  if (explicitTask) {
    sections.push(`Instruction: ${oneLine(explicitTask)}`)
  }
  sections.push('Do the work now and report progress concisely through shared tasks/messages when useful.')
  return sections.join(' || ')
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
    updateMemberStatusPersisted(team, TEAM_LEAD, {
      status: 'error',
      lastWakeReason: 'leader wake failed',
      lastError: err,
    })
    return { ok: false, recipient: TEAM_LEAD, wakeHint, reason: 'wake failed', error: err }
  }

  updateMemberStatusPersisted(team, TEAM_LEAD, {
    status: 'running',
    lastWakeReason: `signal ${type}`,
    lastError: undefined,
  })
  return { ok: true, recipient: TEAM_LEAD, wakeHint, reason: `signal ${type}`, prompt }
}

export async function wakeWorker(
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
  const undeliveredUnread = undeliveredMailboxMessages(unread)
  const prompt = buildMemberTurnPrompt(team, memberName, explicitTask, undeliveredUnread)
  if (!prompt) return { ok: false, recipient: memberName, reason: 'no prompt-worthy task, boot prompt, or undelivered message' }

  const wakeReason = explicitTask ? 'direct assignment' : undeliveredUnread.length > 0 ? 'mailbox/task update' : 'task update'
  cancelPendingNudge(memberName)
  updateMemberStatusPersisted(team, memberName, {
    status: 'running',
    lastWakeReason: wakeReason,
    lastError: undefined,
    bootPrompt: undefined,
  })

  try {
    await sendPromptToPane(member.paneId, prompt)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    healMemberPaneBinding(member)
    updateMemberStatusPersisted(team, memberName, {
      status: 'error',
      lastWakeReason: 'wake failed',
      lastError: message,
    })
    return { ok: false, recipient: memberName, reason: 'wake failed', error: message }
  }

  markMailboxMessagesDelivered(
    team.name,
    memberName,
    undeliveredUnread.map(msg => msg.id),
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
        const pendingUndelivered = undeliveredMailboxMessages(pendingUnread)
        if (pendingUndelivered.length === 0) {
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
