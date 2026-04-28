import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent'
import type { HookDigestPatch, HookDigestState } from './lifecycleService.js'
import {
  injectLeaderContextAndUpdateDigest,
  syncLeaderMailboxForInputIfNeeded,
} from './contextService.js'

export type ContextHookDeps = {
  state: HookDigestState
  updateDigestState?: (patch: HookDigestPatch) => void
  refreshStatus: (ctx: ExtensionContext) => void
  runMailboxSync: (ctx: ExtensionContext) => void
}

export function registerContextHooks(pi: ExtensionAPI, deps: ContextHookDeps): void {
  pi.on('context', async (event, ctx) => {
    return injectLeaderContextAndUpdateDigest(
      event as { messages: { role: string; content: unknown }[] },
      deps,
      ctx,
    )
  })

  pi.on('tool_result', async (_event, ctx) => {
    deps.runMailboxSync(ctx)
    deps.refreshStatus(ctx)
  })

  pi.on('message_end', async (_event, ctx) => {
    deps.runMailboxSync(ctx)
    deps.refreshStatus(ctx)
  })

  pi.on('input', async (event, ctx) => {
    syncLeaderMailboxForInputIfNeeded(event as { source?: string; text?: unknown }, ctx, deps)
  })
}
