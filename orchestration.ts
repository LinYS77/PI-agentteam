import { TEAM_LEAD } from './types.js'
import { readMailbox } from './state.js'
import type {
  MailboxMessage,
  TeamState,
  TeamTask,
} from './types.js'

export type ContextMessage = { role: string; content: unknown }

function blockedTasks(team: TeamState): TeamTask[] {
  return Object.values(team.tasks)
    .filter(task => task.status === 'blocked')
    .sort((a, b) => a.id.localeCompare(b.id))
}

function unreadLeaderMailbox(team: TeamState): MailboxMessage[] {
  return readMailbox(team.name, TEAM_LEAD)
    .filter(message => !message.readAt)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
}

export type LeaderCoordinationSnapshot = {
  blockedCount: number
  unreadCount: number
  latestUnreadMessageId: string
}

export function buildLeaderCoordinationSnapshot(team: TeamState): LeaderCoordinationSnapshot {
  const blocked = blockedTasks(team)
  const unread = unreadLeaderMailbox(team)
  return {
    blockedCount: blocked.length,
    unreadCount: unread.length,
    latestUnreadMessageId: unread[0]?.id ?? '',
  }
}

function buildLeaderDigest(team: TeamState, snapshot: LeaderCoordinationSnapshot): string {
  const latestLine = snapshot.latestUnreadMessageId
    ? `Latest unread message id: ${snapshot.latestUnreadMessageId}`
    : 'Latest unread message id: none'
  return [
    `Leader coordination digest for team ${team.name}:`,
    `- blocked task count: ${snapshot.blockedCount}`,
    `- unread leader mailbox count: ${snapshot.unreadCount}`,
    `- ${latestLine}`,
  ].join('\n')
}

function messageContainsMarker(message: ContextMessage, marker: string): boolean {
  if (message.role !== 'user') return false
  const content = message.content
  if (typeof content === 'string') {
    return content.includes(marker)
  }
  if (!Array.isArray(content)) return false
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue
    const text = (part as { text?: unknown }).text
    if (typeof text === 'string' && text.includes(marker)) {
      return true
    }
  }
  return false
}

export function computeLeaderDigestKey(
  team: TeamState,
  coordination?: LeaderCoordinationSnapshot,
): string {
  const snapshot = coordination ?? buildLeaderCoordinationSnapshot(team)
  return `${team.name}|blocked:${snapshot.blockedCount}|unread:${snapshot.unreadCount}|latest:${snapshot.latestUnreadMessageId}`
}

function computeBlockedDeltaSummary(team: TeamState): {
  blockedCount: number
  blockedFingerprints: string[]
  summary: string
} {
  const blocked = blockedTasks(team)
  return {
    blockedCount: blocked.length,
    blockedFingerprints: blocked.map(task => task.id),
    summary: blocked.length > 0 ? `Blocked tasks: ${blocked.length}` : 'No blocked tasks right now.',
  }
}

export function maybeInjectLeaderOrchestrationContext(
  event: { messages: ContextMessage[] },
  input: {
    team: TeamState | null
    memberName: string | null
    state: {
      lastDigestKey: string
      lastDigestAt: number
      lastBlockedCount: number
      lastBlockedFingerprints: string[]
    }
  },
): {
  injected?: { messages: ContextMessage[] }
  digestKey: string
  digestAt: number
  blockedCount: number
  blockedFingerprints: string[]
} {
  const { team, memberName, state } = input
  if (!team || memberName !== TEAM_LEAD) {
    return {
      digestKey: state.lastDigestKey,
      digestAt: state.lastDigestAt,
      blockedCount: state.lastBlockedCount,
      blockedFingerprints: state.lastBlockedFingerprints,
    }
  }

  const marker = '[agentteam-orchestration-digest]'
  const alreadyPresent = event.messages.some(message => messageContainsMarker(message, marker))
  const coordination = buildLeaderCoordinationSnapshot(team)
  const digestKey = computeLeaderDigestKey(team, coordination)
  const blocked = computeBlockedDeltaSummary(team)
  const now = Date.now()

  const hasActionableWork = coordination.blockedCount > 0 || coordination.unreadCount > 0
  const MIN_DIGEST_INTERVAL_MS = hasActionableWork ? 2000 : 15 * 60 * 1000
  const shouldInject =
    !alreadyPresent &&
    (digestKey !== state.lastDigestKey || now - state.lastDigestAt >= MIN_DIGEST_INTERVAL_MS)

  if (!shouldInject) {
    return {
      digestKey: state.lastDigestKey,
      digestAt: state.lastDigestAt,
      blockedCount: state.lastBlockedCount,
      blockedFingerprints: state.lastBlockedFingerprints,
    }
  }

  const digest = buildLeaderDigest(team, coordination)
  return {
    injected: {
      messages: [
        ...event.messages,
        {
          role: 'user',
          content: `${marker}\n${digest}`,
        },
      ],
    },
    digestKey,
    digestAt: now,
    blockedCount: blocked.blockedCount,
    blockedFingerprints: blocked.blockedFingerprints,
  }
}
