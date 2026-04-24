import { runTmuxAsync, runTmuxNoThrowAsync } from './client.js'
import {
  ensureTmuxAvailable,
  firstPaneInWindow,
  isInsideTmux,
  resolvePaneBindingAsync,
  SWARM_SESSION,
  SWARM_WINDOW,
  windowExists,
} from './core.js'
import {
  markWindowAsAgentTeam,
  refreshWindowPaneLabels,
} from './labels.js'

async function findAgentTeamWindowTarget(sessionName: string, signal?: AbortSignal): Promise<string | null> {
  const result = await runTmuxNoThrowAsync(['list-windows', '-t', sessionName, '-F', '#{window_id}\t#{@agentteam-window}'], undefined, signal)
  if (!result.ok || !result.stdout) return null
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue
    const [windowId, marker] = line.split('\t')
    if (marker === '1' && windowId) {
      return `${sessionName}:${windowId}`
    }
  }
  return null
}

export async function ensureSwarmWindow(
  preferred?: { target?: string; leaderPaneId?: string },
  signal?: AbortSignal,
): Promise<{ session: string; window: string; target: string; leaderPaneId: string }> {
  await ensureTmuxAvailable(signal)

  if (isInsideTmux()) {
    const preferredBinding = preferred?.leaderPaneId ? await resolvePaneBindingAsync(preferred.leaderPaneId, signal) : null
    const preferredTarget = preferredBinding?.target ?? (preferred?.target && await windowExists(preferred.target, signal) ? preferred.target : null)
    const target = preferredTarget ?? await runTmuxAsync(['display-message', '-p', '#{session_name}:#{window_id}'], undefined, signal)
    const leaderPaneId = preferredBinding?.paneId ?? await firstPaneInWindow(target, signal) ?? await runTmuxAsync(['display-message', '-p', '#{pane_id}'], undefined, signal)
    await markWindowAsAgentTeam(target, signal)
    await refreshWindowPaneLabels(target, signal)
    return {
      session: target.split(':')[0]!,
      window: target.split(':')[1]!,
      target,
      leaderPaneId,
    }
  }

  const hasSession = (await runTmuxNoThrowAsync(['has-session', '-t', SWARM_SESSION], undefined, signal)).ok
  if (!hasSession) {
    await runTmuxAsync(['new-session', '-d', '-s', SWARM_SESSION, '-n', SWARM_WINDOW], undefined, signal)
    await markWindowAsAgentTeam(`${SWARM_SESSION}:${SWARM_WINDOW}`, signal)
  }

  let initialTarget = await findAgentTeamWindowTarget(SWARM_SESSION, signal)
  if (!initialTarget) {
    await runTmuxAsync(['new-window', '-t', SWARM_SESSION, '-n', SWARM_WINDOW], undefined, signal)
    const result = (await runTmuxAsync(['list-windows', '-t', SWARM_SESSION, '-F', '#{window_id}\t#{window_name}'], undefined, signal))
      .split('\n')
      .map(line => line.split('\t'))
      .find(parts => parts[1] === SWARM_WINDOW)
    if (!result?.[0]) {
      throw new Error('Failed to locate agentteam tmux window after creation')
    }
    initialTarget = `${SWARM_SESSION}:${result[0]}`
    await markWindowAsAgentTeam(initialTarget, signal)
  }

  const panes = (await runTmuxAsync(['list-panes', '-t', initialTarget, '-F', '#{pane_id}'], undefined, signal)).split('\n').filter(Boolean)
  const leaderPaneId = panes[0]!
  const binding = await resolvePaneBindingAsync(leaderPaneId, signal)
  const target = binding?.target ?? `${SWARM_SESSION}:${await runTmuxAsync(['display-message', '-p', '-t', leaderPaneId, '#{window_id}'], undefined, signal)}`
  await markWindowAsAgentTeam(target, signal)
  await refreshWindowPaneLabels(target, signal)
  return { session: target.split(':')[0]!, window: target.split(':')[1]!, target, leaderPaneId }
}
