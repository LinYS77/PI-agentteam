import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { StringEnum } from '@mariozechner/pi-ai'
import { Type } from 'typebox'
import { createTask, pushMailboxMessage, writeTeamState } from '../state.js'
import { defaultThreadIdForTask } from '../protocol.js'
import { TEAM_LEAD } from '../types.js'
import { isLeader } from '../utils.js'
import type { ToolHandlerDeps } from './shared.js'
import { formatTask } from './shared.js'

const TeamTaskParams = Type.Object({
  action: StringEnum(['create', 'list', 'claim', 'update', 'complete', 'note'] as const),
  taskId: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  owner: Type.Optional(Type.String()),
  status: Type.Optional(
    StringEnum(['pending', 'in_progress', 'blocked', 'completed'] as const),
  ),
  note: Type.Optional(Type.String()),
  blockedBy: Type.Optional(Type.Array(Type.String())),
})

function actorRole(team: { members: Record<string, { role: string }> }, actor: string): string {
  if (isLeader(actor)) return 'leader'
  return (team.members[actor]?.role ?? '').trim().toLowerCase()
}

function ensureTaskPrivilege(
  team: { members: Record<string, { role: string }> },
  actor: string,
  action: string,
): string | null {
  if (isLeader(actor)) return null

  const role = actorRole(team, actor)

  // everyone can inspect and annotate
  if (action === 'list' || action === 'note') return null

  if (role === 'planner') {
    // planner manages decomposition and can close planning milestones when done.
    if (action === 'create' || action === 'claim' || action === 'update' || action === 'complete') return null
  }

  // non-planner workers can report completion for owned tasks.
  if (action === 'complete') return null

  return `Task action '${action}' is not allowed for ${actor} (${role || 'worker'}). Allowed: list/note/complete${role === 'planner' ? '/create/claim/update' : ''}`
}

function buildImplementationCompletionNote(note?: string): string {
  const trimmed = note?.trim() ?? ''
  const template = [
    'Change summary:',
    '- Files changed: <path[:lines], ...>',
    '- Line range / diff scope: <start-end or hunk summary>',
    '- Checks run: <command -> result>',
    '- Validation result: <pass/fail + evidence>',
  ].join('\n')

  if (!trimmed) return template
  if (/Files changed:|Line range \/ diff scope:|Checks run:|Validation result:/i.test(trimmed)) {
    return trimmed
  }
  return `${trimmed}\n\n${template}`
}

export function registerTaskTools(pi: ExtensionAPI, deps: ToolHandlerDeps): void {
  pi.registerTool({
    name: 'agentteam_task',
    label: 'AgentTeam Task',
    description: 'Create, list, claim, update, annotate, and complete shared team tasks.',
    promptSnippet: 'Manage the shared agentteam task board: create, list, claim, update, note, and complete tasks.',
    promptGuidelines: [
      'Use agentteam_task before delegation so teammate work is tracked by taskId.',
      'Use agentteam_task action=create for concrete work items, action=claim to assign an owner, action=note for durable findings, and action=complete for explicit completion reports.',
      'When reporting implementation completion through agentteam_task, include files changed and checks run in the note when possible.',
    ],
    parameters: TeamTaskParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const team = deps.ensureTeamForSession(ctx)
      if (!team) {
        return { content: [{ type: 'text', text: 'No current team context.' }], details: {} }
      }
      const actor = deps.currentActor(ctx)
      const denied = ensureTaskPrivilege(team, actor, params.action)
      if (denied) {
        return { content: [{ type: 'text', text: denied }], details: { denied: true, action: params.action, actor } }
      }
      if (params.action === 'list') {
        const text =
          Object.values(team.tasks)
            .sort((a, b) => a.id.localeCompare(b.id))
            .map(formatTask)
            .join('\n') || 'No tasks'
        return { content: [{ type: 'text', text }], details: { count: Object.keys(team.tasks).length } }
      }

      if (params.action === 'create') {
        if (!params.title || !params.description) {
          throw new Error('title and description are required')
        }
        const task = createTask(team, {
          title: params.title,
          description: params.description,
          blockedBy: params.blockedBy,
        })
        deps.appendStructuredTaskNote(task, actor, 'Task created', {
          messageType: 'assignment',
          threadId: defaultThreadIdForTask(task.id),
        })
        writeTeamState(team)
        deps.invalidateStatus(ctx)
        return { content: [{ type: 'text', text: `Created ${formatTask(task)}` }], details: { task } }
      }

      if (!params.taskId) throw new Error('taskId is required for this action')
      const task = team.tasks[params.taskId]
      if (!task) throw new Error(`Task ${params.taskId} not found`)

      if (params.action === 'claim') {
        const owner = params.owner !== undefined ? deps.normalizeOwnerName(params.owner) : actor
        if (!owner) throw new Error('owner cannot be empty')
        deps.assertValidOwner(team, owner)
        task.owner = owner
        task.status = 'in_progress'
        task.updatedAt = Date.now()
        deps.appendStructuredTaskNote(task, actor, `Claimed by ${owner}`, {
          messageType: 'assignment',
          threadId: defaultThreadIdForTask(task.id),
        })
        writeTeamState(team)
        deps.invalidateStatus(ctx)
        return { content: [{ type: 'text', text: `Claimed ${formatTask(task)}` }], details: { task } }
      }

      if (params.action === 'update') {
        const role = actorRole(team, actor)
        if (role === 'planner' && params.status === 'completed') {
          return {
            content: [{ type: 'text', text: `Planner should close ${task.id} via agentteam_task action=complete (not update status=completed) so completion notes remain explicit.` }],
            details: { denied: true, action: 'update', status: 'completed', actor },
          }
        }

        if (params.title) task.title = params.title
        if (params.description) task.description = params.description
        if (params.owner !== undefined) {
          const owner = deps.normalizeOwnerName(params.owner)
          if (!owner) {
            task.owner = undefined
          } else {
            deps.assertValidOwner(team, owner)
            task.owner = owner
          }
        }
        if (params.status) task.status = params.status
        if (params.blockedBy) task.blockedBy = params.blockedBy
        task.updatedAt = Date.now()
        const note = params.note ?? 'Task updated'
        deps.appendStructuredTaskNote(task, actor, note, {
          messageType: task.status === 'blocked' ? 'blocked' : 'fyi',
          threadId: defaultThreadIdForTask(task.id),
        })

        if (task.status === 'blocked' && actor !== TEAM_LEAD) {
          const blockedMessage = pushMailboxMessage(team.name, TEAM_LEAD, {
            from: actor,
            to: TEAM_LEAD,
            text: `${task.id} is blocked. ${note}`,
            summary: `${task.id} blocked`,
            type: 'blocked',
            taskId: task.id,
            threadId: defaultThreadIdForTask(task.id),
            priority: 'high',
            wakeHint: 'hard',
            metadata: {
              blockedBy: task.blockedBy,
            },
          })
          deps.maybeLinkTaskNoteToMessage(task, actor, {
            text: `${task.id} is blocked. ${note}`,
            type: 'blocked',
            taskId: task.id,
            threadId: defaultThreadIdForTask(task.id),
            metadata: {
              blockedBy: task.blockedBy,
              linkedMailboxMessageId: blockedMessage.id,
              to: TEAM_LEAD,
            },
          })
          await deps.wakeLeaderIfNeeded(team, {
            type: 'blocked',
            wakeHint: 'hard',
            from: actor,
            summary: `${task.id} blocked`,
            text: `${task.id} is blocked. ${note}`,
          })
        }

        writeTeamState(team)
        if (
          task.owner &&
          task.owner !== TEAM_LEAD &&
          team.members[task.owner] &&
          team.members[task.owner]!.status !== 'running'
        ) {
          await deps.wakeWorker(team, task.owner)
        }
        deps.invalidateStatus(ctx)
        return { content: [{ type: 'text', text: `Updated ${formatTask(task)}` }], details: { task } }
      }

      if (params.action === 'note') {
        deps.appendStructuredTaskNote(task, actor, params.note ?? 'Note added', {
          messageType: 'fyi',
          threadId: defaultThreadIdForTask(task.id),
        })
        if (actor !== TEAM_LEAD) {
          const noteSummary = `${task.id} note from ${actor}`
          const noteText = `${task.id} note by ${actor}: ${params.note ?? 'Note added'}`
          const noteMessage = pushMailboxMessage(team.name, TEAM_LEAD, {
            from: actor,
            to: TEAM_LEAD,
            text: noteText,
            summary: noteSummary,
            type: 'fyi',
            taskId: task.id,
            threadId: defaultThreadIdForTask(task.id),
            priority: 'normal',
            wakeHint: 'soft',
          })
          deps.maybeLinkTaskNoteToMessage(task, actor, {
            text: noteText,
            type: 'fyi',
            taskId: task.id,
            threadId: defaultThreadIdForTask(task.id),
            metadata: {
              linkedMailboxMessageId: noteMessage.id,
              to: TEAM_LEAD,
            },
          })
          await deps.wakeLeaderIfNeeded(team, {
            type: 'fyi',
            wakeHint: 'soft',
            from: actor,
            summary: noteSummary,
            text: noteText,
          })
        }
        writeTeamState(team)
        deps.invalidateStatus(ctx)
        return { content: [{ type: 'text', text: `Noted on ${task.id}` }], details: { task } }
      }

      if (params.action === 'complete') {
        if (actor !== task.owner && !isLeader(actor)) {
          throw new Error(`Only owner ${task.owner ?? '(none)'} or ${TEAM_LEAD} can complete ${task.id}`)
        }
        const role = actorRole(team, actor)

        task.status = 'completed'
        task.updatedAt = Date.now()
        const note = role === 'implementer'
          ? buildImplementationCompletionNote(params.note)
          : (params.note ?? 'Task completed')
        deps.appendStructuredTaskNote(task, actor, note, {
          messageType: 'completion_report',
          threadId: defaultThreadIdForTask(task.id),
        })
        if (actor !== TEAM_LEAD) {
          const completionMessage = pushMailboxMessage(team.name, TEAM_LEAD, {
            from: actor,
            to: TEAM_LEAD,
            text: `${task.id} completed by ${actor}: ${task.title}\n\n${note}`,
            summary: `${task.id} completed`,
            type: 'completion_report',
            taskId: task.id,
            threadId: defaultThreadIdForTask(task.id),
            priority: 'normal',
            wakeHint: 'hard',
          })
          deps.maybeLinkTaskNoteToMessage(task, actor, {
            text: `${task.id} completed by ${actor}: ${task.title}`,
            type: 'completion_report',
            taskId: task.id,
            threadId: defaultThreadIdForTask(task.id),
            metadata: {
              linkedMailboxMessageId: completionMessage.id,
              to: TEAM_LEAD,
            },
          })
          await deps.wakeLeaderIfNeeded(team, {
            type: 'completion_report',
            wakeHint: 'hard',
            from: actor,
            summary: `${task.id} completed`,
            text: `${task.id} completed by ${actor}: ${task.title}`,
          })
        }
        writeTeamState(team)
        deps.invalidateStatus(ctx)
        return { content: [{ type: 'text', text: `Completed ${formatTask(task)}` }], details: { task } }
      }

      throw new Error(`Unsupported action ${params.action}`)
    },
  })
}
