import { runTmux, runTmuxAsync, runTmuxNoThrow, runTmuxNoThrowAsync } from './client.js'
import { refreshWindowPaneLabels } from './labels.js'
import { ensureSwarmWindow } from './windows.js'

export async function createTeammatePane(
  input: {
    name: string
    preferred?: { target?: string; leaderPaneId?: string }
    cwd?: string
    startCommand?: string
  },
  signal?: AbortSignal,
): Promise<{ paneId: string; target: string }> {
  const swarm = await ensureSwarmWindow(input.preferred, signal)
  const panes = (await runTmuxAsync(['list-panes', '-t', swarm.target, '-F', '#{pane_id}'], undefined, signal)).split('\n').filter(Boolean)
  const hasLeaderLayout = Boolean(process.env.TMUX)

  const commandArgs = input.startCommand ? [input.startCommand] : []
  const cwdArgs = input.cwd ? ['-c', input.cwd] : []

  let paneId = ''
  if (hasLeaderLayout && panes.length === 1) {
    paneId = await runTmuxAsync(['split-window', '-t', swarm.leaderPaneId, '-h', '-l', '70%', ...cwdArgs, '-P', '-F', '#{pane_id}', ...commandArgs], undefined, signal)
    await runTmuxAsync(['select-layout', '-t', swarm.target, 'main-vertical'], undefined, signal)
    await runTmuxAsync(['resize-pane', '-t', swarm.leaderPaneId, '-x', '30%'], undefined, signal)
  } else {
    const splitTarget = panes[panes.length - 1]!
    paneId = await runTmuxAsync(['split-window', '-t', splitTarget, '-v', ...cwdArgs, '-P', '-F', '#{pane_id}', ...commandArgs], undefined, signal)
    await runTmuxAsync(['select-layout', '-t', swarm.target, hasLeaderLayout ? 'main-vertical' : 'tiled'], undefined, signal)
    if (hasLeaderLayout) {
      await runTmuxAsync(['resize-pane', '-t', swarm.leaderPaneId, '-x', '30%'], undefined, signal)
    }
  }

  await runTmuxNoThrowAsync(['set-option', '-p', '-t', paneId, '@agentteam-name', input.name], undefined, signal)
  await runTmuxNoThrowAsync(['select-pane', '-t', paneId, '-T', input.name], undefined, signal)
  await refreshWindowPaneLabels(swarm.target, signal)
  return { paneId, target: swarm.target }
}

export function focusPane(paneId: string): void {
  runTmux(['select-pane', '-t', paneId])
}

export function killPane(paneId: string): void {
  runTmuxNoThrow(['kill-pane', '-t', paneId])
}
