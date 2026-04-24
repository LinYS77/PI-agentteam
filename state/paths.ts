import * as path from 'node:path'
import { ensureDir } from './fsStore.js'

// ---------------------------------------------------------------------------
// Path layout helpers for agentteam's on-disk state.
// ---------------------------------------------------------------------------

export function sanitizeName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
}

function getAgentTeamRoot(): string {
  const root = path.join(path.dirname(__filename), 'data')
  ensureDir(root)
  return root
}

export function getTeamsDir(): string {
  const dir = path.join(getAgentTeamRoot(), 'teams')
  ensureDir(dir)
  return dir
}

export function getTeamDir(teamName: string): string {
  const dir = path.join(getTeamsDir(), sanitizeName(teamName))
  ensureDir(dir)
  return dir
}

export function getTeamStatePath(teamName: string): string {
  return path.join(getTeamDir(teamName), 'state.json')
}

export function getMailboxDir(teamName: string): string {
  const dir = path.join(getTeamDir(teamName), 'mailboxes')
  ensureDir(dir)
  return dir
}

export function getMailboxPath(teamName: string, memberName: string): string {
  return path.join(getMailboxDir(teamName), `${sanitizeName(memberName)}.json`)
}

export function getSessionsDir(): string {
  const dir = path.join(getAgentTeamRoot(), 'sessions')
  ensureDir(dir)
  return dir
}

export function getWorkerSessionsDir(): string {
  const dir = path.join(getAgentTeamRoot(), 'worker-sessions')
  ensureDir(dir)
  return dir
}

export function sanitizeSessionFile(sessionFile: string): string {
  return Buffer.from(sessionFile).toString('base64url')
}

export function getSessionContextPath(sessionFile: string): string {
  return path.join(getSessionsDir(), `${sanitizeSessionFile(sessionFile)}.json`)
}
