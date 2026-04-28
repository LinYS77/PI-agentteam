import { ensureTeamStorageReady, reconcileTeamPanes } from '../runtime.js'
import { isMailboxMessageUnread } from '../messageLifecycle.js'
import { mailboxUrgencyRank, normalizeMessageType } from '../protocol.js'
import { listAgentTeamPanes } from '../tmux.js'
import { listTeams, readMailbox, readTeamState, updateTeamState } from '../state.js'
import { TEAM_LEAD } from '../types.js'
import type {
  MailboxMessage,
  TeamMember,
  TeamMessageType,
  TeamState,
  TeamTask,
} from '../types.js'

export type LeaderMailboxItem = MailboxMessage
export type GlobalPaneItem = ReturnType<typeof listAgentTeamPanes>[number]

export type FocusSection = 'members' | 'tasks' | 'mailbox' | 'teams' | 'panes'
export type PanelInteractionMode = 'browse' | 'action-menu'

export type TeamPanelResult =
  | { type: 'close' }
  | { type: 'sync' }
  | { type: 'remove-member'; teamName: string; memberName: string }
  | { type: 'delete-team'; teamName: string }
  | { type: 'cleanup-all' }
  | { type: 'recover-team'; teamName: string }

export type PanelActionId =
  | 'toggle-details'
  | 'refresh'
  | 'sync'
  | 'remove-member'
  | 'delete-team'
  | 'cleanup-all'
  | 'recover-team'

export type PanelAction = {
  id: PanelActionId
  label: string
  description?: string
  danger?: boolean
  result?: TeamPanelResult
}

export type PanelActionMenu = {
  title: string
  actions: PanelAction[]
  selectedIndex: number
}

export type AttachedPanelData = {
  mode: 'attached'
  team: TeamState
  members: TeamMember[]
  tasks: TeamTask[]
  mailbox: LeaderMailboxItem[]
}

export type TeamAttentionSummary = {
  blockedTasks: number
  unreadMessages: number
  blockedMessages: number
  unownedActiveTasks: number
  errorMembers: number
  paneLostMembers: number
}

export type GlobalTeamMailboxProjection = {
  total: number
  unread: number
  blocked: number
  latestAttention?: MailboxMessage
}

export type GlobalPanelData = {
  mode: 'global'
  teams: TeamState[]
  teamSummaries: Record<string, TeamAttentionSummary>
  teamMailboxes: Record<string, GlobalTeamMailboxProjection>
  orphanPanes: GlobalPaneItem[]
}

export type PanelData = AttachedPanelData | GlobalPanelData

export type TeamPanelState = {
  focus: FocusSection
  selectedIndex: number
  selectedMemberIndex: number
  selectedTeamIndex: number
  selectedPaneIndex: number
  isDetailExpanded: boolean
  detailScrollOffset: number
  interactionMode: PanelInteractionMode
  actionMenu?: PanelActionMenu
}

export type PanelSelectionView = {
  visibleTasks: TeamTask[]
  visibleMailbox: LeaderMailboxItem[]
  selectedTask?: TeamTask
  selectedMailbox?: LeaderMailboxItem
  selectedMember?: TeamMember
  selectedTeam?: TeamState
  selectedPane?: GlobalPaneItem
}

export function createInitialPanelState(): TeamPanelState {
  return {
    focus: 'members',
    selectedIndex: 0,
    selectedMemberIndex: 0,
    selectedTeamIndex: 0,
    selectedPaneIndex: 0,
    isDetailExpanded: false,
    detailScrollOffset: 0,
    interactionMode: 'browse',
  }
}

export function hasPaneLostAttention(member: TeamMember): boolean {
  const lastWake = String(member.lastWakeReason ?? '').toLowerCase()
  const lastError = String(member.lastError ?? '').toLowerCase()
  return member.status === 'error' && (
    lastWake.includes('pane lost') ||
    lastError.includes('pane disappeared') ||
    lastError.includes('pane lost')
  )
}

export function buildTeamAttentionSummary(
  team: TeamState,
  mailbox: MailboxMessage[],
): TeamAttentionSummary {
  const teammates = Object.values(team.members).filter(member => member.name !== TEAM_LEAD)
  const tasks = Object.values(team.tasks)
  return {
    blockedTasks: tasks.filter(task => task.status === 'blocked').length,
    unreadMessages: mailbox.filter(isMailboxMessageUnread).length,
    blockedMessages: mailbox.filter(item => mailboxType(item) === 'blocked').length,
    unownedActiveTasks: tasks.filter(task => task.status !== 'completed' && !task.owner).length,
    errorMembers: teammates.filter(member => member.status === 'error').length,
    paneLostMembers: teammates.filter(hasPaneLostAttention).length,
  }
}

function loadAttachedPanelData(teamName: string): AttachedPanelData | null {
  const team = readTeamState(teamName)
  if (!team) return null
  ensureTeamStorageReady(team)
  if (reconcileTeamPanes(team, { force: true })) {
    updateTeamState(team.name, () => team)
  }
  const members = Object.values(team.members)
    .filter(member => member.name !== TEAM_LEAD)
    .sort((a, b) => a.name.localeCompare(b.name))
  const tasks = Object.values(team.tasks).sort((a, b) => a.id.localeCompare(b.id))
  const mailbox = (readMailbox(teamName, TEAM_LEAD) as LeaderMailboxItem[])
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
  return { mode: 'attached', team, members, tasks, mailbox }
}

function loadGlobalPanelData(): GlobalPanelData {
  const teams = listTeams()
  const teamSummaries: Record<string, TeamAttentionSummary> = {}
  const teamMailboxes: Record<string, GlobalTeamMailboxProjection> = {}
  const knownPaneIds = new Set<string>()
  for (const team of teams) {
    ensureTeamStorageReady(team)
    if (reconcileTeamPanes(team, { force: true })) {
      updateTeamState(team.name, () => team)
    }
    for (const member of Object.values(team.members)) {
      if (member.paneId) knownPaneIds.add(member.paneId)
    }
    const leaderMailbox = readMailbox(team.name, TEAM_LEAD)
    const latestAttention = leaderMailbox
      .filter(item => isMailboxMessageUnread(item) || mailboxType(item) === 'blocked')
      .sort((a, b) => b.createdAt - a.createdAt)[0]
    teamSummaries[team.name] = buildTeamAttentionSummary(team, leaderMailbox)
    teamMailboxes[team.name] = {
      total: leaderMailbox.length,
      unread: leaderMailbox.filter(isMailboxMessageUnread).length,
      blocked: leaderMailbox.filter(item => mailboxType(item) === 'blocked').length,
      latestAttention,
    }
  }

  const orphanPanes = listAgentTeamPanes()
    .filter(pane => !knownPaneIds.has(pane.paneId))
    .sort((a, b) => a.paneId.localeCompare(b.paneId))

  return { mode: 'global', teams, teamSummaries, teamMailboxes, orphanPanes }
}

export function loadPanelData(teamName?: string | null): PanelData {
  if (teamName) {
    const attached = loadAttachedPanelData(teamName)
    if (attached) return attached
  }
  return loadGlobalPanelData()
}

export function mailboxType(item: LeaderMailboxItem): TeamMessageType {
  return normalizeMessageType(item.type as string)
}

function sortMailboxByUrgency(items: LeaderMailboxItem[]): LeaderMailboxItem[] {
  return items
    .slice()
    .sort(
      (a, b) =>
        mailboxUrgencyRank(mailboxType(a), a.priority) - mailboxUrgencyRank(mailboxType(b), b.priority) ||
        b.createdAt - a.createdAt,
    )
}

function filterMailboxItems(
  mailbox: LeaderMailboxItem[],
): LeaderMailboxItem[] {
  return sortMailboxByUrgency(mailbox)
}

function getVisibleTasks(
  data: AttachedPanelData,
): TeamTask[] {
  return data.tasks
}

function isAttachedFocus(focus: FocusSection): boolean {
  return focus === 'members' || focus === 'tasks' || focus === 'mailbox'
}

function isGlobalFocus(focus: FocusSection): boolean {
  return focus === 'teams' || focus === 'panes'
}

function getSectionCount(
  data: PanelData,
  state: TeamPanelState,
): number {
  if (data.mode === 'global') {
    if (state.focus === 'panes') return data.orphanPanes.length
    return data.teams.length
  }
  if (state.focus === 'members') return data.members.length
  if (state.focus === 'tasks') return getVisibleTasks(data).length
  return filterMailboxItems(data.mailbox).length
}

export function clampPanelStateToData(
  state: TeamPanelState,
  data: PanelData,
): void {
  if (data.mode === 'attached' && !isAttachedFocus(state.focus)) {
    state.focus = 'members'
    state.selectedIndex = state.selectedMemberIndex
  }
  if (data.mode === 'global' && !isGlobalFocus(state.focus)) {
    state.focus = 'teams'
    state.selectedIndex = state.selectedTeamIndex
  }

  if (data.mode === 'attached') {
    state.selectedMemberIndex = data.members.length === 0
      ? 0
      : Math.max(0, Math.min(state.selectedMemberIndex, data.members.length - 1))
  } else {
    state.selectedTeamIndex = data.teams.length === 0
      ? 0
      : Math.max(0, Math.min(state.selectedTeamIndex, data.teams.length - 1))
    state.selectedPaneIndex = data.orphanPanes.length === 0
      ? 0
      : Math.max(0, Math.min(state.selectedPaneIndex, data.orphanPanes.length - 1))
  }

  const count = getSectionCount(data, state)
  state.selectedIndex = count === 0
    ? 0
    : Math.max(0, Math.min(state.selectedIndex, count - 1))

  if (data.mode === 'attached' && state.focus === 'members') {
    state.selectedIndex = state.selectedMemberIndex
  }
  if (data.mode === 'global' && state.focus === 'teams') {
    state.selectedIndex = state.selectedTeamIndex
  }
  if (data.mode === 'global' && state.focus === 'panes') {
    state.selectedIndex = state.selectedPaneIndex
  }

  if (state.actionMenu) {
    state.actionMenu.selectedIndex = state.actionMenu.actions.length === 0
      ? 0
      : Math.max(0, Math.min(state.actionMenu.selectedIndex, state.actionMenu.actions.length - 1))
  }
}

export function buildPanelSelectionView(
  data: PanelData,
  state: TeamPanelState,
): PanelSelectionView {
  if (data.mode === 'global') {
    return {
      visibleTasks: [],
      visibleMailbox: [],
      selectedTeam: data.teams[state.focus === 'teams' ? state.selectedIndex : state.selectedTeamIndex],
      selectedPane: data.orphanPanes[state.focus === 'panes' ? state.selectedIndex : state.selectedPaneIndex],
    }
  }

  const visibleTasks = getVisibleTasks(data)
  const visibleMailbox = filterMailboxItems(data.mailbox)

  return {
    visibleTasks,
    visibleMailbox,
    selectedTask: visibleTasks[state.focus === 'tasks' ? state.selectedIndex : 0],
    selectedMailbox: visibleMailbox[state.focus === 'mailbox' ? state.selectedIndex : 0],
    selectedMember: data.members[state.selectedMemberIndex],
  }
}
