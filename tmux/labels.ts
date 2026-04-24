import type { TeamMember, TeamState } from '../types.js'
import { runTmuxNoThrowAsync } from './client.js'
import { targetForPaneId, windowExists } from './core.js'

function roleIcon(member: TeamMember): string {
  if (member.role === 'planner') return '🧭'
  if (member.role === 'researcher') return '🔎'
  if (member.role === 'implementer') return '🛠️'
  return '👤'
}

function statusWord(member: TeamMember): string {
  if (member.status === 'running') return 'running'
  if (member.status === 'queued') return 'queued'
  if (member.status === 'error') return 'error'
  return 'idle'
}

function compactCounts(items: string[]): string {
  return items.filter(Boolean).join(' · ')
}

function formatMemberPaneLabel(member: TeamMember): string {
  const role = member.role === 'leader' ? 'leader' : member.role
  return `${roleIcon(member)} ${member.name} · ${role} · ${statusWord(member)}`
}

function formatLeaderPaneLabel(team: TeamState): string {
  const teammates = Object.values(team.members).filter(member => member.name !== 'team-lead')
  const running = teammates.filter(member => member.status === 'running').length
  const queued = teammates.filter(member => member.status === 'queued').length
  const idle = teammates.filter(member => member.status === 'idle').length
  const error = teammates.filter(member => member.status === 'error').length
  const tasks = Object.values(team.tasks)
  const pending = tasks.filter(task => task.status === 'pending').length
  const active = tasks.filter(task => task.status === 'in_progress').length
  const blocked = tasks.filter(task => task.status === 'blocked').length
  const taskBits = compactCounts([
    pending > 0 ? `${pending} pending` : '',
    active > 0 ? `${active} active` : '',
    blocked > 0 ? `${blocked} blocked` : '',
  ])
  const teammateBits = compactCounts([
    running > 0 ? `${running} running` : '',
    queued > 0 ? `${queued} queued` : '',
    idle > 0 && running === 0 && queued === 0 ? `${idle} idle` : '',
    error > 0 ? `${error} error` : '',
  ])
  const bits = compactCounts([
    teammateBits ? `👥 ${teammateBits}` : '',
    taskBits ? `📝 ${taskBits}` : '',
  ])
  return bits ? `👑 leader · ${bits}` : '👑 leader · ready'
}

async function setPaneLabel(paneId: string, label: string, signal?: AbortSignal): Promise<void> {
  await runTmuxNoThrowAsync(['set-option', '-p', '-t', paneId, '@agentteam-name', label], undefined, signal)
  await runTmuxNoThrowAsync(['select-pane', '-t', paneId, '-T', label], undefined, signal)
}

async function clearPaneLabel(paneId: string, signal?: AbortSignal): Promise<void> {
  await runTmuxNoThrowAsync(['set-option', '-up', '-t', paneId, '@agentteam-name'], undefined, signal)
}

async function markWindowAsAgentTeam(target: string, signal?: AbortSignal): Promise<void> {
  if (!await windowExists(target, signal)) return
  await runTmuxNoThrowAsync(['set-option', '-w', '-t', target, 'automatic-rename', 'off'], undefined, signal)
  await runTmuxNoThrowAsync(['set-option', '-w', '-t', target, 'allow-rename', 'off'], undefined, signal)
  await runTmuxNoThrowAsync(['set-option', '-w', '-t', target, '@agentteam-window', '1'], undefined, signal)
}

async function refreshWindowPaneLabels(target: string, signal?: AbortSignal): Promise<void> {
  if (!await windowExists(target, signal)) return
  await runTmuxNoThrowAsync(['set-option', '-w', '-t', target, 'pane-border-status', 'top'], undefined, signal)
  await runTmuxNoThrowAsync(['set-option', '-w', '-t', target, 'pane-border-format', '#{?@agentteam-name,#{@agentteam-name},#{pane_title}}'], undefined, signal)
}

export async function syncPaneLabelsForTeam(team: TeamState, signal?: AbortSignal): Promise<void> {
  const targets = new Set<string>()
  for (const member of Object.values(team.members)) {
    const target = member.paneId ? targetForPaneId(member.paneId) : member.windowTarget
    if (member.paneId) {
      await setPaneLabel(member.paneId, member.name === 'team-lead' ? formatLeaderPaneLabel(team) : formatMemberPaneLabel(member), signal)
    }
    if (target) targets.add(target)
  }

  for (const target of targets) {
    await refreshWindowPaneLabels(target, signal)
  }
}

export async function clearPaneLabelsForTeam(team: TeamState, signal?: AbortSignal): Promise<void> {
  const targets = new Set<string>()
  for (const member of Object.values(team.members)) {
    if (member.paneId) {
      await clearPaneLabel(member.paneId, signal)
      const target = targetForPaneId(member.paneId) ?? member.windowTarget
      if (target) targets.add(target)
    } else if (member.windowTarget) {
      targets.add(member.windowTarget)
    }
  }
  for (const target of targets) {
    await refreshWindowPaneLabels(target, signal)
  }
}

export { markWindowAsAgentTeam, refreshWindowPaneLabels }
