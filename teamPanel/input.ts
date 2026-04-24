import {
  Key,
  matchesKey,
} from '@mariozechner/pi-tui'
import type {
  PanelData,
  PanelSelectionView,
  TeamPanelResult,
  TeamPanelState,
} from './viewModel.js'

type TeamPanelInputDeps = {
  done: (result: TeamPanelResult) => void
  refresh: () => void
  onSyncMailbox: () => void
  requestRender: () => void
}

export function handleTeamPanelInput(
  input: string,
  data: PanelData,
  state: TeamPanelState,
  selection: PanelSelectionView,
  deps: TeamPanelInputDeps,
): void {
  const count =
    state.focus === 'members'
      ? data.members.length
      : state.focus === 'tasks'
        ? selection.visibleTasks.length
        : selection.visibleMailbox.length

  if (matchesKey(input, Key.tab)) {
    state.focus =
      state.focus === 'members'
        ? 'tasks'
        : state.focus === 'tasks'
          ? 'mailbox'
          : 'members'
    state.selectedIndex = state.focus === 'members' ? state.selectedMemberIndex : 0
    deps.requestRender()
    return
  }

  if (matchesKey(input, Key.up)) {
    state.selectedIndex = Math.max(0, state.selectedIndex - 1)
    if (state.focus === 'members') state.selectedMemberIndex = state.selectedIndex
    deps.requestRender()
    return
  }

  if (matchesKey(input, Key.down)) {
    state.selectedIndex = Math.min(Math.max(0, count - 1), state.selectedIndex + 1)
    if (state.focus === 'members') state.selectedMemberIndex = state.selectedIndex
    deps.requestRender()
    return
  }

  if (matchesKey(input, Key.escape) || input === 'q') {
    deps.done({ type: 'close' })
    return
  }

  if (input === 'r') {
    state.footerHint = 'Refreshed'
    deps.refresh()
    return
  }

  if (input === 's') {
    state.footerHint = 'Mailbox synced'
    deps.onSyncMailbox()
    deps.refresh()
    return
  }

  if (input === 'o') {
    state.isDetailExpanded = !state.isDetailExpanded
    state.footerHint = state.isDetailExpanded ? 'Details expanded' : 'Details collapsed'
    deps.requestRender()
    return
  }

  if (input === 'l') {
    if (data.leader?.sessionFile) {
      deps.done({ type: 'open-leader-session', sessionFile: data.leader.sessionFile })
    }
    return
  }

  if (!matchesKey(input, Key.enter)) return

  if (state.focus === 'members') {
    const member = data.members[state.selectedMemberIndex]
    if (member?.sessionFile) {
      deps.done({ type: 'open-session', sessionFile: member.sessionFile })
    }
    return
  }

  if (state.focus === 'tasks') {
    state.footerHint = 'Task selected (view details below)'
    deps.requestRender()
    return
  }

  if (state.focus === 'mailbox') {
    const item = selection.visibleMailbox[state.selectedIndex]
    if (item?.taskId) {
      deps.done({ type: 'open-task', taskId: item.taskId })
      return
    }
    state.footerHint = 'Mailbox item selected (view details below)'
    deps.requestRender()
  }
}
