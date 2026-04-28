import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent'
import {
  attachCurrentSessionIfNeeded,
  buildSessionStatusKey,
  deliverLeaderMailbox,
  refreshForSession,
} from './runtime.js'

export type RuntimeHookState = {
  lastLeaderDigestKey: string
  lastLeaderDigestAt: number
  lastBlockedCountForDigest: number
  lastBlockedFingerprintsForDigest: string[]
}

type RuntimeService = {
  hookState: RuntimeHookState
  updateDigestState: (patch: Partial<RuntimeHookState>) => void
  attachCurrentSessionIfNeeded: typeof attachCurrentSessionIfNeeded
  invalidateStatus: (ctx: ExtensionContext) => void
  runMailboxSync: (ctx: ExtensionContext) => void
  resetMailboxSyncKey: () => void
}

export function createRuntimeService(pi: ExtensionAPI): RuntimeService {
  const projectedMailboxIds = new Set<string>()
  let lastStatusKey = ''

  const hookState: RuntimeHookState = {
    lastLeaderDigestKey: '',
    lastLeaderDigestAt: 0,
    lastBlockedCountForDigest: 0,
    lastBlockedFingerprintsForDigest: [],
  }

  function updateDigestState(patch: Partial<RuntimeHookState>): void {
    Object.assign(hookState, patch)
  }

  function runStatusRefresh(ctx: ExtensionContext): void {
    const attached = attachCurrentSessionIfNeeded(ctx)
    const statusKey = buildSessionStatusKey(ctx, attached)
    if (statusKey === lastStatusKey) return
    lastStatusKey = statusKey
    refreshForSession(ctx, attached)
  }

  function invalidateStatus(ctx: ExtensionContext): void {
    lastStatusKey = ''
    runStatusRefresh(ctx)
  }

  function runMailboxSync(ctx: ExtensionContext): void {
    const unread = deliverLeaderMailbox(ctx)
    const pendingProjection = unread.filter(item => !projectedMailboxIds.has(`${item.teamName}:${item.id}`))
    if (pendingProjection.length === 0) return
    for (const item of pendingProjection) {
      try {
        pi.sendMessage(
          {
            customType: 'agentteam-mailbox',
            content: item.text,
            display: true,
            details: item,
          },
          {
            // Always queue safely if agent is currently streaming.
            deliverAs: 'followUp',
          },
        )
      } catch {
        // Best-effort transcript projection only.
      }
      projectedMailboxIds.add(`${item.teamName}:${item.id}`)
    }
    ctx.ui.notify(`agentteam: ${pendingProjection.length} new teammate message(s)`, 'info')
  }

  function resetMailboxSyncKey(): void {
    projectedMailboxIds.clear()
  }

  return {
    hookState,
    updateDigestState,
    attachCurrentSessionIfNeeded,
    invalidateStatus,
    runMailboxSync,
    resetMailboxSyncKey,
  }
}
