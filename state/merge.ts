import type {
  TeamEvent,
  TeamState,
  TeamTask,
  TeamTaskNote,
} from '../types.js'
import { TEAM_LEAD } from '../types.js'

// ---------------------------------------------------------------------------
// Merge policy for concurrent/stale team-state writers.
// ---------------------------------------------------------------------------

export function normalizeTeamState(state: TeamState): TeamState {
  return {
    ...state,
    revision: Number.isFinite(state.revision) ? Number(state.revision) : 0,
    memberTombstones: { ...(state.memberTombstones ?? {}) },
    events: [...(state.events ?? [])],
  }
}

function pickLatestEntity<T extends { updatedAt: number }>(
  current: T | undefined,
  incoming: T | undefined,
  options?: {
    currentRevision?: number
    incomingRevision?: number
    mergeEqual?: (currentEntity: T, incomingEntity: T) => T
  },
): T | undefined {
  if (!current) return incoming
  if (!incoming) return current
  if (incoming.updatedAt > current.updatedAt) return incoming
  if (current.updatedAt > incoming.updatedAt) return current

  const currentRevision = options?.currentRevision ?? 0
  const incomingRevision = options?.incomingRevision ?? 0
  if (incomingRevision > currentRevision) return incoming
  if (currentRevision > incomingRevision) return current

  return options?.mergeEqual ? options.mergeEqual(current, incoming) : incoming
}

function taskNoteFingerprint(note: TeamTaskNote): string {
  return [
    note.at,
    note.author,
    note.text,
    note.threadId ?? '',
    note.messageType ?? '',
    note.requestId ?? '',
    note.linkedMessageId ?? '',
  ].join('|')
}

export function mergeTaskNotes(currentNotes: TeamTaskNote[], incomingNotes: TeamTaskNote[]): TeamTaskNote[] {
  const seen = new Set<string>()
  const merged: TeamTaskNote[] = []
  const ordered = [...currentNotes, ...incomingNotes]
    .slice()
    .sort((a, b) => a.at - b.at || a.author.localeCompare(b.author) || a.text.localeCompare(b.text))

  for (const note of ordered) {
    const key = taskNoteFingerprint(note)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(note)
  }
  return merged
}

function mergeTaskStates(currentTask: TeamTask, incomingTask: TeamTask): TeamTask {
  return {
    ...currentTask,
    ...incomingTask,
    notes: mergeTaskNotes(currentTask.notes, incomingTask.notes),
    updatedAt: Math.max(currentTask.updatedAt, incomingTask.updatedAt),
  }
}

export function mergeTeamEvents(currentEvents: TeamEvent[], incomingEvents: TeamEvent[]): TeamEvent[] {
  const byId = new Map<string, TeamEvent>()
  for (const event of [...currentEvents, ...incomingEvents]) {
    const existing = byId.get(event.id)
    if (!existing || event.at >= existing.at) {
      byId.set(event.id, event)
    }
  }
  return [...byId.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
}

export function mergeTeamStates(current: TeamState, incoming: TeamState): TeamState {
  const currentState = normalizeTeamState(current)
  const incomingState = normalizeTeamState(incoming)

  const tombstones: Record<string, number> = { ...currentState.memberTombstones }
  for (const [name, at] of Object.entries(incomingState.memberTombstones)) {
    const existing = tombstones[name]
    if (existing === undefined || at > existing) {
      tombstones[name] = at
    }
  }

  const members: TeamState['members'] = {}
  const memberNames = new Set([
    ...Object.keys(currentState.members),
    ...Object.keys(incomingState.members),
  ])
  for (const name of memberNames) {
    const chosen = pickLatestEntity(currentState.members[name], incomingState.members[name], {
      currentRevision: currentState.revision,
      incomingRevision: incomingState.revision,
    })
    if (!chosen) continue
    const removedAt = tombstones[name]
    if (removedAt !== undefined && chosen.updatedAt <= removedAt) continue
    members[name] = chosen
  }

  const tasks: TeamState['tasks'] = {}
  const taskIds = new Set([
    ...Object.keys(currentState.tasks),
    ...Object.keys(incomingState.tasks),
  ])
  for (const taskId of taskIds) {
    const chosen = pickLatestEntity(
      currentState.tasks[taskId],
      incomingState.tasks[taskId],
      {
        currentRevision: currentState.revision,
        incomingRevision: incomingState.revision,
        mergeEqual: mergeTaskStates,
      },
    )
    if (chosen) tasks[taskId] = chosen
  }

  const merged: TeamState = {
    ...currentState,
    ...incomingState,
    name: incomingState.name,
    description: incomingState.description ?? currentState.description,
    createdAt: Math.min(currentState.createdAt, incomingState.createdAt),
    leaderSessionFile: incomingState.leaderSessionFile ?? currentState.leaderSessionFile,
    leaderCwd: incomingState.leaderCwd || currentState.leaderCwd,
    members,
    tasks,
    events: mergeTeamEvents(currentState.events ?? [], incomingState.events ?? []),
    nextTaskSeq: Math.max(currentState.nextTaskSeq, incomingState.nextTaskSeq),
    revision: Math.max(currentState.revision ?? 0, incomingState.revision ?? 0) + 1,
    memberTombstones: tombstones,
  }

  delete merged.memberTombstones?.[TEAM_LEAD]

  if (!merged.members[TEAM_LEAD]) {
    merged.members[TEAM_LEAD] = {
      name: TEAM_LEAD,
      role: 'leader',
      cwd: merged.leaderCwd,
      sessionFile: merged.leaderSessionFile ?? '',
      status: 'idle',
      createdAt: merged.createdAt,
      updatedAt: Date.now(),
    }
  }

  return merged
}
