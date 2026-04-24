import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { StringEnum } from '@mariozechner/pi-ai'
import { Type } from 'typebox'
import {
  appendTeamEvent,
  markMailboxMessagesRead,
  pushMailboxMessage,
  readMailbox,
  writeTeamState,
} from '../state.js'
import { defaultThreadIdForTask, normalizeMessageType, normalizePriority, normalizeWakeHint, shouldWakeRecipient } from '../protocol.js'
import { TEAM_LEAD } from '../types.js'
import type { TeamMessageType } from '../types.js'
import { isLeader, oneLine } from '../utils.js'
import type { ToolHandlerDeps } from './shared.js'

const TeamSendParams = Type.Object({
  to: Type.String({ description: 'Recipient member name or * for broadcast' }),
  message: Type.String({ description: 'Message content' }),
  summary: Type.Optional(Type.String({ description: 'Short summary preview' })),
  type: Type.Optional(
    StringEnum(['assignment', 'question', 'blocked', 'completion_report', 'fyi'] as const),
  ),
  taskId: Type.Optional(Type.String()),
  priority: Type.Optional(
    StringEnum(['low', 'normal', 'high'] as const),
  ),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

const TeamReceiveParams = Type.Object({
  markRead: Type.Optional(Type.Boolean({ default: true })),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, default: 8 })),
})

function canSendMessageType(actor: string, type: TeamMessageType): boolean {
  if (isLeader(actor)) return true
  // Workers can report status and ask questions; only leader can assign.
  if (type === 'assignment') return false
  return true
}

function enforcePlannerSendPolicy(input: {
  senderRole: string
  messageType: TeamMessageType
  taskId?: string
}): string | null {
  if (input.senderRole !== 'planner') return null

  if (input.messageType === 'completion_report' && !input.taskId) {
    return 'Planner completion_report requires taskId so leader can audit the planning artifact in agentteam_task.'
  }

  return null
}

export function registerMessageTools(pi: ExtensionAPI, deps: ToolHandlerDeps): void {
  pi.registerTool({
    name: 'agentteam_send',
    label: 'AgentTeam Send',
    description: 'Send a typed message to one teammate or broadcast within the current team.',
    promptSnippet: 'Send typed coordination messages such as assignment, question, blocked, completion_report, or fyi within the current team.',
    promptGuidelines: [
      'Use agentteam_send after creating or claiming a shared task so the message can reference taskId when possible.',
      'Use agentteam_send with type assignment for direct delegation, question for clarification, blocked for escalation, completion_report for finished work, and fyi for lightweight handoffs.',
      'Prefer concise summaries in agentteam_send and keep long artifacts in shared task notes or files.',
    ],
    parameters: TeamSendParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const team = deps.ensureTeamForSession(ctx)
      if (!team) {
        return { content: [{ type: 'text', text: 'No current team context.' }], details: {} }
      }
      const sender = deps.currentActor(ctx)
      const recipients =
        params.to === '*'
          ? Object.values(team.members)
              .map(m => m.name)
              .filter(name => name !== sender)
          : [deps.sanitizeWorkerName(params.to)]
      const messageType: TeamMessageType = normalizeMessageType(params.type as string ?? 'question')
      const senderRole = (team.members[sender]?.role ?? '').trim().toLowerCase()
      const plannerPolicyDenied = enforcePlannerSendPolicy({
        senderRole,
        messageType,
        taskId: params.taskId,
      })
      if (plannerPolicyDenied) {
        return {
          content: [{ type: 'text', text: plannerPolicyDenied }],
          details: {
            denied: true,
            reason: 'planner_send_policy',
            sender,
            senderRole,
            type: messageType,
            taskId: params.taskId,
          },
        }
      }

      if (!canSendMessageType(sender, messageType)) {
        return {
          content: [{ type: 'text', text: `Message type ${messageType} is leader-only for non-leader actors` }],
          details: { denied: true, sender, type: messageType },
        }
      }
      const resolvedThreadId = defaultThreadIdForTask(params.taskId)
      const priority = normalizePriority(params.priority)
      const metadata = params.metadata as Record<string, unknown> | undefined
      const task = params.taskId ? team.tasks[params.taskId] : undefined
      const sent: string[] = []
      const wakeByRecipient: Array<{ recipient: string; wakeHint: string }> = []
      const skippedRecipients: Array<{ recipient: string; reason: string }> = []

      for (const recipient of recipients) {
        if (!recipient) {
          skippedRecipients.push({ recipient: params.to, reason: 'recipient name is empty after normalization' })
          continue
        }
        if (!team.members[recipient]) {
          skippedRecipients.push({ recipient, reason: 'member not found in current team' })
          continue
        }

        const target = team.members[recipient]
        const defaultWakeHint = normalizeWakeHint(messageType, undefined, recipient)
        const wakeHint =
          defaultWakeHint === 'none' &&
          messageType === 'fyi' &&
          sender !== TEAM_LEAD &&
          recipient !== TEAM_LEAD &&
          target?.status !== 'running'
            ? 'soft'
            : defaultWakeHint
        wakeByRecipient.push({ recipient, wakeHint })

        const sentMessage = pushMailboxMessage(team.name, recipient, {
          from: sender,
          to: recipient,
          text: params.message,
          summary: params.summary,
          type: messageType,
          taskId: params.taskId,
          threadId: resolvedThreadId,
          priority,
          wakeHint,
          metadata,
        })

        if (task) {
          deps.maybeLinkTaskNoteToMessage(task, sender, {
            text: params.message,
            type: messageType,
            taskId: params.taskId,
            threadId: resolvedThreadId,
            metadata: {
              ...(metadata ?? {}),
              to: recipient,
              linkedMailboxMessageId: sentMessage.id,
            },
          })
        }

        if (shouldWakeRecipient(wakeHint)) {
          if (recipient === TEAM_LEAD) {
            await deps.wakeLeaderIfNeeded(team, {
              type: messageType,
              wakeHint,
              from: sender,
              summary: params.summary,
              text: params.message,
            })
          } else if (target?.status !== 'running') {
            await deps.wakeWorker(team, recipient)
          }
        }

        sent.push(recipient)
      }
      const peerRecipients = sent.filter(name => name !== TEAM_LEAD)
      if (sender !== TEAM_LEAD && peerRecipients.length > 0) {
        appendTeamEvent(team, {
          type: 'peer_message',
          by: sender,
          text: oneLine(`${messageType} -> ${peerRecipients.join(', ')}: ${params.summary ?? params.message}`),
          metadata: {
            recipients: peerRecipients,
            taskId: params.taskId,
            threadId: resolvedThreadId,
            type: messageType,
            priority,
          },
        })
      }

      writeTeamState(team)
      deps.invalidateStatus(ctx)
      const summary = sent.length > 0
        ? `Sent message to ${sent.join(', ')}`
        : 'Sent message to nobody'
      const skippedSummary = skippedRecipients.length > 0
        ? `; skipped ${skippedRecipients.map(item => `${item.recipient} (${item.reason})`).join(', ')}`
        : ''
      return {
        content: [{ type: 'text', text: `${summary}${skippedSummary}` }],
        details: {
          recipients: sent,
          skippedRecipients,
          type: messageType,
          wakeByRecipient,
          priority,
          taskId: params.taskId,
          threadId: resolvedThreadId,
        },
      }
    },
  })

  pi.registerTool({
    name: 'agentteam_receive',
    label: 'AgentTeam Receive',
    description: 'Receive unread mailbox messages for the current team member. Optionally marks returned messages as read.',
    promptSnippet: 'Read unread agentteam mailbox messages for the current actor when you need teammate updates or leader instructions.',
    promptGuidelines: [
      'Use agentteam_receive when a teammate likely sent actionable updates, instead of guessing mailbox state.',
      'When using agentteam_receive as the leader, synthesize the received updates into the next delegation or final user answer.',
    ],
    parameters: TeamReceiveParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const team = deps.ensureTeamForSession(ctx)
      if (!team) {
        return { content: [{ type: 'text', text: 'No current team context.' }], details: {} }
      }
      const recipient = deps.currentActor(ctx)
      if (!team.members[recipient]) {
        return {
          content: [{ type: 'text', text: `Current actor ${recipient} is not a member of team ${team.name}.` }],
          details: { recipient, teamName: team.name },
        }
      }

      const limit = Math.max(1, Math.min(50, Math.floor(params.limit ?? 8)))
      const markRead = params.markRead !== false

      const unread = readMailbox(team.name, recipient)
        .filter(item => !item.readAt)
        .sort((a, b) => a.createdAt - b.createdAt)
      const returned = unread.slice(0, limit)

      if (markRead && returned.length > 0) {
        markMailboxMessagesRead(team.name, recipient, returned.map(item => item.id))
      }

      const fromSet = new Set(returned.map(item => item.from))
      const fromPreview = [...fromSet].slice(0, 3).join(', ')
      const receipt =
        returned.length === 0
          ? `No unread messages for ${recipient}`
          : returned.length === 1
            ? `Received 1 message from ${returned[0]!.from}`
            : `Received ${returned.length} messages from ${fromPreview}${fromSet.size > 3 ? ', ...' : ''}`

      const detailLines = returned.map(item => {
        const type = normalizeMessageType(item.type as string)
        const task = item.taskId ? ` task=${item.taskId}` : ''
        const thread = item.threadId ? ` thread=${item.threadId}` : ''
        const summary = item.summary ?? item.text
        return `- [${type}] from ${item.from}${task}${thread}: ${summary}`
      })

      return {
        content: [{
          type: 'text',
          text: returned.length > 0
            ? `${receipt}\n${detailLines.join('\n')}`
            : receipt,
        }],
        details: {
          recipient,
          unreadCount: unread.length,
          returnedCount: returned.length,
          markRead,
          messages: returned,
        },
      }
    },
  })

}
