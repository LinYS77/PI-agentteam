import * as fs from 'node:fs'
import * as path from 'node:path'
import type { TeamMember, TeamState } from '../types.js'
import { TEAM_LEAD } from '../types.js'
import { readJsonFile, writeJsonFile, withFileLock } from './fsStore.js'
import {
  getTeamDir,
  getTeamsDir,
  getTeamStatePath,
  getWorkerSessionsDir,
  sanitizeName,
} from './paths.js'
import { mergeTeamStates, normalizeTeamState } from './merge.js'
import { clearSessionContext } from './sessionBinding.js'

// ---------------------------------------------------------------------------
// Team state persistence and in-memory member mutations.
// Public callers should prefer updateTeamState() for read-modify-write paths.
// writeTeamState() is retained for backwards-compatible stale-writer merging.
// ---------------------------------------------------------------------------

export function createInitialTeamState(input: {
  teamName: string
  description?: string
  leaderSessionFile?: string
  leaderCwd: string
}): TeamState {
  const now = Date.now()
  const teamName = sanitizeName(input.teamName)
  const leader: TeamMember = {
    name: TEAM_LEAD,
    role: 'leader',
    cwd: input.leaderCwd,
    sessionFile: input.leaderSessionFile ?? '',
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  }
  return {
    version: 1,
    name: teamName,
    description: input.description,
    createdAt: now,
    leaderSessionFile: input.leaderSessionFile,
    leaderCwd: input.leaderCwd,
    members: {
      [TEAM_LEAD]: leader,
    },
    tasks: {},
    events: [],
    nextTaskSeq: 1,
    revision: 0,
    memberTombstones: {},
  }
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function teamContentKey(state: TeamState): string {
  const normalized = normalizeTeamState(state)
  const { revision: _revision, ...content } = normalized
  return stableSerialize(content)
}

function cloneTeamState(state: TeamState): TeamState {
  return normalizeTeamState(JSON.parse(JSON.stringify(state)) as TeamState)
}

function ensureLeaderMemberShape(merged: TeamState): void {
  if (!merged.leaderSessionFile) return

  const existingLeader = merged.members[TEAM_LEAD] ?? {
    name: TEAM_LEAD,
    role: 'leader',
    cwd: merged.leaderCwd,
    sessionFile: merged.leaderSessionFile,
    status: 'idle' as const,
    createdAt: merged.createdAt,
    updatedAt: Date.now(),
  }
  const leaderShapeChanged =
    existingLeader.role !== 'leader' ||
    existingLeader.cwd !== merged.leaderCwd ||
    existingLeader.sessionFile !== merged.leaderSessionFile
  merged.members[TEAM_LEAD] = {
    ...existingLeader,
    name: TEAM_LEAD,
    role: 'leader',
    cwd: merged.leaderCwd,
    sessionFile: merged.leaderSessionFile,
    updatedAt: leaderShapeChanged ? Date.now() : existingLeader.updatedAt,
  }
}

export function readTeamState(teamName: string): TeamState | null {
  const state = readJsonFile<TeamState>(getTeamStatePath(teamName))
  return state ? normalizeTeamState(state) : null
}

export function writeTeamState(state: TeamState): void {
  const statePath = getTeamStatePath(state.name)
  withFileLock(statePath, () => {
    const current = readJsonFile<TeamState>(statePath)
    let merged = normalizeTeamState(state)
    merged = current ? mergeTeamStates(current, merged) : {
      ...merged,
      revision: (merged.revision ?? 0) + 1,
    }

    ensureLeaderMemberShape(merged)
    writeJsonFile(statePath, merged)
    Object.assign(state, merged)
  })
}

export function updateTeamState(
  teamName: string,
  updater: (team: TeamState) => void | TeamState,
): TeamState | null {
  const statePath = getTeamStatePath(teamName)
  return withFileLock(statePath, () => {
    const current = readJsonFile<TeamState>(statePath)
    if (!current) return null

    const normalizedCurrent = normalizeTeamState(current)
    let next = cloneTeamState(normalizedCurrent)
    const replacement = updater(next)
    if (replacement) next = replacement
    next = normalizeTeamState(next)
    ensureLeaderMemberShape(next)

    if (teamContentKey(next) === teamContentKey(normalizedCurrent)) {
      return normalizedCurrent
    }

    next.revision = (normalizedCurrent.revision ?? 0) + 1
    writeJsonFile(statePath, next)
    return next
  })
}

export function listTeams(): TeamState[] {
  const dir = getTeamsDir()
  const results: TeamState[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const state = readTeamState(entry.name)
    if (state) results.push(state)
  }
  results.sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name))
  return results
}

export function upsertMember(
  state: TeamState,
  member: Omit<TeamMember, 'createdAt' | 'updatedAt'>,
): TeamState {
  const now = Date.now()
  const existing = state.members[member.name]
  state.members[member.name] = {
    ...member,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  if (state.memberTombstones) {
    delete state.memberTombstones[member.name]
  }
  return state
}

export function updateMemberStatus(
  state: TeamState,
  memberName: string,
  patch: Partial<Pick<TeamMember, 'status' | 'lastWakeReason' | 'lastError' | 'cwd' | 'bootPrompt'>>,
): TeamState {
  const existing = state.members[memberName]
  if (!existing) return state
  const changed = Object.entries(patch).some(
    ([key, value]) => existing[key as keyof typeof existing] !== value,
  )
  if (!changed) return state
  state.members[memberName] = {
    ...existing,
    ...patch,
    updatedAt: Date.now(),
  }
  return state
}

export function removeMember(state: TeamState, memberName: string): TeamState {
  const removedAt = Date.now()
  delete state.members[memberName]
  state.memberTombstones = {
    ...(state.memberTombstones ?? {}),
    [memberName]: removedAt,
  }
  for (const task of Object.values(state.tasks)) {
    if (task.owner === memberName && task.status !== 'completed') {
      task.owner = undefined
      task.status = 'pending'
      task.updatedAt = removedAt
      task.notes.push({
        at: removedAt,
        author: TEAM_LEAD,
        text: `Owner ${memberName} removed from team; task returned to pending`,
      })
    }
  }
  return state
}

export function deleteTeamState(teamName: string): void {
  const team = readTeamState(teamName)
  if (team) {
    for (const member of Object.values(team.members)) {
      if (member.sessionFile) {
        clearSessionContext(member.sessionFile)
        if (member.name !== TEAM_LEAD) {
          try {
            fs.rmSync(member.sessionFile, { force: true })
          } catch {
            // ignore
          }
        }
      }
    }
    if (team.leaderSessionFile) clearSessionContext(team.leaderSessionFile)
  }

  for (const dir of [getWorkerSessionsDir()]) {
    try {
      for (const entry of fs.readdirSync(dir)) {
        if (!entry.startsWith(`${sanitizeName(teamName)}-`)) continue
        fs.rmSync(path.join(dir, entry), { recursive: true, force: true })
      }
    } catch {
      // ignore
    }
  }

  try {
    fs.rmSync(getTeamDir(teamName), { recursive: true, force: true })
  } catch {
    // ignore
  }
}
