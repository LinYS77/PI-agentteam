import type { ExtensionContext } from '@mariozechner/pi-coding-agent'
import { maybeInjectLeaderOrchestrationContext } from '../orchestration.js'
import { readTeamState } from '../state.js'
import { getCurrentMemberName, getCurrentTeamName } from '../session.js'
import { TEAM_LEAD } from '../types.js'
import type { HookDigestState, HookDigestPatch } from './lifecycleService.js'
import { updateHookDigestState } from './lifecycleService.js'

const TEAM_INPUT_TRIGGER_RE = /\bagentteam\b|\bagent\s*team\b|\bteammate\b|\bsubagent\b|\bagentteam_(?:create|spawn|send|receive|task)\b|队友|队员/i
const TEAM_COMMAND_RE = /^\/team\b/i

export function shouldSyncMailboxOnInput(event: { source?: string; text?: unknown }): boolean {
  if (event.source !== 'interactive') return false
  const text = String(event.text ?? '').trim()
  if (!text) return false
  if (text.startsWith('/')) {
    return TEAM_COMMAND_RE.test(text)
  }
  return TEAM_INPUT_TRIGGER_RE.test(text)
}

export function injectLeaderContextAndUpdateDigest(
  event: { messages: { role: string; content: unknown }[] },
  deps: {
    state: HookDigestState
    updateDigestState?: (patch: HookDigestPatch) => void
  },
  ctx: ExtensionContext,
): boolean {
  const teamName = getCurrentTeamName(ctx)
  const memberName = getCurrentMemberName(ctx)
  const team = teamName ? readTeamState(teamName) : null

  const injected = maybeInjectLeaderOrchestrationContext(event, {
    team,
    memberName,
    state: {
      lastDigestKey: deps.state.lastLeaderDigestKey,
      lastDigestAt: deps.state.lastLeaderDigestAt,
      lastBlockedCount: deps.state.lastBlockedCountForDigest,
      lastBlockedFingerprints: deps.state.lastBlockedFingerprintsForDigest,
    },
  })

  updateHookDigestState(deps, {
    lastLeaderDigestKey: injected.digestKey,
    lastLeaderDigestAt: injected.digestAt,
    lastBlockedCountForDigest: injected.blockedCount,
    lastBlockedFingerprintsForDigest: injected.blockedFingerprints,
  })

  return injected.injected
}

export function syncLeaderMailboxForInputIfNeeded(
  event: { source?: string; text?: unknown },
  ctx: ExtensionContext,
  deps: {
    runMailboxSync: (ctx: ExtensionContext) => void
    refreshStatus: (ctx: ExtensionContext) => void
  },
): void {
  if (!shouldSyncMailboxOnInput(event)) return
  const teamName = getCurrentTeamName(ctx)
  const memberName = getCurrentMemberName(ctx)
  if (!teamName || memberName !== TEAM_LEAD) return
  deps.runMailboxSync(ctx)
  deps.refreshStatus(ctx)
}
