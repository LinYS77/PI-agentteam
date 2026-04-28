import type { ExtensionContext } from '@mariozechner/pi-coding-agent'
import {
  truncateToWidth,
  visibleWidth,
} from '@mariozechner/pi-tui'
import { isMailboxMessageUnread } from '../messageLifecycle.js'
import type {
  TeamMember,
  TeamTask,
} from '../types.js'
import type {
  LeaderMailboxItem,
  PanelActionMenu,
  PanelData,
  PanelSelectionView,
  TeamAttentionSummary,
  TeamPanelState,
} from './viewModel.js'
import { buildTeamAttentionSummary, hasPaneLostAttention, mailboxType } from './viewModel.js'

type RenderLayoutInput = {
  width: number
  height?: number
  data: PanelData
  state: TeamPanelState
  selection: PanelSelectionView
}

function short(text: string, max = 60): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, max - 1)}…`
}

function basename(filePath: string): string {
  const chunks = filePath.split('/').filter(Boolean)
  return chunks[chunks.length - 1] ?? filePath
}

function formatAge(ageMs: number): string {
  const minutes = Math.max(0, Math.floor(ageMs / 60000))
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return rem === 0 ? `${hours}h` : `${hours}h${rem}m`
}

function formatDateTime(timeMs: number | undefined): string {
  if (!timeMs) return '-'
  return new Date(timeMs).toLocaleString()
}

function memberPaneLabel(member: TeamMember): string {
  return member.paneId ? `pane ${member.paneId}` : 'no pane'
}

function memberHealthLabel(member: TeamMember): string {
  if (hasPaneLostAttention(member)) return 'pane lost'
  if (member.status === 'error') return 'error'
  if (!member.paneId) return 'no pane'
  return member.status
}

function memberHealthColor(member: TeamMember): 'error' | 'warning' | 'accent' | 'dim' | 'text' {
  if (hasPaneLostAttention(member) || member.status === 'error') return 'error'
  if (!member.paneId) return 'warning'
  if (member.status === 'running') return 'warning'
  if (member.status === 'queued') return 'accent'
  return 'dim'
}

function mailboxTypeIcon(type: ReturnType<typeof mailboxType>): string {
  if (type === 'blocked') return '⧗'
  if (type === 'completion_report') return '✓'
  if (type === 'assignment') return '↦'
  if (type === 'question') return '?'
  return '•'
}

function mailboxTypeColor(type: ReturnType<typeof mailboxType>): 'error' | 'success' | 'accent' | 'warning' | 'dim' | 'text' {
  if (type === 'blocked') return 'error'
  if (type === 'completion_report') return 'success'
  if (type === 'assignment') return 'accent'
  if (type === 'question') return 'warning'
  return 'text'
}

function taskStatusIcon(status: TeamTask['status']): string {
  if (status === 'completed') return '✔'
  if (status === 'in_progress') return '⟳'
  if (status === 'blocked') return '⚠'
  return '○'
}

function memberStatusIcon(status: TeamMember['status']): string {
  if (status === 'running') return '⟳'
  if (status === 'queued') return '⋯'
  if (status === 'error') return '⚠'
  return '○'
}

function fitToWidth(line: string, width: number): string {
  const safeWidth = Math.max(0, width)
  const clipped = truncateToWidth(line, safeWidth)
  const pad = Math.max(0, safeWidth - visibleWidth(clipped))
  return `${clipped}${' '.repeat(pad)}`
}

function drawBox(
  theme: ExtensionContext['ui']['theme'],
  options: {
    width: number
    title: string
    lines: string[]
    focused?: boolean
    paddingX?: number
    paddingY?: number
    footer?: string
    minContentLines?: number
  },
): string[] {
  const width = Math.max(8, options.width)
  const inner = width - 2
  const isFocused = Boolean(options.focused)
  const borderColor = isFocused ? 'accent' : 'dim'
  const px = options.paddingX ?? 2
  const py = options.paddingY ?? 0
  const padStr = ' '.repeat(px)
  const contentInner = Math.max(0, inner - px * 2)

  const marker = isFocused ? theme.fg('accent', '● ') : ''
  const rawTitleText = ` ${marker}${options.title} `
  const titleText = truncateToWidth(rawTitleText, inner)
  const title = isFocused ? theme.bold(titleText) : theme.bold(titleText)
  const topFill = '─'.repeat(Math.max(0, inner - visibleWidth(titleText)))
  const top = theme.fg(borderColor, `╭${title}${topFill}╮`)

  let bottom = ''
  if (options.footer) {
    const footerText = ` ${options.footer} `
    const rightAlign = Math.max(0, inner - visibleWidth(footerText) - 1)
    const botFill = '─'.repeat(rightAlign)
    bottom = theme.fg(borderColor, `╰${botFill}${theme.fg('dim', footerText)}─╯`)
  } else {
    bottom = theme.fg(borderColor, `╰${'─'.repeat(inner)}╯`)
  }

  let content = options.lines.length > 0 ? options.lines : ['']
  if (options.minContentLines !== undefined && content.length < options.minContentLines) {
    content = [...content, ...Array(options.minContentLines - content.length).fill('')]
  }

  const padLines = Array(py).fill('')
  const finalContent = [...padLines, ...content, ...padLines]

  const body = finalContent.map(line => {
    const left = theme.fg(borderColor, '│')
    const right = theme.fg(borderColor, '│')
    return `${left}${padStr}${fitToWidth(line, contentInner)}${padStr}${right}`
  })

  return [top, ...body, bottom]
}

function mergeColumns(
  left: string[],
  right: string[],
  leftWidth: number,
  rightWidth: number,
  gap = 2,
): string[] {
  const spacer = ' '.repeat(Math.max(1, gap))
  const max = Math.max(left.length, right.length)
  const out: string[] = []
  for (let i = 0; i < max; i += 1) {
    const leftLine = left[i] ? fitToWidth(left[i]!, leftWidth) : ' '.repeat(leftWidth)
    const rightLine = right[i] ? fitToWidth(right[i]!, rightWidth) : ' '.repeat(rightWidth)
    out.push(`${leftLine}${spacer}${rightLine}`)
  }
  return out
}

function windowSlice<T>(items: T[], cursor: number, maxVisible: number): { items: T[]; offset: number } {
  if (items.length <= maxVisible) {
    return { items, offset: 0 }
  }
  const safeCursor = Math.max(0, Math.min(items.length - 1, cursor))
  let start = Math.max(0, safeCursor - Math.floor(maxVisible / 2))
  if (start + maxVisible > items.length) {
    start = items.length - maxVisible
  }
  return {
    items: items.slice(start, start + maxVisible),
    offset: start,
  }
}

function padCell(text: string, width: number): string {
  return `${text}${' '.repeat(Math.max(0, width - visibleWidth(text)))} `
}

function memberStatusBadge(theme: ExtensionContext['ui']['theme'], status: TeamMember['status']): string {
  const color =
    status === 'running'
      ? 'warning'
      : status === 'error'
        ? 'error'
        : status === 'queued'
          ? 'accent'
          : 'dim'
  return theme.fg(color, `[${memberStatusIcon(status)} ${status}]`)
}

function taskStatusBadge(theme: ExtensionContext['ui']['theme'], status: TeamTask['status']): string {
  const color =
    status === 'completed'
      ? 'success'
      : status === 'in_progress'
        ? 'warning'
        : status === 'blocked'
          ? 'error'
          : 'dim'
  return theme.fg(color, `[${taskStatusIcon(status)} ${status}]`)
}

function attentionSummaryParts(
  theme: ExtensionContext['ui']['theme'],
  summary: TeamAttentionSummary,
): string[] {
  const parts: string[] = []
  if (summary.paneLostMembers > 0) parts.push(theme.fg('error', `pane lost ${summary.paneLostMembers}`))
  else if (summary.errorMembers > 0) parts.push(theme.fg('error', `⚠ ${summary.errorMembers} member error${summary.errorMembers === 1 ? '' : 's'}`))
  if (summary.blockedTasks > 0) parts.push(theme.fg('error', `⚠ ${summary.blockedTasks} blocked task${summary.blockedTasks === 1 ? '' : 's'}`))
  if (summary.blockedMessages > 0) parts.push(theme.fg('error', `⧗ ${summary.blockedMessages} blocked msg${summary.blockedMessages === 1 ? '' : 's'}`))
  if (summary.unreadMessages > 0) parts.push(theme.fg('warning', `✉ ${summary.unreadMessages} unread`))
  if (summary.unownedActiveTasks > 0) parts.push(theme.fg('warning', `◇ ${summary.unownedActiveTasks} unowned`))
  return parts
}

function compactAttentionSummaryParts(
  theme: ExtensionContext['ui']['theme'],
  summary: TeamAttentionSummary,
): string[] {
  const parts: string[] = []
  if (summary.paneLostMembers > 0) parts.push(theme.fg('error', `lost${summary.paneLostMembers}`))
  else if (summary.errorMembers > 0) parts.push(theme.fg('error', `err${summary.errorMembers}`))
  if (summary.blockedTasks > 0) parts.push(theme.fg('error', `⚠${summary.blockedTasks}`))
  if (summary.blockedMessages > 0) parts.push(theme.fg('error', `⧗${summary.blockedMessages}`))
  if (summary.unreadMessages > 0) parts.push(theme.fg('warning', `✉${summary.unreadMessages}`))
  if (summary.unownedActiveTasks > 0) parts.push(theme.fg('warning', `◇${summary.unownedActiveTasks}`))
  return parts
}

function foldAttentionParts(
  theme: ExtensionContext['ui']['theme'],
  parts: string[],
  limit = 3,
): string[] {
  if (parts.length <= limit) return parts
  return [...parts.slice(0, limit), theme.fg('dim', `+${parts.length - limit} more`)]
}

function foldCompactAttentionParts(
  theme: ExtensionContext['ui']['theme'],
  parts: string[],
  limit = 3,
): string[] {
  if (parts.length <= limit) return parts
  return [...parts.slice(0, limit), theme.fg('dim', `+${parts.length - limit}`)]
}

function sumAttentionSummaries(summaries: TeamAttentionSummary[]): TeamAttentionSummary {
  return summaries.reduce<TeamAttentionSummary>((acc, item) => ({
    blockedTasks: acc.blockedTasks + item.blockedTasks,
    unreadMessages: acc.unreadMessages + item.unreadMessages,
    blockedMessages: acc.blockedMessages + item.blockedMessages,
    unownedActiveTasks: acc.unownedActiveTasks + item.unownedActiveTasks,
    errorMembers: acc.errorMembers + item.errorMembers,
    paneLostMembers: acc.paneLostMembers + item.paneLostMembers,
  }), {
    blockedTasks: 0,
    unreadMessages: 0,
    blockedMessages: 0,
    unownedActiveTasks: 0,
    errorMembers: 0,
    paneLostMembers: 0,
  })
}

function renderOverviewLine(theme: ExtensionContext['ui']['theme'], data: PanelData): string {
  if (data.mode === 'global') {
    const globalAttention = sumAttentionSummaries(Object.values(data.teamSummaries))
    const attention = foldAttentionParts(theme, attentionSummaryParts(theme, globalAttention))
    const attentionText = attention.length > 0 ? attention.join(theme.fg('dim', ' · ')) : theme.fg('dim', 'OK')
    return `${theme.bold(theme.fg('text', '✦  AgentTeam Console '))} ${theme.fg('dim', '│')} Attention ${attentionText} ${theme.fg('dim', '│')} Teams ${data.teams.length} ${theme.fg('dim', '│')} Stale panes ${data.orphanPanes.length}`
  }

  const runningCount = data.members.filter(member => member.status === 'running').length
  const queuedCount = data.members.filter(member => member.status === 'queued').length
  const idleCount = data.members.filter(member => member.status === 'idle').length
  const errorCount = data.members.filter(member => member.status === 'error').length

  const pendingCount = data.tasks.filter(task => task.status === 'pending').length
  const inProgressCount = data.tasks.filter(task => task.status === 'in_progress').length
  const blockedCount = data.tasks.filter(task => task.status === 'blocked').length
  const completedCount = data.tasks.filter(task => task.status === 'completed').length

  const blockedMsgCount = data.mailbox.filter(item => mailboxType(item) === 'blocked').length
  const unreadMsgCount = data.mailbox.filter(isMailboxMessageUnread).length

  const tName = theme.bold(theme.fg('text', `✦  ${data.team.name} `))

  const mStatus = `${theme.fg('warning', `⟳ ${runningCount}`)} ${theme.fg('accent', `⋯ ${queuedCount}`)} ${theme.fg('dim', `○ ${idleCount}`)}${errorCount ? ` ${theme.fg('error', `⚠ ${errorCount}`)}` : ''}`
  const tStatus = `${theme.fg('dim', `○ ${pendingCount}`)} ${theme.fg('warning', `⟳ ${inProgressCount}`)} ${theme.fg('error', `⚠ ${blockedCount}`)} ${theme.fg('success', `✔ ${completedCount}`)}`
  const sStatus = `${theme.fg(unreadMsgCount > 0 ? 'warning' : 'dim', `${unreadMsgCount} unread`)} · ${theme.fg(blockedMsgCount > 0 ? 'error' : 'dim', `${blockedMsgCount} blocked`)} · total ${data.mailbox.length}`
  const attention = foldAttentionParts(theme, attentionSummaryParts(theme, buildTeamAttentionSummary(data.team, data.mailbox)))
  const attentionText = attention.length > 0 ? attention.join(theme.fg('dim', ' · ')) : theme.fg('dim', 'OK')

  return `${tName} ${theme.fg('dim', '│')} Attention ${attentionText}  ${theme.fg('dim', '│')} 👥 Members  ${mStatus}  ${theme.fg('dim', '│')} 📋 Tasks  ${tStatus}  ${theme.fg('dim', '│')} 📬 Mail  ${sStatus}`
}

function renderMembersLines(
  theme: ExtensionContext['ui']['theme'],
  data: Extract<PanelData, { mode: 'attached' }>,
  state: TeamPanelState,
): string[] {
  const membersWindow = windowSlice(data.members, state.selectedMemberIndex, 6)
  const lines: string[] = []
  if (data.members.length === 0) {
    lines.push(theme.fg('muted', 'No teammates'))
    return lines
  }

  if (membersWindow.offset > 0) {
    lines.push(theme.fg('dim', `… ${membersWindow.offset} above`))
  }

  for (let i = 0; i < membersWindow.items.length; i += 1) {
    const member = membersWindow.items[i]!
    const absolute = membersWindow.offset + i
    const isSelected = state.focus === 'members' && absolute === state.selectedIndex
    const pointer = isSelected ? theme.fg('accent', '›') : ' '
    
    const unread = data.mailbox.filter(m => m.from === member.name && isMailboxMessageUnread(m)).length
    const activeTasks = data.tasks.filter(t => t.owner === member.name && t.status !== 'completed').length
    const blockedTasks = data.tasks.filter(t => t.owner === member.name && t.status === 'blocked').length
    const paneLost = hasPaneLostAttention(member)
    const ageStr = formatAge(Date.now() - member.updatedAt)
    const paneStr = paneLost ? 'pane lost' : memberPaneLabel(member)
    const paneColor = paneLost ? 'error' : member.paneId ? 'dim' : 'warning'
    const attention = [
      blockedTasks > 0 ? theme.fg('error', `blocked ${blockedTasks}`) : '',
      unread > 0 ? theme.fg('warning', `unread ${unread}`) : '',
    ].filter(Boolean).join(theme.fg('dim', ' · '))
    
    const statsStr = `${theme.fg('dim', short(member.role, 10))} · ${theme.fg(paneColor, paneStr)} · ${theme.fg('dim', `tasks ${activeTasks}`)} · ${theme.fg('dim', `unread ${unread}`)} · ${theme.fg('dim', `age ${ageStr}`)}`
    const attentionStr = attention ? `  ${attention}` : ''
    const nameStr = short(member.name, 14)
    const nameCol = isSelected ? padCell(theme.bold(theme.fg('accent', nameStr)), 14) : padCell(theme.fg('text', nameStr), 14)
    
    lines.push(
      `${pointer}  ${nameCol} ${memberStatusBadge(theme, member.status)}  ${statsStr}${attentionStr}`,
    )
  }

  const hiddenBelow = data.members.length - (membersWindow.offset + membersWindow.items.length)
  if (hiddenBelow > 0) {
    lines.push(theme.fg('dim', `… ${hiddenBelow} below`))
  }

  return lines
}

function renderTaskLines(
  theme: ExtensionContext['ui']['theme'],
  state: TeamPanelState,
  selection: PanelSelectionView,
): string[] {
  const tasksWindow = windowSlice(selection.visibleTasks, state.focus === 'tasks' ? state.selectedIndex : 0, 6)
  const lines: string[] = []

  if (selection.visibleTasks.length === 0) {
    lines.push(theme.fg('muted', 'No tasks'))
    return lines
  }

  if (tasksWindow.offset > 0) {
    lines.push(theme.fg('dim', `… ${tasksWindow.offset} above`))
  }

  for (let i = 0; i < tasksWindow.items.length; i += 1) {
    const task = tasksWindow.items[i]!
    const absolute = tasksWindow.offset + i
    const isSelected = state.focus === 'tasks' && absolute === state.selectedIndex
    const pointer = isSelected ? theme.fg('accent', '›') : ' '
    
    const idCol = padCell(isSelected ? theme.bold(theme.fg('accent', task.id)) : theme.fg('dim', task.id), 8)
    const ownerCol = theme.fg('dim', `@${short(task.owner ?? '-', 10)}`)
    const titleCol = padCell(isSelected ? theme.fg('text', short(task.title, 30)) : theme.fg('text', short(task.title, 30)), 30)
    const attention = [
      task.status === 'blocked' ? theme.fg('error', 'blocked') : '',
      task.status !== 'completed' && !task.owner ? theme.fg('warning', 'unowned') : '',
    ].filter(Boolean).join(theme.fg('dim', ' · '))
    const attentionStr = attention ? `  ${attention}` : ''
    
    lines.push(
      `${pointer}  ${idCol}  ${taskStatusBadge(theme, task.status)}  ${titleCol}  ${ownerCol}${attentionStr}`,
    )
  }

  const hiddenBelow = selection.visibleTasks.length - (tasksWindow.offset + tasksWindow.items.length)
  if (hiddenBelow > 0) {
    lines.push(theme.fg('dim', `… ${hiddenBelow} below`))
  }

  return lines
}

function renderMailboxLines(
  theme: ExtensionContext['ui']['theme'],
  state: TeamPanelState,
  selection: PanelSelectionView,
): string[] {
  const mailboxWindow = windowSlice(selection.visibleMailbox, state.focus === 'mailbox' ? state.selectedIndex : 0, 5)
  const lines: string[] = []

  if (selection.visibleMailbox.length === 0) {
    lines.push(theme.fg('muted', 'No messages'))
    return lines
  }

  if (mailboxWindow.offset > 0) {
    lines.push(theme.fg('dim', `… ${mailboxWindow.offset} above`))
  }

  for (let i = 0; i < mailboxWindow.items.length; i += 1) {
    const item = mailboxWindow.items[i]!
    const absolute = mailboxWindow.offset + i
    const isSelected = state.focus === 'mailbox' && absolute === state.selectedIndex
    const pointer = isSelected ? theme.fg('accent', '›') : ' '
    
    const type = mailboxType(item)
    const icon = theme.fg(mailboxTypeColor(type), mailboxTypeIcon(type))
    const fromCol = isSelected ? padCell(theme.bold(theme.fg('accent', short(item.from, 14))), 14) : padCell(theme.fg('text', short(item.from, 14)), 14)
    
    const isUnread = isMailboxMessageUnread(item)
    const summaryText = short(item.summary ?? item.text, 36)
    const summaryFmt = isUnread ? theme.bold(theme.fg('text', summaryText)) : theme.fg('dim', summaryText)
    const summaryCol = padCell(summaryFmt, 36)
    const attention = [
      isUnread ? theme.fg('warning', 'unread') : '',
      type === 'blocked' ? theme.fg('error', 'blocked') : '',
    ].filter(Boolean).join(theme.fg('dim', ' · '))
    const attentionStr = attention ? `  ${attention}` : ''
    
    const timeStr = theme.fg('dim', new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))

    lines.push(
      `${pointer}  ${icon}  ${fromCol}  ${summaryCol}  ${timeStr}${attentionStr}`,
    )
  }

  const hiddenBelow = selection.visibleMailbox.length - (mailboxWindow.offset + mailboxWindow.items.length)
  if (hiddenBelow > 0) {
    lines.push(theme.fg('dim', `… ${hiddenBelow} below`))
  }

  return lines
}

function teamStatusLine(
  theme: ExtensionContext['ui']['theme'],
  team: Extract<PanelData, { mode: 'global' }>['teams'][number],
  summary?: TeamAttentionSummary,
): string {
  const teammates = Object.values(team.members).filter(member => member.name !== 'team-lead')
  const taskCount = Object.keys(team.tasks).length
  const attention = summary ? foldCompactAttentionParts(theme, compactAttentionSummaryParts(theme, summary)) : []
  const attentionSuffix = attention.length > 0 ? attention.join(' ') : theme.fg('success', 'OK')
  return `${teammates.length}m · ${taskCount}t · ${attentionSuffix}`
}

function renderGlobalTeamLines(
  theme: ExtensionContext['ui']['theme'],
  data: Extract<PanelData, { mode: 'global' }>,
  state: TeamPanelState,
): string[] {
  const teamsWindow = windowSlice(data.teams, state.selectedTeamIndex, 8)
  const lines: string[] = []
  if (data.teams.length === 0) {
    lines.push(theme.fg('muted', 'No saved teams'))
    return lines
  }
  if (teamsWindow.offset > 0) lines.push(theme.fg('dim', `… ${teamsWindow.offset} above`))
  for (let i = 0; i < teamsWindow.items.length; i += 1) {
    const team = teamsWindow.items[i]!
    const absolute = teamsWindow.offset + i
    const isSelected = state.focus === 'teams' && absolute === state.selectedIndex
    const pointer = isSelected ? theme.fg('accent', '›') : ' '
    const name = isSelected ? theme.bold(theme.fg('accent', short(team.name, 24))) : theme.fg('text', short(team.name, 24))
    lines.push(`${pointer}  ${padCell(name, 24)} ${theme.fg('dim', teamStatusLine(theme, team, data.teamSummaries[team.name]))}`)
  }
  const hiddenBelow = data.teams.length - (teamsWindow.offset + teamsWindow.items.length)
  if (hiddenBelow > 0) lines.push(theme.fg('dim', `… ${hiddenBelow} below`))
  return lines
}

function renderGlobalPaneLines(
  theme: ExtensionContext['ui']['theme'],
  data: Extract<PanelData, { mode: 'global' }>,
  state: TeamPanelState,
): string[] {
  const panesWindow = windowSlice(data.orphanPanes, state.selectedPaneIndex, 8)
  const lines: string[] = []
  if (data.orphanPanes.length === 0) {
    lines.push(theme.fg('muted', 'No stale panes with agentteam labels'))
    return lines
  }
  if (panesWindow.offset > 0) lines.push(theme.fg('dim', `… ${panesWindow.offset} above`))
  for (let i = 0; i < panesWindow.items.length; i += 1) {
    const pane = panesWindow.items[i]!
    const absolute = panesWindow.offset + i
    const isSelected = state.focus === 'panes' && absolute === state.selectedIndex
    const pointer = isSelected ? theme.fg('accent', '›') : ' '
    const paneId = isSelected ? theme.bold(theme.fg('accent', pane.paneId)) : theme.fg('text', pane.paneId)
    lines.push(`${pointer}  ${padCell(paneId, 8)} ${theme.fg('dim', short(pane.label || pane.currentCommand || pane.target, 54))}`)
  }
  const hiddenBelow = data.orphanPanes.length - (panesWindow.offset + panesWindow.items.length)
  if (hiddenBelow > 0) lines.push(theme.fg('dim', `… ${hiddenBelow} below`))
  return lines
}

function renderGlobalDetailLines(
  theme: ExtensionContext['ui']['theme'],
  data: Extract<PanelData, { mode: 'global' }>,
  state: TeamPanelState,
  selection: PanelSelectionView,
): string[] {
  const detailLines: string[] = []
  if (state.focus === 'panes') {
    const pane = selection.selectedPane
    if (!pane) {
      detailLines.push(theme.fg('muted', 'No stale pane selected'))
    } else {
      detailLines.push(`🧹 ${theme.bold(theme.fg('text', pane.paneId))}`)
      detailLines.push('')
      detailLines.push(renderDetailField(theme, 'Pane', pane.paneId, 'text'))
      detailLines.push(renderDetailField(theme, 'Target', pane.target || '-', 'text'))
      detailLines.push(renderDetailField(theme, 'Label', pane.label || '-', pane.label ? 'warning' : 'dim'))
      detailLines.push(renderDetailField(theme, 'Command', pane.currentCommand || '-', 'text'))
      detailLines.push(renderDetailField(theme, 'State', 'stale agentteam-labeled pane', 'warning'))
    }
  } else {
    const team = selection.selectedTeam
    if (!team) {
      detailLines.push(theme.fg('muted', 'No team selected'))
    } else {
      const teammates = Object.values(team.members).filter(member => member.name !== 'team-lead')
      const tasks = Object.values(team.tasks)
      const leader = team.members['team-lead']
      const summary = data.teamSummaries[team.name]
      const mailbox = data.teamMailboxes[team.name]
      detailLines.push(`🤝 ${theme.bold(theme.fg('text', team.name))}`)
      detailLines.push('')
      const errorCount = teammates.filter(member => member.status === 'error').length
      const missingPaneCount = teammates.filter(member => !member.paneId).length
      const runningCount = teammates.filter(member => member.status === 'running').length
      const queuedCount = teammates.filter(member => member.status === 'queued').length
      const idleCount = teammates.filter(member => member.status === 'idle').length
      const pendingCount = tasks.filter(task => task.status === 'pending').length
      const inProgressCount = tasks.filter(task => task.status === 'in_progress').length
      const blockedCount = tasks.filter(task => task.status === 'blocked').length
      const completedCount = tasks.filter(task => task.status === 'completed').length
      const unownedCount = tasks.filter(task => task.status !== 'completed' && !task.owner).length
      const attentionParts = summary ? attentionSummaryParts(theme, summary) : []
      detailLines.push(renderDetailField(theme, 'Teammates', String(teammates.length), 'text'))
      detailLines.push(renderDetailField(theme, 'Health', `running ${runningCount} · queued ${queuedCount} · idle ${idleCount} · error ${errorCount} · no pane ${missingPaneCount}`, errorCount || missingPaneCount ? 'warning' : 'text'))
      detailLines.push(renderDetailField(theme, 'Tasks', `pending ${pendingCount} · active ${inProgressCount} · blocked ${blockedCount} · done ${completedCount} · unowned ${unownedCount}`, blockedCount || unownedCount ? 'warning' : 'text'))
      detailLines.push(renderDetailField(theme, 'Mailbox', mailbox ? `unread ${mailbox.unread} · blocked ${mailbox.blocked} · total ${mailbox.total}` : 'unread 0 · blocked 0 · total 0', mailbox && (mailbox.unread || mailbox.blocked) ? 'warning' : 'text'))
      detailLines.push(renderDetailField(theme, 'Attention', attentionParts.join(' · ') || 'OK', attentionParts.length > 0 ? 'warning' : 'text'))
      detailLines.push(renderDetailField(theme, 'Leader pane', leader?.paneId ?? 'missing', leader?.paneId ? 'text' : 'warning'))
      detailLines.push(renderDetailField(theme, 'Created', new Date(team.createdAt).toLocaleString(), 'text'))

      if (mailbox?.latestAttention) {
        const latest = mailbox.latestAttention
        const latestType = mailboxType(latest)
        detailLines.push('')
        detailLines.push(...renderDetailBlock(theme, `Latest mail attention · ${latestType} · ${latest.from}`, latest.summary ?? latest.text, 44, latestType === 'blocked' ? 'error' : 'text'))
      } else {
        const latestBlocked = tasks
          .filter(task => task.status === 'blocked' || (task.status !== 'completed' && !task.owner))
          .sort((a, b) => b.updatedAt - a.updatedAt)[0]
        if (latestBlocked) {
          const kind = latestBlocked.status === 'blocked' ? 'blocked task' : 'unowned task'
          detailLines.push('')
          detailLines.push(...renderDetailBlock(theme, `Latest task attention · ${kind} · ${latestBlocked.id}`, latestBlocked.title, 44, latestBlocked.status === 'blocked' ? 'error' : 'warning'))
        }
      }

      if (teammates.length > 0) {
        detailLines.push('')
        detailLines.push(renderDetailSeparator(theme, 44))
        detailLines.push(theme.bold(theme.fg('dim', 'Roster')))
        for (const member of teammates.slice(0, 4)) {
          const health = memberHealthLabel(member)
          const pane = memberPaneLabel(member)
          const healthCol = padCell(theme.fg(memberHealthColor(member), short(health, 9)), 10)
          const nameCol = padCell(theme.fg('text', short(member.name, 16)), 16)
          const roleCol = padCell(theme.fg('dim', short(member.role, 10)), 10)
          const paneCol = theme.fg(member.paneId ? 'dim' : 'warning', short(pane, 12))
          detailLines.push(`  ${healthCol}${nameCol}${roleCol}${paneCol}`)
        }
        const hidden = teammates.length - 4
        if (hidden > 0) detailLines.push(theme.fg('dim', `  … ${hidden} more teammate(s)`))
      }
    }
  }
  detailLines.push('')
  detailLines.push(theme.fg('dim', '👉 ') + theme.fg('accent', 'Enter ') + theme.fg('dim', 'actions'))
  return detailLines
}

function renderActionMenuLines(
  theme: ExtensionContext['ui']['theme'],
  menu: PanelActionMenu,
): string[] {
  const lines: string[] = []
  lines.push(theme.bold(theme.fg('text', menu.title)))
  lines.push('')
  for (let i = 0; i < menu.actions.length; i += 1) {
    const action = menu.actions[i]!
    const isSelected = i === menu.selectedIndex
    const pointer = isSelected ? theme.fg('accent', '›') : ' '
    const labelColor = action.danger ? 'error' : isSelected ? 'accent' : 'text'
    const label = isSelected ? theme.bold(theme.fg(labelColor, action.label)) : theme.fg(labelColor, action.label)
    lines.push(`${pointer}  ${label}`)
    if (action.description) {
      lines.push(`   ${theme.fg('dim', short(action.description, 76))}`)
    }
  }
  return lines
}

function splitLongTokenByWidth(token: string, width: number): string[] {
  if (visibleWidth(token) <= width) return [token]
  const chunks: string[] = []
  let current = ''
  for (const char of [...token]) {
    if (current && visibleWidth(current + char) > width) {
      chunks.push(current)
      current = char
    } else {
      current += char
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function wordWrap(text: string, width: number): string[] {
  const safeWidth = Math.max(1, width)
  if (!text) return ['']
  const lines: string[] = []
  let currentLine = ''

  const flush = () => {
    if (!currentLine) return
    lines.push(currentLine)
    currentLine = ''
  }

  for (const rawToken of text.split(/(\s+)/u)) {
    if (!rawToken) continue
    if (/^\s+$/u.test(rawToken)) {
      if (currentLine && visibleWidth(`${currentLine} `) <= safeWidth) currentLine += ' '
      continue
    }

    for (const token of splitLongTokenByWidth(rawToken, safeWidth)) {
      if (!currentLine) {
        currentLine = token
        continue
      }
      if (visibleWidth(currentLine + token) <= safeWidth) {
        currentLine += token
        continue
      }
      if (visibleWidth(`${currentLine} ${token}`) <= safeWidth) {
        currentLine += ` ${token}`
        continue
      }
      flush()
      currentLine = token
    }
  }

  flush()
  return lines.length > 0 ? lines : ['']
}

function renderDetailField(
  theme: ExtensionContext['ui']['theme'],
  label: string,
  value: string,
  color: 'dim' | 'accent' | 'warning' | 'error' | 'success' | 'text' = 'text',
): string {
  const labelWidth = 13
  return `${theme.fg('dim', padCell(`${label}:`, labelWidth))} ${theme.fg(color, value)}`
}

function renderDetailBlock(
  theme: ExtensionContext['ui']['theme'],
  label: string,
  value: string,
  width: number,
  color: 'dim' | 'accent' | 'warning' | 'error' | 'success' | 'text' = 'text',
): string[] {
  const out: string[] = []
  const marker = theme.fg('accent', '▸')
  out.push(`${marker} ${theme.bold(theme.fg('dim', label))}`)
  const indent = '  '
  const wrapWidth = Math.max(8, width - visibleWidth(indent))
  const rawLines = value ? value.split('\n') : ['']
  for (const rawLine of rawLines) {
    for (const wrappedLine of wordWrap(rawLine, wrapWidth)) {
      out.push(`${indent}${theme.fg(color, wrappedLine)}`)
    }
  }
  return out
}

function renderDetailSeparator(theme: ExtensionContext['ui']['theme'], width: number): string {
  return theme.fg('dim', '─'.repeat(Math.max(8, width)))
}

function renderDetailLines(
  theme: ExtensionContext['ui']['theme'],
  data: Extract<PanelData, { mode: 'attached' }>,
  state: TeamPanelState,
  selection: PanelSelectionView,
  width: number,
): string[] {
  const detailLines: string[] = []
  const textWidth = Math.max(20, width - 6) // Content width inside details box after borders/padding.

  if (state.focus === 'members') {
    const selectedMember = selection.selectedMember
    if (!selectedMember) {
      detailLines.push(theme.fg('muted', '👤 No member selected'))
      return detailLines
    }

    const activeTasks = data.tasks.filter(task => task.owner === selectedMember.name && task.status !== 'completed').length
    const msgCount = data.mailbox.filter(item => item.from === selectedMember.name).length
    detailLines.push(`👤 ${theme.bold(theme.fg('text', selectedMember.name))}  ${memberStatusBadge(theme, selectedMember.status)}  ${theme.fg('dim', selectedMember.role)}`)
    detailLines.push('')
    detailLines.push(renderDetailField(theme, 'Health', memberHealthLabel(selectedMember), memberHealthColor(selectedMember)))
    detailLines.push(renderDetailField(theme, 'Pane', memberPaneLabel(selectedMember), selectedMember.paneId ? 'text' : 'warning'))
    if (selectedMember.windowTarget) detailLines.push(renderDetailField(theme, 'Window', selectedMember.windowTarget, 'text'))
    detailLines.push(renderDetailField(theme, 'Tasks', String(activeTasks), 'text'))
    detailLines.push(renderDetailField(theme, 'Mailbox', String(msgCount), 'text'))
    detailLines.push(renderDetailField(theme, 'Session', basename(selectedMember.sessionFile), 'text'))
    detailLines.push(renderDetailField(theme, 'Updated', `${formatDateTime(selectedMember.updatedAt)} (${formatAge(Date.now() - selectedMember.updatedAt)} ago)`, 'text'))
    detailLines.push(renderDetailField(theme, 'Created', formatDateTime(selectedMember.createdAt), 'text'))
    if (selectedMember.lastWakeReason) detailLines.push(renderDetailField(theme, 'Wake', selectedMember.lastWakeReason, 'text'))
    if (selectedMember.lastError) detailLines.push(renderDetailField(theme, 'Error', selectedMember.lastError, 'error'))
    
    detailLines.push('')
    detailLines.push(theme.fg('dim', '👉 ') + theme.fg('accent', 'Enter ') + theme.fg('dim', 'actions'))
    return detailLines
  }

  if (state.focus === 'tasks') {
    const selectedTask = selection.selectedTask
    if (!selectedTask) {
      detailLines.push(theme.fg('muted', '📋 No task selected'))
      return detailLines
    }

    detailLines.push(`📋 ${theme.bold(theme.fg('accent', selectedTask.id))}  ${taskStatusBadge(theme, selectedTask.status)}  ${theme.fg('text', short(selectedTask.title, Math.max(12, textWidth - 25)))}`)
    detailLines.push('')
    detailLines.push(renderDetailField(theme, 'Owner', selectedTask.owner ?? '-', 'text'))
    if (selectedTask.blockedBy.length > 0) {
      detailLines.push(renderDetailField(theme, 'Blocked by', selectedTask.blockedBy.join(','), 'error'))
    }
    
    const latest = selectedTask.notes[selectedTask.notes.length - 1]
    if (state.isDetailExpanded) {
      detailLines.push('')
      detailLines.push(renderDetailSeparator(theme, textWidth))
      detailLines.push(...renderDetailBlock(theme, 'Description', selectedTask.description || '(none)', textWidth, 'text'))

      if (latest) {
        detailLines.push('')
        detailLines.push(...renderDetailBlock(theme, `Latest note · ${latest.author}`, latest.text, textWidth, 'text'))
      }
    } else {
      const desc = (selectedTask.description || '(none)').replace(/\n/g, ' ')
      detailLines.push(renderDetailField(theme, 'Description', short(desc, Math.max(12, textWidth - 16)), 'text'))
      if (latest) {
        detailLines.push(renderDetailField(theme, 'Latest note', short(latest.text.replace(/\n/g, ' '), Math.max(12, textWidth - 16)), 'text'))
      }
    }
    
    detailLines.push('')
    detailLines.push(theme.fg('dim', '👉 ') + theme.fg('accent', 'Enter ') + theme.fg('dim', 'actions'))
    return detailLines
  }

  if (state.focus === 'mailbox') {
    const selectedMailbox = selection.selectedMailbox
    if (!selectedMailbox) {
      detailLines.push(theme.fg('muted', '📬 No mailbox item selected'))
      return detailLines
    }

    const type = mailboxType(selectedMailbox)
    detailLines.push(`📬 ${theme.fg(mailboxTypeColor(type), mailboxTypeIcon(type))} ${theme.bold(theme.fg(mailboxTypeColor(type), type))}  ${theme.fg('dim', `from `)}${theme.fg('accent', selectedMailbox.from)}`)
    detailLines.push('')
    detailLines.push(renderDetailField(theme, 'Time', new Date(selectedMailbox.createdAt).toLocaleTimeString(), 'text'))
    detailLines.push(renderDetailField(theme, 'References', `${selectedMailbox.taskId ?? '-'} / ${selectedMailbox.threadId ?? '-'}`, 'text'))
    
    if (state.isDetailExpanded) {
      detailLines.push('')
      detailLines.push(renderDetailSeparator(theme, textWidth))
      detailLines.push(...renderDetailBlock(theme, 'Summary', selectedMailbox.summary ?? '(none)', textWidth, 'text'))
      detailLines.push('')
      detailLines.push(...renderDetailBlock(theme, 'Text', selectedMailbox.text || '(none)', textWidth, 'text'))
    } else {
      const summary = (selectedMailbox.summary ?? '(none)').replace(/\n/g, ' ')
      detailLines.push(renderDetailField(theme, 'Summary', short(summary, Math.max(12, textWidth - 16)), 'text'))
      const text = (selectedMailbox.text || '(none)').replace(/\n/g, ' ')
      detailLines.push(renderDetailField(theme, 'Text', short(text, Math.max(12, textWidth - 16)), 'text'))
    }
    
    detailLines.push('')
    detailLines.push(theme.fg('dim', '👉 ') + theme.fg('accent', 'Enter ') + theme.fg('dim', 'actions'))
    return detailLines
  }

  return detailLines
}

function detailReaderSubject(
  data: PanelData,
  state: TeamPanelState,
  selection: PanelSelectionView,
): string {
  if (data.mode === 'global') {
    if (state.focus === 'panes') return selection.selectedPane ? `pane ${selection.selectedPane.paneId}` : 'stale panes'
    return selection.selectedTeam ? `team ${selection.selectedTeam.name}` : 'teams'
  }
  if (state.focus === 'tasks') return selection.selectedTask ? `task ${selection.selectedTask.id}` : 'tasks'
  if (state.focus === 'mailbox') return selection.selectedMailbox ? `message from ${selection.selectedMailbox.from}` : 'mailbox'
  return selection.selectedMember ? `member ${selection.selectedMember.name}` : 'members'
}

function renderDetailReaderLines(
  theme: ExtensionContext['ui']['theme'],
  input: {
    width: number
    height?: number
    overviewLine: string
    hint: string
    data: PanelData
    state: TeamPanelState
    selection: PanelSelectionView
  },
): string[] {
  const safeHeight = Math.max(16, Math.floor(input.height ?? 40))
  const safeWidth = Math.max(56, input.width)
  const fullDetailLines = input.data.mode === 'global'
    ? renderGlobalDetailLines(theme, input.data, input.state, input.selection)
    : renderDetailLines(theme, input.data, input.state, input.selection, safeWidth)

  // overview + blank + box borders + blank + footer = 6 rows outside body.
  const bodyHeight = Math.max(4, safeHeight - 6)
  const maxOffset = Math.max(0, fullDetailLines.length - bodyHeight)
  const offset = Math.max(0, Math.min(input.state.detailScrollOffset, maxOffset))
  input.state.detailScrollOffset = offset
  const visibleDetailLines = fullDetailLines.slice(offset, offset + bodyHeight)
  const start = fullDetailLines.length === 0 ? 0 : offset + 1
  const end = Math.min(fullDetailLines.length, offset + visibleDetailLines.length)
  const scrollSuffix = `${start}-${end}/${fullDetailLines.length}${offset > 0 ? ' ↑' : ''}${offset < maxOffset ? ' ↓' : ''}`
  const detailBox = drawBox(theme, {
    width: safeWidth,
    title: `🔎 Details · ${detailReaderSubject(input.data, input.state, input.selection)} · ${scrollSuffix}`,
    lines: visibleDetailLines,
    focused: true,
  })

  return [
    input.overviewLine,
    '',
    ...detailBox,
    '',
    `  ${input.hint}`,
  ].map(line => truncateToWidth(line, input.width, ''))
}

export function renderTeamPanelLines(
  theme: ExtensionContext['ui']['theme'],
  input: RenderLayoutInput,
): string[] {
  const { width, height, data, state, selection } = input

  const safeWidth = Math.max(56, width)

  const escHint = state.interactionMode === 'action-menu'
    ? 'back'
    : state.isDetailExpanded
      ? 'collapse details'
      : 'close'
  const moveHint = state.isDetailExpanded ? 'scroll details' : 'move'
  const globalHint = theme.fg(
    'dim',
    '⌨ ') + theme.fg('accent', '↑↓ ') + theme.fg('dim', `${moveHint} · `) + theme.fg('accent', 'Tab ') + theme.fg('dim', 'section · ') + theme.fg('accent', 'Enter ') + theme.fg('dim', 'actions · ') + theme.fg('accent', 'Esc ') + theme.fg('dim', escHint)

  const overviewStr = truncateToWidth(renderOverviewLine(theme, data), width - 2)
  const overviewLine = `  ${overviewStr}`

  if (state.isDetailExpanded && state.interactionMode !== 'action-menu') {
    return renderDetailReaderLines(theme, {
      width,
      height,
      overviewLine,
      hint: globalHint,
      data,
      state,
      selection,
    })
  }

  if (data.mode === 'global') {
    const teamsLines = renderGlobalTeamLines(theme, data, state)
    const panesLines = renderGlobalPaneLines(theme, data, state)
    const detailLines = state.interactionMode === 'action-menu' && state.actionMenu
      ? renderActionMenuLines(theme, state.actionMenu)
      : renderGlobalDetailLines(theme, data, state, selection)
    const useGlobalColumns = safeWidth >= 112
    const gap = 2
    const leftWidth = useGlobalColumns ? Math.max(54, Math.floor((safeWidth - gap) * 0.45)) : safeWidth
    const rightWidth = useGlobalColumns ? Math.max(54, safeWidth - gap - leftWidth) : safeWidth
    const listHeight = Math.max(teamsLines.length, panesLines.length, 8)
    const teamsBox = drawBox(theme, {
      width: leftWidth,
      title: `🤝 Teams (${data.teams.length})${state.focus === 'teams' ? '  ✦' : ''}`,
      lines: teamsLines,
      focused: state.focus === 'teams',
      minContentLines: useGlobalColumns ? listHeight : undefined,
    })
    const panesBox = drawBox(theme, {
      width: leftWidth,
      title: `🧹 Stale panes (${data.orphanPanes.length})${state.focus === 'panes' ? '  ✦' : ''}`,
      lines: panesLines,
      focused: state.focus === 'panes',
      minContentLines: useGlobalColumns ? listHeight : undefined,
    })
    const detailsBox = drawBox(theme, {
      width: useGlobalColumns ? rightWidth : safeWidth,
      title: state.interactionMode === 'action-menu' ? '⚙ Actions' : `🔎 Details${state.isDetailExpanded ? '  expanded' : ''}`,
      lines: detailLines,
      focused: state.interactionMode === 'action-menu',
      minContentLines: useGlobalColumns ? (listHeight * 2 + 3) : undefined,
    })
    if (!useGlobalColumns) {
      return [
        overviewLine,
        '',
        ...teamsBox,
        '',
        ...panesBox,
        '',
        ...detailsBox,
        '',
        `  ${globalHint}`,
      ].map(line => truncateToWidth(line, width, ''))
    }
    const leftColumn = [...teamsBox, '', ...panesBox]
    const grid = mergeColumns(leftColumn, detailsBox, leftWidth, rightWidth, gap)
    return [
      overviewLine,
      '',
      ...grid,
      '',
      `  ${globalHint}`,
    ].map(line => truncateToWidth(line, width, ''))
  }

  const membersLines = renderMembersLines(theme, data, state)
  const taskLines = renderTaskLines(theme, state, selection)
  const mailboxLines = renderMailboxLines(theme, state, selection)
  const useTwoColumns = safeWidth >= 112
  const gap = 2
  const leftWidth = useTwoColumns ? Math.max(54, Math.floor((safeWidth - gap) * 0.45)) : safeWidth
  const rightWidth = useTwoColumns ? Math.max(54, safeWidth - gap - leftWidth) : safeWidth

  const leftListHeight = Math.max(membersLines.length, taskLines.length, 7)

  const membersBox = drawBox(theme, {
    width: leftWidth,
    title: `👥 Members (${data.members.length})${state.focus === 'members' ? '  ✦' : ''}`,
    lines: membersLines,
    focused: state.focus === 'members',
    minContentLines: useTwoColumns ? leftListHeight : undefined,
  })
  const tasksBox = drawBox(theme, {
    width: leftWidth,
    title: `📋 Tasks (${selection.visibleTasks.length})${state.focus === 'tasks' ? '  ✦' : ''}`,
    lines: taskLines,
    focused: state.focus === 'tasks',
    minContentLines: useTwoColumns ? leftListHeight : undefined,
  })
  const mailboxBox = drawBox(theme, {
    width: rightWidth,
    title: `📬 Mailbox (${selection.visibleMailbox.length})${state.focus === 'mailbox' ? '  ✦' : ''}`,
    lines: mailboxLines,
    focused: state.focus === 'mailbox',
    minContentLines: useTwoColumns ? leftListHeight : undefined,
  })

  const detailWidth = useTwoColumns ? rightWidth : safeWidth
  const detailLines = state.interactionMode === 'action-menu' && state.actionMenu
    ? renderActionMenuLines(theme, state.actionMenu)
    : renderDetailLines(theme, data, state, selection, detailWidth)
  const detailBox = drawBox(theme, {
    width: detailWidth,
    title: state.interactionMode === 'action-menu' ? '⚙ Actions' : `🔎 Details${state.isDetailExpanded ? '  expanded' : ''}`,
    lines: detailLines,
    focused: state.interactionMode === 'action-menu',
    minContentLines: useTwoColumns ? leftListHeight : undefined,
  })

  if (!useTwoColumns) {
    const lines = [
      overviewLine,
      '',
      ...membersBox,
      '',
      ...tasksBox,
      '',
      ...mailboxBox,
      '',
      ...detailBox,
      '',
      `  ${globalHint}`,
    ]
    return lines.map(line => truncateToWidth(line, width, ''))
  }

  const leftColumn = [...membersBox, '', ...tasksBox]
  const rightColumn = [...mailboxBox, '', ...detailBox]
  const grid = mergeColumns(leftColumn, rightColumn, leftWidth, rightWidth, gap)

  const lines = [
    overviewLine,
    '',
    ...grid,
    '',
    `  ${globalHint}`,
  ]

  return lines.map(line => truncateToWidth(line, width, ''))
}
