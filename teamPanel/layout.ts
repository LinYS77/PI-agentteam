import type { ExtensionContext } from '@mariozechner/pi-coding-agent'
import {
  truncateToWidth,
  visibleWidth,
} from '@mariozechner/pi-tui'
import type {
  TeamMember,
  TeamTask,
} from '../types.js'
import type {
  FocusSection,
  LeaderMailboxItem,
  PanelData,
  PanelSelectionView,
  TeamPanelState,
} from './viewModel.js'
import { mailboxType } from './viewModel.js'

type RenderLayoutInput = {
  width: number
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
  const borderColor = options.focused ? 'accent' : 'dim'
  const px = options.paddingX ?? 2
  const py = options.paddingY ?? 0
  const padStr = ' '.repeat(px)
  const contentInner = Math.max(0, inner - px * 2)

  const titleText = ` ${options.title} `
  let top = ''
  if (options.focused) {
    const leftPad = Math.max(0, Math.floor((inner - visibleWidth(titleText)) / 2))
    const rightPad = Math.max(0, inner - visibleWidth(titleText) - leftPad)
    const centeredTitle = '─'.repeat(leftPad) + theme.bold(titleText) + '─'.repeat(rightPad)
    top = theme.fg('accent', `╭${centeredTitle}╮`)
  } else {
    const title = truncateToWidth(titleText, inner)
    const topFill = '─'.repeat(Math.max(0, inner - visibleWidth(title)))
    top = theme.fg(borderColor, `╭${theme.bold(title)}${topFill}╮`)
  }

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

function detailKV(
  theme: ExtensionContext['ui']['theme'],
  label: string,
  value: string,
  color: 'dim' | 'accent' | 'warning' | 'error' | 'success' | 'text' = 'dim',
): string {
  const key = `${padCell(`${label}:`, 15)}`
  return `${theme.fg('dim', key)} ${theme.fg(color, value)}`
}

function renderOverviewLine(theme: ExtensionContext['ui']['theme'], data: PanelData, focus: FocusSection): string {
  const runningCount = data.members.filter(member => member.status === 'running').length
  const queuedCount = data.members.filter(member => member.status === 'queued').length
  const idleCount = data.members.filter(member => member.status === 'idle').length
  const errorCount = data.members.filter(member => member.status === 'error').length

  const pendingCount = data.tasks.filter(task => task.status === 'pending').length
  const inProgressCount = data.tasks.filter(task => task.status === 'in_progress').length
  const blockedCount = data.tasks.filter(task => task.status === 'blocked').length
  const completedCount = data.tasks.filter(task => task.status === 'completed').length

  const blockedMsgCount = data.mailbox.filter(item => mailboxType(item) === 'blocked').length
  const unreadMsgCount = data.mailbox.filter(item => !item.readAt).length

  const tName = theme.bold(theme.fg('text', `✦  ${data.team.name} `))

  const mStatus = `${theme.fg('warning', `⟳ ${runningCount}`)} ${theme.fg('accent', `⋯ ${queuedCount}`)} ${theme.fg('dim', `○ ${idleCount}`)}${errorCount ? ` ${theme.fg('error', `⚠ ${errorCount}`)}` : ''}`
  const tStatus = `${theme.fg('dim', `○ ${pendingCount}`)} ${theme.fg('warning', `⟳ ${inProgressCount}`)} ${theme.fg('error', `⚠ ${blockedCount}`)} ${theme.fg('success', `✔ ${completedCount}`)}`
  const sStatus = `${theme.fg(unreadMsgCount > 0 ? 'warning' : 'dim', `${unreadMsgCount} unread`)} · ${theme.fg(blockedMsgCount > 0 ? 'error' : 'dim', `${blockedMsgCount} blocked`)} · total ${data.mailbox.length}`

  return `${tName} ${theme.fg('dim', '│')} 👥 Members  ${mStatus}  ${theme.fg('dim', '│')} 📋 Tasks  ${tStatus}  ${theme.fg('dim', '│')} 📬 Mail  ${sStatus}`
}

function renderMembersLines(
  theme: ExtensionContext['ui']['theme'],
  data: PanelData,
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
    
    const unread = data.mailbox.filter(m => m.from === member.name && !m.readAt).length
    const activeTasks = data.tasks.filter(t => t.owner === member.name && t.status !== 'completed').length
    const ageStr = formatAge(Date.now() - member.updatedAt)
    
    const statsStr = theme.fg('dim', `${short(member.role, 10)} · ✉ ${unread} · 📝 ${activeTasks} · ⏱ ${ageStr}`)
    const nameStr = short(member.name, 14)
    const nameCol = isSelected ? padCell(theme.bold(theme.fg('accent', nameStr)), 14) : padCell(theme.fg('text', nameStr), 14)
    
    lines.push(
      `${pointer}  ${nameCol} ${memberStatusBadge(theme, member.status)}  ${statsStr}`,
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
    
    lines.push(
      `${pointer}  ${idCol}  ${taskStatusBadge(theme, task.status)}  ${titleCol}  ${ownerCol}`,
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
    
    const isUnread = !item.readAt
    const summaryText = short(item.summary ?? item.text, 36)
    const summaryFmt = isUnread ? theme.bold(theme.fg('text', summaryText)) : theme.fg('dim', summaryText)
    const summaryCol = padCell(summaryFmt, 36)
    
    const timeStr = theme.fg('dim', new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))

    lines.push(
      `${pointer}  ${icon}  ${fromCol}  ${summaryCol}  ${timeStr}`,
    )
  }

  const hiddenBelow = selection.visibleMailbox.length - (mailboxWindow.offset + mailboxWindow.items.length)
  if (hiddenBelow > 0) {
    lines.push(theme.fg('dim', `… ${hiddenBelow} below`))
  }

  return lines
}

function wordWrap(text: string, width: number): string[] {
  if (!text) return ['']
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= width) {
      currentLine += (currentLine.length > 0 ? ' ' : '') + word
    } else {
      if (currentLine) lines.push(currentLine)
      currentLine = word
    }
  }
  if (currentLine) lines.push(currentLine)
  return lines
}

function renderDetailLines(
  theme: ExtensionContext['ui']['theme'],
  data: PanelData,
  state: TeamPanelState,
  selection: PanelSelectionView,
  width: number,
): string[] {
  const detailLines: string[] = []
  const textWidth = Math.max(20, width - 6) // Leave room for box borders and padding

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
    detailLines.push(detailKV(theme, 'Tasks', String(activeTasks), 'text'))
    detailLines.push(detailKV(theme, 'Mailbox', String(msgCount), 'text'))
    detailLines.push(detailKV(theme, 'Session', basename(selectedMember.sessionFile), 'text'))
    if (selectedMember.lastWakeReason) detailLines.push(detailKV(theme, 'Wake', selectedMember.lastWakeReason, 'text'))
    if (selectedMember.lastError) detailLines.push(detailKV(theme, 'Error', selectedMember.lastError, 'error'))
    
    detailLines.push('')
    detailLines.push(theme.fg('dim', '👉 ') + theme.fg('accent', 'Enter ') + theme.fg('dim', 'focus pane · ') + theme.fg('accent', 'l ') + theme.fg('dim', 'focus leader'))
    return detailLines
  }

  if (state.focus === 'tasks') {
    const selectedTask = selection.selectedTask
    if (!selectedTask) {
      detailLines.push(theme.fg('muted', '📋 No task selected'))
      return detailLines
    }

    detailLines.push(`📋 ${theme.bold(theme.fg('accent', selectedTask.id))}  ${taskStatusBadge(theme, selectedTask.status)}  ${theme.fg('text', short(selectedTask.title, textWidth - 25))}`)
    detailLines.push('')
    detailLines.push(detailKV(theme, 'Owner', selectedTask.owner ?? '-', 'text'))
    if (selectedTask.blockedBy.length > 0) {
      detailLines.push(detailKV(theme, 'Blocked by', selectedTask.blockedBy.join(','), 'error'))
    }
    
    if (state.isDetailExpanded) {
      detailLines.push(detailKV(theme, 'Description', ''))
      const descLines = (selectedTask.description || '(none)').split('\n')
      for (const dLine of descLines) {
        wordWrap(dLine, textWidth - 17).forEach(wLine => detailLines.push(`                 ${theme.fg('text', wLine)}`))
      }

      const latest = selectedTask.notes[selectedTask.notes.length - 1]
      if (latest) {
        detailLines.push(detailKV(theme, `Note (${latest.author})`, ''))
        const noteLines = latest.text.split('\n')
        for (const nLine of noteLines) {
          wordWrap(nLine, textWidth - 17).forEach(wLine => detailLines.push(`                 ${theme.fg('text', wLine)}`))
        }
      }
    } else {
      const desc = (selectedTask.description || '(none)').replace(/\n/g, ' ')
      detailLines.push(detailKV(theme, 'Description', short(desc, textWidth - 18), 'text'))
      const latest = selectedTask.notes[selectedTask.notes.length - 1]
      if (latest) {
        detailLines.push(detailKV(theme, 'Latest note', short(latest.text.replace(/\n/g, ' '), textWidth - 18), 'text'))
      }
    }
    
    detailLines.push('')
    detailLines.push(theme.fg('dim', '👉 ') + theme.fg('accent', '↑↓ ') + theme.fg('dim', 'select task · ') + theme.fg('accent', 'o ') + theme.fg('dim', 'toggle details'))
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
    detailLines.push(detailKV(theme, 'Time', new Date(selectedMailbox.createdAt).toLocaleTimeString(), 'text'))
    detailLines.push(detailKV(theme, 'References', `${selectedMailbox.taskId ?? '-'} / ${selectedMailbox.threadId ?? '-'}`, 'text'))
    
    if (state.isDetailExpanded) {
      detailLines.push(detailKV(theme, 'Summary', ''))
      const summaryLines = (selectedMailbox.summary ?? '(none)').split('\n')
      for (const sLine of summaryLines) {
        wordWrap(sLine, textWidth - 17).forEach(wLine => detailLines.push(`                 ${theme.fg('text', wLine)}`))
      }

      detailLines.push(detailKV(theme, 'Text', ''))
      const textLines = (selectedMailbox.text || '(none)').split('\n')
      for (const tLine of textLines) {
        wordWrap(tLine, textWidth - 17).forEach(wLine => detailLines.push(`                 ${theme.fg('text', wLine)}`))
      }
    } else {
      const summary = (selectedMailbox.summary ?? '(none)').replace(/\n/g, ' ')
      detailLines.push(detailKV(theme, 'Summary', short(summary, textWidth - 18), 'text'))
      const text = (selectedMailbox.text || '(none)').replace(/\n/g, ' ')
      detailLines.push(detailKV(theme, 'Text', short(text, textWidth - 18), 'text'))
    }
    
    detailLines.push('')
    detailLines.push(theme.fg('dim', '👉 ') + theme.fg('accent', 's ') + theme.fg('dim', 'sync · ') + theme.fg('accent', 'o ') + theme.fg('dim', 'toggle details'))
    return detailLines
  }

  return detailLines
}

export function renderTeamPanelLines(
  theme: ExtensionContext['ui']['theme'],
  input: RenderLayoutInput,
): string[] {
  const { width, data, state, selection } = input

  const safeWidth = Math.max(56, width)
  const membersLines = renderMembersLines(theme, data, state)
  const taskLines = renderTaskLines(theme, state, selection)
  const mailboxLines = renderMailboxLines(theme, state, selection)
  const detailLines = renderDetailLines(theme, data, state, selection, safeWidth)

  const globalHint = theme.fg(
    'dim',
    '⌨ ') + theme.fg('accent', '↑↓ ') + theme.fg('dim', 'move · ') + theme.fg('accent', 'Tab ') + theme.fg('dim', 'cycle section · ') + theme.fg('accent', 'Enter ') + theme.fg('dim', 'open/focus target · ') + theme.fg('accent', 'r ') + theme.fg('dim', 'refresh · ') + theme.fg('accent', 's ') + theme.fg('dim', 'sync · ') + theme.fg('accent', 'Esc ') + theme.fg('dim', 'close')

  const overviewStr = truncateToWidth(renderOverviewLine(theme, data, state.focus), width - 2)
  const overviewLine = `  ${overviewStr}`

  const useTwoColumns = safeWidth >= 112
  const gap = 2
  const leftWidth = useTwoColumns ? Math.max(54, Math.floor((safeWidth - gap) / 2)) : safeWidth
  const rightWidth = useTwoColumns ? Math.max(54, safeWidth - gap - leftWidth) : safeWidth

  const topGridHeight = Math.max(membersLines.length, mailboxLines.length, 6)
  const bottomGridHeight = Math.max(taskLines.length, 6)

  const membersBox = drawBox(theme, {
    width: leftWidth,
    title: `👥 Members (${data.members.length})${state.focus === 'members' ? '  ✦' : ''}`,
    lines: membersLines,
    focused: state.focus === 'members',
    minContentLines: useTwoColumns ? topGridHeight : undefined,
  })
  const tasksBox = drawBox(theme, {
    width: leftWidth,
    title: `📋 Tasks (${selection.visibleTasks.length})${state.focus === 'tasks' ? '  ✦' : ''}`,
    lines: taskLines,
    focused: state.focus === 'tasks',
    minContentLines: useTwoColumns ? bottomGridHeight : undefined,
  })
  const mailboxBox = drawBox(theme, {
    width: rightWidth,
    title: `📬 Mailbox (${selection.visibleMailbox.length})${state.focus === 'mailbox' ? '  ✦' : ''}`,
    lines: mailboxLines,
    focused: state.focus === 'mailbox',
    minContentLines: useTwoColumns ? Math.max(topGridHeight, bottomGridHeight) : undefined,
  })

  const detailBox = drawBox(theme, {
    width: safeWidth,
    title: '🔎 Details',
    lines: detailLines,
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
  const rightColumn = [...mailboxBox]
  const grid = mergeColumns(leftColumn, rightColumn, leftWidth, rightWidth, gap)

  const lines = [
    overviewLine,
    '',
    ...grid,
    '',
    ...detailBox,
    '',
    `  ${globalHint}`,
  ]

  return lines.map(line => truncateToWidth(line, width, ''))
}
