import type { ExtensionContext } from '@mariozechner/pi-coding-agent'
import type {
  TeamMessageType,
  TeamState,
  TeamTask,
} from '../types.js'

type AppendStructuredTaskNote = (
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
) => void

type MaybeLinkTaskNoteToMessage = (
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
) => void

export type WakeOutcome = {
  ok: boolean
  recipient: string
  reason: string
  error?: string
  prompt?: string
  wakeHint?: 'none' | 'soft' | 'hard'
  nudgeScheduled?: boolean
}

export type ToolHandlerDeps = {
  sanitizeTeamName: (name: string) => string
  sanitizeWorkerName: (name: string) => string
  normalizeOwnerName: (name: string) => string
  assertValidOwner: (team: TeamState, owner: string) => void
  classifySpawnTask: (task?: string) => { initialTask?: string; bootPrompt?: string }
  ensureTeamForSession: (ctx: ExtensionContext) => TeamState | null
  currentActor: (ctx: ExtensionContext) => string
  healMemberPaneBinding: (member: TeamState['members'][string]) => void
  wakeWorker: (team: TeamState, memberName: string, explicitTask?: string) => Promise<WakeOutcome>
  wakeLeaderIfNeeded: (
    team: TeamState,
    message: {
      type?: TeamMessageType
      wakeHint?: 'none' | 'soft' | 'hard'
      from?: string
      summary?: string
      text?: string
    },
  ) => Promise<WakeOutcome>
  appendStructuredTaskNote: AppendStructuredTaskNote
  maybeLinkTaskNoteToMessage: MaybeLinkTaskNoteToMessage
  invalidateStatus: (ctx: ExtensionContext) => void
}

export function formatTask(task: TeamTask): string {
  const owner = task.owner ? ` @${task.owner}` : ''
  const blocked = task.blockedBy.length > 0 ? ` blockedBy=${task.blockedBy.join(',')}` : ''
  return `${task.id} [${task.status}] ${task.title}${owner}${blocked}`
}
