import * as fs from 'node:fs'
import type { SessionTeamContext, TeamState } from '../types.js'
import { TEAM_LEAD } from '../types.js'
import { readJsonFile, writeJsonFile } from './fsStore.js'
import { getSessionContextPath } from './paths.js'

export type TeamStateReader = (teamName: string) => TeamState | null
export type TeamLister = () => TeamState[]

// ---------------------------------------------------------------------------
// Session <-> team/member binding cache and repair logic.
// This module is dependency-injected with team readers to avoid a circular
// import between session binding and the team store facade.
// ---------------------------------------------------------------------------

let readTeamStateRef: TeamStateReader | null = null
let listTeamsRef: TeamLister | null = null

export function configureSessionBindingStore(input: {
  readTeamState: TeamStateReader
  listTeams: TeamLister
}): void {
  readTeamStateRef = input.readTeamState
  listTeamsRef = input.listTeams
}

function readTeamState(teamName: string): TeamState | null {
  if (!readTeamStateRef) {
    throw new Error('session binding store not configured: readTeamState missing')
  }
  return readTeamStateRef(teamName)
}

function listTeams(): TeamState[] {
  if (!listTeamsRef) {
    throw new Error('session binding store not configured: listTeams missing')
  }
  return listTeamsRef()
}

export function readSessionContext(sessionFile: string): SessionTeamContext {
  return (
    readJsonFile<SessionTeamContext>(getSessionContextPath(sessionFile)) ?? {
      teamName: null,
      memberName: null,
    }
  )
}

export function writeSessionContext(
  sessionFile: string,
  context: SessionTeamContext,
): void {
  writeJsonFile(getSessionContextPath(sessionFile), context)
  invalidateSessionContextCache(sessionFile)
}

export function clearSessionContext(sessionFile: string): void {
  const p = getSessionContextPath(sessionFile)
  try {
    fs.rmSync(p, { force: true })
  } catch {
    // ignore
  }
  invalidateSessionContextCache(sessionFile)
}

function matchesSessionBinding(
  team: TeamState,
  sessionFile: string,
  memberName: string,
): boolean {
  if (memberName === TEAM_LEAD) {
    return (
      team.leaderSessionFile === sessionFile ||
      team.members[TEAM_LEAD]?.sessionFile === sessionFile
    )
  }
  return team.members[memberName]?.sessionFile === sessionFile
}

function isSessionContextValid(
  sessionFile: string,
  context: SessionTeamContext,
): boolean {
  if (!context.teamName || !context.memberName) return false
  const team = readTeamState(context.teamName)
  if (!team) return false
  return matchesSessionBinding(team, sessionFile, context.memberName)
}

function findSessionBinding(sessionFile: string): SessionTeamContext {
  const matches: Array<{
    teamName: string
    memberName: string
    priority: number
    createdAt: number
  }> = []

  for (const team of listTeams()) {
    if (matchesSessionBinding(team, sessionFile, TEAM_LEAD)) {
      matches.push({
        teamName: team.name,
        memberName: TEAM_LEAD,
        priority: 2,
        createdAt: team.createdAt,
      })
    }
    for (const member of Object.values(team.members)) {
      if (member.name === TEAM_LEAD) continue
      if (member.sessionFile !== sessionFile) continue
      matches.push({
        teamName: team.name,
        memberName: member.name,
        priority: 1,
        createdAt: member.createdAt,
      })
    }
  }

  matches.sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt)
  const match = matches[0]
  if (!match) {
    return { teamName: null, memberName: null }
  }
  return {
    teamName: match.teamName,
    memberName: match.memberName,
  }
}

const SESSION_CACHE_TTL_MS = 2000
const sessionContextCache = new Map<string, {
  result: { context: SessionTeamContext; source: 'cached' | 'derived' | 'cleared' | 'none' }
  at: number
}>()

export function invalidateSessionContextCache(sessionFile?: string): void {
  if (sessionFile) {
    sessionContextCache.delete(sessionFile)
  } else {
    sessionContextCache.clear()
  }
}

export function ensureAttachedSessionContext(
  sessionFile: string,
): { context: SessionTeamContext; source: 'cached' | 'derived' | 'cleared' | 'none' } {
  const now = Date.now()
  const hit = sessionContextCache.get(sessionFile)
  if (hit && now - hit.at < SESSION_CACHE_TTL_MS) {
    return hit.result
  }

  const cached = readSessionContext(sessionFile)
  if (isSessionContextValid(sessionFile, cached)) {
    const result = { context: cached, source: 'cached' as const }
    sessionContextCache.set(sessionFile, { result, at: now })
    return result
  }

  const derived = findSessionBinding(sessionFile)
  if (derived.teamName && derived.memberName) {
    writeSessionContext(sessionFile, derived)
    const result = { context: derived, source: 'derived' as const }
    sessionContextCache.set(sessionFile, { result, at: now })
    return result
  }

  clearSessionContext(sessionFile)
  const result = {
    context: { teamName: null, memberName: null } as SessionTeamContext,
    source: (cached.teamName || cached.memberName ? 'cleared' : 'none') as 'cleared' | 'none',
  }
  sessionContextCache.set(sessionFile, { result, at: now })
  return result
}
