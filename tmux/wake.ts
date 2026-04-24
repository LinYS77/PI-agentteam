import { setTimeout as sleep } from 'node:timers/promises'
import { runTmuxAsync, runTmuxNoThrow, runTmuxNoThrowAsync } from './client.js'
import { SHELL_COMMANDS } from './core.js'

async function pasteTextToPane(paneId: string, text: string, signal?: AbortSignal): Promise<void> {
  await runTmuxAsync(['set-buffer', '--', text], undefined, signal)
  await runTmuxAsync(['paste-buffer', '-d', '-t', paneId], undefined, signal)
}

export async function sendPromptToPane(paneId: string, text: string, signal?: AbortSignal): Promise<void> {
  await pasteTextToPane(paneId, text, signal)
  await runTmuxAsync(['send-keys', '-t', paneId, 'Enter'], undefined, signal)
}

export function sendEnterToPane(paneId: string): void {
  runTmuxNoThrow(['send-keys', '-t', paneId, 'Enter'])
}

export async function waitForPaneAppStart(
  paneId: string,
  timeoutMs = 15000,
  signal?: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (signal?.aborted) return false
    const current = await runTmuxNoThrowAsync(['display-message', '-p', '-t', paneId, '#{pane_current_command}'], undefined, signal)
    if (current.ok) {
      const command = current.stdout.trim()
      if (command && !SHELL_COMMANDS.has(command)) return true
    }
    const remaining = Math.max(0, deadline - Date.now())
    await sleep(Math.min(200, remaining), undefined, { signal }).catch(() => undefined)
  }
  return false
}
