import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { registerSessionHooks } from './hooks/session.js'
import { registerContextHooks } from './hooks/context.js'
import { registerAgentHooks } from './hooks/agent.js'
import { registerToolGuardHooks } from './hooks/toolGuard.js'
import { registerAgentTeamCommands } from './commands.js'
import { registerAgentTeamTools } from './tools.js'
import {
  appendStructuredTaskNote,
  assertValidOwner,
  cancelPendingNudge,
  classifySpawnTask,
  currentActor,
  deleteTeamRuntime,
  ensureTeamForSession,
  healMemberPaneBinding,
  maybeLinkTaskNoteToMessage,
  normalizeOwnerName,
  sanitizeTeamName,
  sanitizeWorkerName,
  wakeLeaderIfNeeded,
  wakeWorker,
} from './runtime.js'
import { createRuntimeService } from './runtimeService.js'
import { registerBeforeAgentStartPolicy } from './policy.js'
import { registerAgentTeamRenderers } from './renderers.js'

export default function agentTeamExtension(pi: ExtensionAPI): void {
  registerBeforeAgentStartPolicy(pi)
  registerAgentTeamRenderers(pi)
  registerToolGuardHooks(pi)

  const runtime = createRuntimeService(pi)

  registerSessionHooks(pi, {
    state: runtime.hookState,
    updateDigestState: runtime.updateDigestState,
    attachCurrentSessionIfNeeded: runtime.attachCurrentSessionIfNeeded,
    invalidateStatus: runtime.invalidateStatus,
    runMailboxSync: runtime.runMailboxSync,
  })

  registerContextHooks(pi, {
    state: runtime.hookState,
    updateDigestState: runtime.updateDigestState,
    invalidateStatus: runtime.invalidateStatus,
    runMailboxSync: runtime.runMailboxSync,
  })

  registerAgentHooks(pi, {
    cancelPendingNudge,
    resetMailboxSyncKey: runtime.resetMailboxSyncKey,
    runMailboxSync: runtime.runMailboxSync,
    invalidateStatus: runtime.invalidateStatus,
  })

  registerAgentTeamCommands(pi, {
    sanitizeWorkerName,
    ensureTeamForSession,
    deleteTeamRuntime,
    invalidateStatus: runtime.invalidateStatus,
    resetMailboxSyncKey: runtime.resetMailboxSyncKey,
    runMailboxSync: runtime.runMailboxSync,
  })

  registerAgentTeamTools(pi, {
    sanitizeTeamName,
    sanitizeWorkerName,
    normalizeOwnerName,
    assertValidOwner,
    classifySpawnTask,
    ensureTeamForSession,
    currentActor,
    healMemberPaneBinding,
    wakeWorker,
    wakeLeaderIfNeeded,
    appendStructuredTaskNote,
    maybeLinkTaskNoteToMessage,
    invalidateStatus: runtime.invalidateStatus,
  })
}
