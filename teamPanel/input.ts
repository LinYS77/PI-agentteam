import {
  Key,
  matchesKey,
} from '@mariozechner/pi-tui'
import { buildPanelActions } from './actions.js'
import type {
  PanelData,
  PanelSelectionView,
  TeamPanelResult,
  TeamPanelState,
} from './viewModel.js'

type TeamPanelInputDeps = {
  done: (result: TeamPanelResult) => void
  refresh: () => void
  requestRender: () => void
}

function sectionCount(
  data: PanelData,
  state: TeamPanelState,
  selection: PanelSelectionView,
): number {
  if (data.mode === 'global') {
    return state.focus === 'panes' ? data.orphanPanes.length : data.teams.length
  }
  return state.focus === 'members'
    ? data.members.length
    : state.focus === 'tasks'
      ? selection.visibleTasks.length
      : selection.visibleMailbox.length
}

function cycleSection(data: PanelData, state: TeamPanelState): void {
  if (data.mode === 'global') {
    state.focus = state.focus === 'teams' ? 'panes' : 'teams'
    state.selectedIndex = state.focus === 'teams' ? state.selectedTeamIndex : state.selectedPaneIndex
    return
  }

  state.focus =
    state.focus === 'members'
      ? 'tasks'
      : state.focus === 'tasks'
        ? 'mailbox'
        : 'members'
  state.selectedIndex = state.focus === 'members' ? state.selectedMemberIndex : 0
}

function syncStoredIndex(data: PanelData, state: TeamPanelState): void {
  if (data.mode === 'global') {
    if (state.focus === 'teams') state.selectedTeamIndex = state.selectedIndex
    if (state.focus === 'panes') state.selectedPaneIndex = state.selectedIndex
    return
  }
  if (state.focus === 'members') state.selectedMemberIndex = state.selectedIndex
}

function resetDetailScroll(state: TeamPanelState): void {
  state.detailScrollOffset = 0
}

function handleActionMenuInput(
  input: string,
  state: TeamPanelState,
  deps: TeamPanelInputDeps,
): void {
  const menu = state.actionMenu
  if (!menu) {
    state.interactionMode = 'browse'
    deps.requestRender()
    return
  }

  if (matchesKey(input, Key.escape) || input === 'q') {
    state.interactionMode = 'browse'
    state.actionMenu = undefined
    deps.requestRender()
    return
  }

  if (matchesKey(input, Key.up)) {
    menu.selectedIndex = Math.max(0, menu.selectedIndex - 1)
    deps.requestRender()
    return
  }

  if (matchesKey(input, Key.down)) {
    menu.selectedIndex = Math.min(Math.max(0, menu.actions.length - 1), menu.selectedIndex + 1)
    deps.requestRender()
    return
  }

  if (!matchesKey(input, Key.enter)) return

  const action = menu.actions[menu.selectedIndex]
  if (!action) return

  if (action.id === 'toggle-details') {
    state.isDetailExpanded = !state.isDetailExpanded
    resetDetailScroll(state)
    state.interactionMode = 'browse'
    state.actionMenu = undefined
    deps.requestRender()
    return
  }

  if (action.id === 'refresh') {
    state.interactionMode = 'browse'
    state.actionMenu = undefined
    deps.refresh()
    return
  }

  if (action.result) {
    deps.done(action.result)
  }
}

export function handleTeamPanelInput(
  input: string,
  data: PanelData,
  state: TeamPanelState,
  selection: PanelSelectionView,
  deps: TeamPanelInputDeps,
): void {
  if (state.interactionMode === 'action-menu') {
    handleActionMenuInput(input, state, deps)
    return
  }

  const count = sectionCount(data, state, selection)

  if (matchesKey(input, Key.tab)) {
    cycleSection(data, state)
    resetDetailScroll(state)
    deps.requestRender()
    return
  }

  if (state.isDetailExpanded && matchesKey(input, Key.up)) {
    state.detailScrollOffset = Math.max(0, state.detailScrollOffset - 1)
    deps.requestRender()
    return
  }

  if (state.isDetailExpanded && matchesKey(input, Key.down)) {
    state.detailScrollOffset += 1
    deps.requestRender()
    return
  }

  if (matchesKey(input, Key.up)) {
    state.selectedIndex = Math.max(0, state.selectedIndex - 1)
    syncStoredIndex(data, state)
    resetDetailScroll(state)
    deps.requestRender()
    return
  }

  if (matchesKey(input, Key.down)) {
    state.selectedIndex = Math.min(Math.max(0, count - 1), state.selectedIndex + 1)
    syncStoredIndex(data, state)
    resetDetailScroll(state)
    deps.requestRender()
    return
  }

  if (matchesKey(input, Key.escape) || input === 'q') {
    if (state.isDetailExpanded) {
      state.isDetailExpanded = false
      resetDetailScroll(state)
      deps.requestRender()
      return
    }
    deps.done({ type: 'close' })
    return
  }

  if (!matchesKey(input, Key.enter)) return

  const menu = buildPanelActions(data, state, selection)
  state.interactionMode = 'action-menu'
  state.actionMenu = {
    ...menu,
    selectedIndex: 0,
  }
  deps.requestRender()
}
