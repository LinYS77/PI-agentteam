import type {
  TeamEvent,
  TeamMessageType,
  TeamState,
  TeamTask,
  TeamTaskNote,
} from '../types.js'

// ---------------------------------------------------------------------------
// In-memory mutations for tasks, task notes, and bounded team event history.
// Callers remain responsible for persisting the containing TeamState.
// ---------------------------------------------------------------------------

export function createTask(
  state: TeamState,
  input: { title: string; description: string; blockedBy?: string[] },
): TeamTask {
  const now = Date.now()
  const id = `T${String(state.nextTaskSeq).padStart(3, '0')}`
  state.nextTaskSeq += 1
  const task: TeamTask = {
    id,
    title: input.title,
    description: input.description,
    status: input.blockedBy && input.blockedBy.length > 0 ? 'blocked' : 'pending',
    owner: undefined,
    blockedBy: input.blockedBy ?? [],
    notes: [],
    createdAt: now,
    updatedAt: now,
  }
  state.tasks[id] = task
  return task
}

export function appendTaskNote(
  task: TeamTask,
  author: string,
  text: string,
  extra?: {
    threadId?: string
    messageType?: TeamMessageType
    requestId?: string
    linkedMessageId?: string
    metadata?: Record<string, unknown>
  },
): TeamTaskNote {
  const note: TeamTaskNote = {
    at: Date.now(),
    author,
    text,
    threadId: extra?.threadId,
    messageType: extra?.messageType,
    requestId: extra?.requestId,
    linkedMessageId: extra?.linkedMessageId,
    metadata: extra?.metadata,
  }
  task.notes.push(note)
  task.updatedAt = note.at
  return note
}

const TEAM_EVENT_LIMIT = 300

export function appendTeamEvent(
  team: TeamState,
  input: {
    type: string
    by: string
    text: string
    metadata?: Record<string, unknown>
  },
): TeamEvent {
  const event: TeamEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    type: input.type,
    by: input.by,
    text: input.text,
    metadata: input.metadata,
  }
  const next = [...(team.events ?? []), event]
  team.events = next.length > TEAM_EVENT_LIMIT ? next.slice(next.length - TEAM_EVENT_LIMIT) : next
  return event
}
