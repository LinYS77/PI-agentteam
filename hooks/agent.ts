import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent'
import {
  markWorkerAgentIdleAfterTurn,
  markWorkerAgentRunning,
} from './lifecycleService.js'

type AgentHookDeps = {
  cancelPendingNudge: (memberName: string) => void
  runMailboxSync: (ctx: ExtensionContext) => void
  refreshStatus: (ctx: ExtensionContext) => void
}

export function registerAgentHooks(pi: ExtensionAPI, deps: AgentHookDeps): void {
  pi.on('agent_start', async (_event, ctx) => {
    const memberName = markWorkerAgentRunning(ctx)
    if (!memberName) return

    deps.cancelPendingNudge(memberName)
    deps.refreshStatus(ctx)
  })

  pi.on('agent_end', async (_event, ctx) => {
    markWorkerAgentIdleAfterTurn(ctx)
    deps.runMailboxSync(ctx)
    deps.refreshStatus(ctx)
  })
}
