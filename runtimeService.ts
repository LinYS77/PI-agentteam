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
  let lastMailboxKey = ''
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
    const syncKey = unread.map(item => item.id).join(',')
    if (syncKey.length === 0 || syncKey === lastMailboxKey) return
    lastMailboxKey = syncKey
    if (unread.length > 0) {
      for (const item of unread) {
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
      }
      ctx.ui.notify(`agentteam: ${unread.length} new teammate message(s)`, 'info')
      // Push a lightweight leader wake signal so leader reacts without waiting for manual prompt.
      try {
        pi.sendMessage(
          {
            customType: 'agentteam-mailbox-signal',
            content: `[agentteam-mailbox-signal] ${unread.length} new teammate message(s). Triage mailbox now and continue coordination.`,
            display: false,
            details: { unreadCount: unread.length },
          },
          {
            // steer works in both states: immediate turn when idle, queued when streaming.
            triggerTurn: true,
            deliverAs: 'steer',
          },
        )
      } catch {
        // Gracefully ignore if the runtime does not support queued trigger messaging.
      }
    }
  }

  function resetMailboxSyncKey(): void {
    lastMailboxKey = ''
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
