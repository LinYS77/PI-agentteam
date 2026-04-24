import { runTmuxNoThrow, runTmuxNoThrowAsync } from './client.js'

type PaneBinding = {
  paneId: string
  target: string
}

type AgentTeamPaneInfo = {
  paneId: string
  target: string
  label: string
  currentCommand: string
}

export const SWARM_SESSION = 'pi-agentteam'
export const SWARM_WINDOW = 'agentteam'
export const SHELL_COMMANDS = new Set(['bash', 'zsh', 'fish', 'sh'])

export function shellEscapeArg(text: string): string {
  return `'${text.replace(/'/g, `"'"'`)}'`
}

export function isInsideTmux(): boolean {
  return Boolean(process.env.TMUX)
}

export async function ensureTmuxAvailable(signal?: AbortSignal): Promise<void> {
  const result = await runTmuxNoThrowAsync(['-V'], undefined, signal)
  if (!result.ok) {
    throw new Error(`tmux is required for agentteam panes${result.stderr ? `: ${result.stderr}` : ''}`)
  }
}

export function paneExists(paneId: string): boolean {
  if (!paneId) return false
  return runTmuxNoThrow(['display-message', '-p', '-t', paneId, '#{pane_id}']).ok
}

export function resolvePaneBinding(paneId: string): PaneBinding | null {
  if (!paneId) return null
  const paneResult = runTmuxNoThrow(['display-message', '-p', '-t', paneId, '#{pane_id}'])
  const targetResult = runTmuxNoThrow(['display-message', '-p', '-t', paneId, '#{session_name}:#{window_id}'])
  if (!paneResult.ok || !paneResult.stdout || !targetResult.ok || !targetResult.stdout) {
    return null
  }
  return {
    paneId: paneResult.stdout,
    target: targetResult.stdout,
  }
}

export async function resolvePaneBindingAsync(paneId: string, signal?: AbortSignal): Promise<PaneBinding | null> {
  if (!paneId) return null
  const paneResult = await runTmuxNoThrowAsync(['display-message', '-p', '-t', paneId, '#{pane_id}'], undefined, signal)
  const targetResult = await runTmuxNoThrowAsync(['display-message', '-p', '-t', paneId, '#{session_name}:#{window_id}'], undefined, signal)
  if (!paneResult.ok || !paneResult.stdout || !targetResult.ok || !targetResult.stdout) {
    return null
  }
  return {
    paneId: paneResult.stdout,
    target: targetResult.stdout,
  }
}

export async function windowExists(target: string, signal?: AbortSignal): Promise<boolean> {
  if (!target) return false
  return (await runTmuxNoThrowAsync(['list-panes', '-t', target, '-F', '#{pane_id}'], undefined, signal)).ok
}

export async function firstPaneInWindow(target: string, signal?: AbortSignal): Promise<string | null> {
  const result = await runTmuxNoThrowAsync(['list-panes', '-t', target, '-F', '#{pane_id}'], undefined, signal)
  if (!result.ok || !result.stdout) return null
  return result.stdout.split('\n').filter(Boolean)[0] ?? null
}

export function captureCurrentPaneBinding(): { paneId: string; target: string } | null {
  if (!isInsideTmux()) return null
  const paneIdResult = runTmuxNoThrow(['display-message', '-p', '#{pane_id}'])
  const targetResult = runTmuxNoThrow(['display-message', '-p', '#{session_name}:#{window_id}'])
  if (!paneIdResult.ok || !paneIdResult.stdout || !targetResult.ok || !targetResult.stdout) {
    return null
  }
  return {
    paneId: paneIdResult.stdout,
    target: targetResult.stdout,
  }
}

export function targetForPaneId(paneId: string): string | null {
  const result = runTmuxNoThrow(['display-message', '-p', '-t', paneId, '#{session_name}:#{window_id}'])
  return result.ok && result.stdout ? result.stdout : null
}

export function listAgentTeamPanes(): AgentTeamPaneInfo[] {
  const result = runTmuxNoThrow([
    'list-panes',
    '-a',
    '-F',
    '#{pane_id}\t#{session_name}:#{window_id}\t#{@agentteam-name}\t#{pane_current_command}',
  ])
  if (!result.ok || !result.stdout) return []
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [paneId, target, label, currentCommand] = line.split('\t')
      return {
        paneId: paneId ?? '',
        target: target ?? '',
        label: label ?? '',
        currentCommand: currentCommand ?? '',
      }
    })
    .filter(item => item.paneId && item.label)
}
