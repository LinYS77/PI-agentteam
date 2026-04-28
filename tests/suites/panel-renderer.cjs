const assert = require('node:assert/strict')

module.exports = {
  name: 'panel + renderer',
  async run(env) {
    const { modules, helpers, patches } = env
    patches.livePanes.add('%1')
    patches.livePanes.add('%2')

    const team = modules.state.createInitialTeamState({
      teamName: 'render-suite',
      leaderSessionFile: '/tmp/leader-render.jsonl',
      leaderCwd: '/tmp',
      description: 'render test',
    })
    modules.state.upsertMember(team, {
      name: 'researcher-very-long-member-name-alpha',
      role: 'researcher',
      cwd: '/tmp',
      sessionFile: '/tmp/r1.jsonl',
      status: 'running',
      paneId: '%1',
      windowTarget: 'test:@1',
      lastWakeReason: 'mailbox/task update',
    })
    modules.state.upsertMember(team, {
      name: 'planner-very-long-member-name-beta',
      role: 'planner',
      cwd: '/tmp',
      sessionFile: '/tmp/p1.jsonl',
      status: 'idle',
      paneId: '%2',
      windowTarget: 'test:@1',
    })
    const task = modules.state.createTask(team, {
      title: 'A very long task title that should be truncated safely in narrow layout',
      description: 'Long description for rendering',
    })
    task.owner = 'researcher-very-long-member-name-alpha'
    task.status = 'in_progress'
    task.updatedAt = Date.now()
    const blockedTask = modules.state.createTask(team, {
      title: 'Blocked task should be visible in attention summary',
      description: 'Blocked task for attention rendering',
    })
    blockedTask.owner = 'planner-very-long-member-name-beta'
    blockedTask.status = 'blocked'
    blockedTask.blockedBy.push('missing decision')
    const unownedTask = modules.state.createTask(team, {
      title: 'Unowned active task should be visible in attention summary',
      description: 'Unowned active task for attention rendering',
    })
    unownedTask.status = 'pending'
    modules.state.writeTeamState(team)
    const blockedMailbox = modules.state.pushMailboxMessage(team.name, 'team-lead', {
      from: 'planner-very-long-member-name-beta',
      to: 'team-lead',
      type: 'blocked',
      priority: 'high',
      taskId: blockedTask.id,
      summary: 'Blocked on missing decision',
      text: 'Blocked on missing decision',
    })
    modules.state.pushMailboxMessage(team.name, 'team-lead', {
      from: 'researcher-very-long-member-name-alpha',
      to: 'team-lead',
      type: 'completion_report',
      taskId: task.id,
      summary: 'Unread research result',
      text: 'Unread research result',
    })

    const data = modules.viewModel.loadPanelData('render-suite')
    assert.ok(data, 'panel data should load')
    const state = modules.viewModel.createInitialPanelState()
    modules.viewModel.clampPanelStateToData(state, data)
    let selection = modules.viewModel.buildPanelSelectionView(data, state)
    assert.ok(selection.selectedMember, 'member details should be available when members section is focused')
    assert.ok(selection.selectedTask, 'task details should be available even when tasks section is not focused')
    assert.equal(selection.selectedMailbox?.id, blockedMailbox.id, 'mailbox defaults should show urgent blocked messages first')

    const summary = modules.viewModel.buildTeamAttentionSummary(data.team, data.mailbox)
    assert.equal(summary.blockedTasks, 1, 'attention summary should count blocked tasks')
    assert.equal(summary.blockedMessages, 1, 'attention summary should count blocked messages')
    assert.equal(summary.unreadMessages, 2, 'attention summary should count unread leader mailbox messages')
    assert.equal(summary.unownedActiveTasks, 1, 'attention summary should count unowned active tasks')

    state.focus = 'tasks'
    state.selectedIndex = 0
    selection = modules.viewModel.buildPanelSelectionView(data, state)
    assert.equal(selection.selectedTask?.id, task.id, 'task details should follow task selection')

    const attachedLines = modules.layout.renderTeamPanelLines(helpers.createFakeTheme(), { width: 180, height: 40, data, state, selection })
    assert.ok(attachedLines.some(line => line.includes('Attention') && line.includes('blocked task')), 'overview should include blocked task attention')
    assert.ok(attachedLines.some(line => line.includes('unread')), 'overview/list should include unread attention')
    assert.ok(attachedLines.some(line => line.includes('unowned')), 'overview/list should include unowned task attention')

    state.focus = 'tasks'
    state.selectedIndex = data.tasks.findIndex(item => item.id === blockedTask.id)
    selection = modules.viewModel.buildPanelSelectionView(data, state)
    const blockedTaskLines = modules.layout.renderTeamPanelLines(helpers.createFakeTheme(), { width: 180, height: 40, data, state, selection })
    assert.ok(blockedTaskLines.some(line => line.includes(blockedTask.id) && line.includes('blocked')), 'blocked task row should include attention marker')

    state.selectedIndex = data.tasks.findIndex(item => item.id === unownedTask.id)
    selection = modules.viewModel.buildPanelSelectionView(data, state)
    const unownedTaskLines = modules.layout.renderTeamPanelLines(helpers.createFakeTheme(), { width: 180, height: 40, data, state, selection })
    assert.ok(unownedTaskLines.some(line => line.includes(unownedTask.id) && line.includes('unowned')), 'unowned task row should include attention marker')

    state.focus = 'mailbox'
    state.selectedIndex = 0
    selection = modules.viewModel.buildPanelSelectionView(data, state)
    const mailboxLines = modules.layout.renderTeamPanelLines(helpers.createFakeTheme(), { width: 180, height: 40, data, state, selection })
    assert.ok(mailboxLines.some(line => line.includes('Blocked on missing decision') && line.includes('unread') && line.includes('blocked')), 'blocked unread mailbox row should include attention markers')

    const plannerMemberIndex = data.members.findIndex(item => item.name === 'planner-very-long-member-name-beta')
    assert.ok(plannerMemberIndex >= 0, 'planner member should be present')
    state.focus = 'members'
    state.selectedMemberIndex = plannerMemberIndex
    state.selectedIndex = plannerMemberIndex
    selection = modules.viewModel.buildPanelSelectionView(data, state)
    const memberLines = modules.layout.renderTeamPanelLines(helpers.createFakeTheme(), { width: 180, height: 40, data, state, selection })
    assert.ok(memberLines.some(line => line.includes('planner-very') && line.includes('blocked')), 'member row should show blocked-owned attention')
    assert.ok(memberLines.some(line => line.includes('pane %2') && line.includes('tasks 1') && line.includes('age')), 'member row should show stable health fields')
    assert.ok(memberLines.some(line => line.includes('Health') && line.includes('idle')), 'member details should show health label')
    assert.ok(memberLines.some(line => line.includes('Pane') && line.includes('%2')), 'member details should show pane id')
    assert.ok(memberLines.some(line => line.includes('Updated') && line.includes('ago')), 'member details should show updated age')

    const noPaneTeam = modules.state.readTeamState('render-suite')
    noPaneTeam.members['planner-very-long-member-name-beta'].paneId = undefined
    modules.state.writeTeamState(noPaneTeam)
    const noPaneData = modules.viewModel.loadPanelData('render-suite')
    const noPaneState = modules.viewModel.createInitialPanelState()
    const noPanePlannerIndex = noPaneData.members.findIndex(item => item.name === 'planner-very-long-member-name-beta')
    assert.ok(noPanePlannerIndex >= 0, 'planner member should be present after no-pane update')
    noPaneState.focus = 'members'
    noPaneState.selectedMemberIndex = noPanePlannerIndex
    noPaneState.selectedIndex = noPanePlannerIndex
    const noPaneSelection = modules.viewModel.buildPanelSelectionView(noPaneData, noPaneState)
    const noPaneLines = modules.layout.renderTeamPanelLines(helpers.createFakeTheme(), { width: 180, height: 40, data: noPaneData, state: noPaneState, selection: noPaneSelection })
    assert.ok(noPaneLines.some(line => line.includes('planner-very') && line.includes('no pane')), 'member row should show no pane marker')
    assert.ok(noPaneLines.some(line => line.includes('Health') && line.includes('no pane')), 'member details should show no pane health')

    const actions = helpers.requireDist('teamPanel/actions.js')
    const input = helpers.requireDist('teamPanel/input.js')
    const keys = helpers.tuiKeys
    const actionMenu = actions.buildPanelActions(data, state, selection)
    assert.ok(actionMenu.actions.some(action => action.id === 'sync'), 'attached panel should expose sync as an Enter action')
    assert.ok(actionMenu.actions.some(action => action.id === 'delete-team'), 'attached panel should expose delete as an Enter action')
    assert.ok(actionMenu.actions.some(action => action.id === 'delete-team' && action.label.includes('render-suite')), 'attached delete action should name the current team')
    assert.ok(actionMenu.actions.some(action => action.id === 'remove-member' && action.label.includes('planner-very-long-member-name-beta')), 'remove action should name the selected teammate')
    assert.ok(actionMenu.actions.some(action => action.danger && String(action.description).includes('pane is never killed')), 'danger actions should spell out current pane safety')
    assert.ok(!actionMenu.actions.some(action => action.id === 'back'), 'action menu should rely on Esc, not a Back item')
    assert.ok(!actionMenu.actions.some(action => String(action.id).includes('focus')), 'panel action menu should not expose pane focus')

    state.isDetailExpanded = true
    let closed = false
    input.handleTeamPanelInput(keys.escape, data, state, selection, {
      done: () => { closed = true },
      refresh: () => {},
      requestRender: () => {},
    })
    assert.equal(closed, false, 'Esc should collapse expanded details before closing panel')
    assert.equal(state.isDetailExpanded, false, 'Esc should collapse details')
    input.handleTeamPanelInput(keys.escape, data, state, selection, {
      done: result => { closed = result.type === 'close' },
      refresh: () => {},
      requestRender: () => {},
    })
    assert.equal(closed, true, 'Esc should close panel after details are collapsed')

    const cleanTeam = modules.state.createInitialTeamState({
      teamName: 'render-clean-suite',
      leaderSessionFile: '/tmp/leader-clean-render.jsonl',
      leaderCwd: '/tmp',
      description: 'clean render test',
    })
    modules.state.upsertMember(cleanTeam, {
      name: 'clean-implementer',
      role: 'implementer',
      cwd: '/tmp',
      sessionFile: '/tmp/clean-impl.jsonl',
      status: 'idle',
    })
    const cleanTask = modules.state.createTask(cleanTeam, {
      title: 'Completed clean render task',
      description: 'No attention expected',
    })
    cleanTask.owner = 'clean-implementer'
    cleanTask.status = 'completed'
    modules.state.writeTeamState(cleanTeam)
    const cleanMessage = modules.state.pushMailboxMessage(cleanTeam.name, 'team-lead', {
      from: 'clean-implementer',
      to: 'team-lead',
      type: 'completion_report',
      taskId: cleanTask.id,
      summary: 'Already read clean completion',
      text: 'Already read clean completion',
      deliveredAt: Date.now(),
      readAt: Date.now(),
    })
    assert.ok(cleanMessage.readAt, 'clean team mailbox fixture should be read')

    const globalData = modules.viewModel.loadPanelData(null)
    const globalState = modules.viewModel.createInitialPanelState()
    modules.viewModel.clampPanelStateToData(globalState, globalData)
    assert.equal(globalData.mode, 'global', 'missing current team should open global console data')
    assert.equal(globalState.focus, 'teams', 'global console should start on teams')
    const renderSuiteTeamIndex = globalData.teams.findIndex(item => item.name === 'render-suite')
    assert.ok(renderSuiteTeamIndex >= 0, 'render-suite should be present in global data')
    globalState.selectedTeamIndex = renderSuiteTeamIndex
    globalState.selectedIndex = renderSuiteTeamIndex
    const globalSelection = modules.viewModel.buildPanelSelectionView(globalData, globalState)
    const globalActions = actions.buildPanelActions(globalData, globalState, globalSelection)
    assert.ok(globalActions.actions.some(action => action.id === 'recover-team'), 'global console should expose recover action for selected team')
    assert.ok(globalActions.actions.some(action => action.id === 'recover-team' && action.label.includes('render-suite')), 'recover action should name the selected team')
    assert.ok(globalActions.actions.some(action => action.id === 'delete-team' && action.label.includes('render-suite')), 'global delete action should name the selected team')
    assert.ok(globalActions.actions.some(action => action.id === 'cleanup-all'), 'global console should expose cleanup action')
    assert.ok(globalActions.actions.some(action => action.id === 'cleanup-all' && action.label.includes('ALL')), 'cleanup action should make global scope obvious')
    assert.ok(globalActions.actions.some(action => action.danger && String(action.description).includes('pane is never killed')), 'global danger actions should spell out current pane safety')
    assert.ok(!globalActions.actions.some(action => action.id === 'back'), 'global action menu should not include Back')
    assert.ok(globalData.teamSummaries['render-suite'], 'global data should include per-team attention summaries')
    assert.equal(globalData.teamMailboxes['render-suite'].unread, 2, 'global data should include unread mailbox projection')
    assert.equal(globalData.teamMailboxes['render-suite'].blocked, 1, 'global data should include blocked mailbox projection')
    const globalLines = modules.layout.renderTeamPanelLines(helpers.createFakeTheme(), { width: 180, height: 40, data: globalData, state: globalState, selection: globalSelection })
    assert.ok(globalLines.some(line => line.includes('Attention') && line.includes('blocked task')), 'global overview should summarize team attention')
    assert.ok(globalLines.some(line => line.includes('render-suite') && line.includes('✉')), 'global team row should show compact attention markers')
    assert.equal(globalLines.some(line => line.includes('render-suite') && line.includes('leader missing')), false, 'global team row should keep leader pane diagnostics in details')
    assert.ok(globalLines.some(line => line.includes('render-clean-suite') && line.includes('OK')), 'clean global team row should show OK')
    assert.ok(globalLines.some(line => line.includes('Attention') && line.includes('+')), 'global overview should fold lower-priority attention categories')
    assert.ok(globalLines.some(line => line.includes('Health') && line.includes('no pane')), 'global team details should include teammate health breakdown')
    assert.ok(globalLines.some(line => line.includes('Tasks') && line.includes('pending') && line.includes('unowned')), 'global team details should include task breakdown')
    assert.ok(globalLines.some(line => line.includes('Mailbox') && line.includes('unread 2') && line.includes('blocked 1')), 'global team details should include mailbox breakdown')
    assert.ok(globalLines.some(line => line.includes('Latest mail attention')), 'global team details should show latest mail attention source')
    assert.ok(globalLines.some(line => line.includes('Roster')), 'global team details should include roster preview')
    assert.ok(globalLines.some(line => line.includes('planner-very') && line.includes('planner') && line.includes('no pane')), 'global roster preview should align health/name/role/pane fields')

    modules.tmux.listAgentTeamPanes = () => [{ paneId: '%orphan', target: 'test:@1', label: 'agentteam orphan label', currentCommand: 'pi' }]
    const stalePaneData = modules.viewModel.loadPanelData(null)
    const stalePaneState = modules.viewModel.createInitialPanelState()
    stalePaneState.focus = 'panes'
    stalePaneState.selectedPaneIndex = 0
    modules.viewModel.clampPanelStateToData(stalePaneState, stalePaneData)
    const stalePaneSelection = modules.viewModel.buildPanelSelectionView(stalePaneData, stalePaneState)
    const stalePaneLines = modules.layout.renderTeamPanelLines(helpers.createFakeTheme(), { width: 180, height: 40, data: stalePaneData, state: stalePaneState, selection: stalePaneSelection })
    assert.ok(stalePaneLines.some(line => line.includes('%orphan') && line.includes('agentteam orphan label')), 'global stale pane list should show orphan label')
    assert.ok(stalePaneLines.some(line => line.includes('State') && line.includes('stale agentteam-labeled pane')), 'global stale pane details should show stale pane state')
    modules.tmux.listAgentTeamPanes = () => []

    const paneLostTeam = modules.state.readTeamState('render-suite')
    modules.state.updateMemberStatus(paneLostTeam, 'researcher-very-long-member-name-alpha', {
      status: 'error',
      paneId: undefined,
      lastWakeReason: 'pane lost',
      lastError: 'tmux pane disappeared',
    })
    modules.state.writeTeamState(paneLostTeam)
    const paneLostData = modules.viewModel.loadPanelData('render-suite')
    const paneLostState = modules.viewModel.createInitialPanelState()
    const paneLostMemberIndex = paneLostData.members.findIndex(item => item.name === 'researcher-very-long-member-name-alpha')
    assert.ok(paneLostMemberIndex >= 0, 'researcher member should be present after pane-lost update')
    paneLostState.selectedMemberIndex = paneLostMemberIndex
    modules.viewModel.clampPanelStateToData(paneLostState, paneLostData)
    const paneLostSelection = modules.viewModel.buildPanelSelectionView(paneLostData, paneLostState)
    assert.equal(modules.viewModel.buildTeamAttentionSummary(paneLostData.team, paneLostData.mailbox).paneLostMembers, 1, 'attention summary should count pane-lost members')
    const paneLostLines = modules.layout.renderTeamPanelLines(helpers.createFakeTheme(), { width: 180, height: 40, data: paneLostData, state: paneLostState, selection: paneLostSelection })
    assert.ok(paneLostLines.some(line => line.includes('Attention') && line.includes('pane lost')), 'overview should include pane lost attention')
    assert.ok(paneLostLines.some(line => line.includes('researcher') && line.includes('pane lost')), 'member row should include pane lost marker')

    const theme = helpers.createFakeTheme()
    const expandedState = modules.viewModel.createInitialPanelState()
    expandedState.focus = 'tasks'
    expandedState.selectedIndex = 0
    expandedState.isDetailExpanded = true
    const expandedSelection = modules.viewModel.buildPanelSelectionView(data, expandedState)
    const expandedLines = modules.layout.renderTeamPanelLines(theme, { width: 96, data, state: expandedState, selection: expandedSelection })
    assert.ok(expandedLines.some(line => line.includes('Long description for rendering')), 'expanded details should show full task description')
    assert.ok(expandedLines.some(line => line.includes('Esc') && line.includes('collapse details')), 'expanded details should hint Esc collapse')

    const longTask = modules.state.createTask(team, {
      title: 'Long detail overflow regression',
      description: Array.from({ length: 40 }, (_, i) => `description line ${i + 1} with 中文连续内容测试abcdef`).join('\n'),
    })
    modules.state.appendTaskNote(
      longTask,
      'researcher-very-long-member-name-alpha',
      Array.from({ length: 40 }, (_, i) => `note line ${i + 1} with long-token-${'x'.repeat(80)}`).join('\n'),
    )
    modules.state.writeTeamState(team)
    const longData = modules.viewModel.loadPanelData('render-suite')
    const longState = modules.viewModel.createInitialPanelState()
    longState.focus = 'tasks'
    longState.selectedIndex = longData.tasks.findIndex(item => item.id === longTask.id)
    longState.isDetailExpanded = true
    const longSelection = modules.viewModel.buildPanelSelectionView(longData, longState)
    const longLines = modules.layout.renderTeamPanelLines(theme, { width: 96, height: 32, data: longData, state: longState, selection: longSelection })
    assert.ok(longLines.length <= 32, `expanded reader should stay within terminal height, got ${longLines.length}`)
    assert.ok(longLines.some(line => line.includes('Details · task')), 'expanded reader should use a focused detail reader title')
    assert.ok(longLines.some(line => line.includes('/')), 'expanded reader should show scroll range')
    assert.ok(longLines.some(line => line.includes('description line 1')), 'expanded reader should show the first page of full details')
    assert.equal(longLines.some(line => line.includes('note line 40')), false, 'first page should not render the end of long notes')

    longState.detailScrollOffset = 1000
    const longScrolledLines = modules.layout.renderTeamPanelLines(theme, { width: 96, height: 32, data: longData, state: longState, selection: longSelection })
    assert.ok(longScrolledLines.length <= 32, `scrolled expanded reader should stay within terminal height, got ${longScrolledLines.length}`)
    assert.ok(longScrolledLines.some(line => line.includes('note line 40')), 'expanded reader should allow scrolling to the end of long notes')

    for (const width of [56, 72, 96, 128, 160, 220]) {
      for (const renderCase of [
        { data, state, selection },
        { data: globalData, state: globalState, selection: globalSelection },
      ]) {
        const lines = modules.layout.renderTeamPanelLines(theme, { width, ...renderCase })
        assert.ok(Array.isArray(lines), `lines should be array for width=${width}`)
        for (const line of lines) {
          const visible = helpers.visibleWidth(line)
          assert.ok(
            visible <= width,
            `Rendered line exceeds width ${visible} > ${width}: ${line}`,
          )
        }
      }
    }
  },
}
