const assert = require('node:assert/strict')

function oneShotPanel(ctx, result) {
  let used = false
  ctx.ui.custom = async () => {
    if (used) return { type: 'close' }
    used = true
    return result
  }
}

module.exports = {
  name: 'commands flow',
  async run(env) {
    const { pi, modules, leaderCtx, patches } = env
    const command = name => pi.__commands.get(name)

    assert.deepEqual([...pi.__commands.keys()].filter(name => name.startsWith('team')), ['team'])
    assert.ok(!pi.__commands.has('team-sync'), 'team-sync command should be removed')
    assert.ok(!pi.__commands.has('team-delete'), 'team-delete command should be removed')
    assert.ok(!pi.__commands.has('team-cleanup'), 'team-cleanup command should be removed')
    assert.ok(!pi.__commands.has('team-remove-member'), 'team-remove-member command should be removed')

    const team = modules.state.readTeamState('full-suite-team')
    modules.state.pushMailboxMessage(team.name, 'team-lead', {
      from: 'research-one',
      to: 'team-lead',
      text: 'Need approval',
      type: 'question',
      taskId: 'T001',
      threadId: 'task:T001',
      requestId: 'approve-1',
      priority: 'high',
      wakeHint: 'soft',
    })

    const originalCustom = leaderCtx.ui.custom
    oneShotPanel(leaderCtx, { type: 'sync' })
    await command('team').handler('', leaderCtx)
    leaderCtx.ui.custom = originalCustom

    let teamAfterSync = modules.state.readTeamState('full-suite-team')
    assert.ok(teamAfterSync, 'team should still exist after sync action')

    oneShotPanel(leaderCtx, {
      type: 'remove-member',
      teamName: 'full-suite-team',
      memberName: 'plan-one',
    })
    await command('team').handler('', leaderCtx)
    leaderCtx.ui.custom = originalCustom
    const teamAfterRemove = modules.state.readTeamState('full-suite-team')
    assert.ok(!teamAfterRemove.members['plan-one'], 'plan-one should be removed from /team action')

    const removeCurrentPaneTeam = modules.state.createInitialTeamState({
      teamName: 'remove-current-pane-suite',
      leaderSessionFile: '/tmp/remove-current-leader.jsonl',
      leaderCwd: '/tmp',
    })
    modules.state.upsertMember(removeCurrentPaneTeam, {
      name: 'stale-current-worker',
      role: 'researcher',
      cwd: '/tmp',
      sessionFile: '/tmp/stale-current-worker.jsonl',
      status: 'error',
      paneId: '%leader',
      windowTarget: 'test:@1',
    })
    modules.state.writeTeamState(removeCurrentPaneTeam)
    oneShotPanel(leaderCtx, {
      type: 'remove-member',
      teamName: 'remove-current-pane-suite',
      memberName: 'stale-current-worker',
    })
    await command('team').handler('', leaderCtx)
    leaderCtx.ui.custom = originalCustom
    const afterRemoveCurrentPane = modules.state.readTeamState('remove-current-pane-suite')
    assert.ok(!afterRemoveCurrentPane.members['stale-current-worker'], 'current-pane stale worker should be removed from state')
    assert.equal(patches.livePanes.has('%leader'), true, 'remove member should never kill current pane')
    assert.ok(patches.clearedPaneLabels.includes('%leader'), 'remove member should clear current pane label when selected member points at current pane')
    modules.state.deleteTeamState('remove-current-pane-suite')

    patches.livePanes.add('%old-leader')
    modules.state.updateTeamState('full-suite-team', latest => {
      latest.members['team-lead'].paneId = '%old-leader'
      latest.members['team-lead'].windowTarget = 'test:@1'
    })
    oneShotPanel(leaderCtx, {
      type: 'delete-team',
      teamName: 'full-suite-team',
    })
    await command('team').handler('', leaderCtx)
    leaderCtx.ui.custom = originalCustom
    const deleted = modules.state.readTeamState('full-suite-team')
    assert.equal(deleted, null)
    assert.equal(patches.livePanes.has('%old-leader'), false, 'delete should kill non-current leader pane')

    const cleanupA = modules.state.createInitialTeamState({
      teamName: 'cleanup-a',
      leaderSessionFile: '/tmp/cleanup-a-leader.jsonl',
      leaderCwd: '/tmp',
    })
    const cleanupB = modules.state.createInitialTeamState({
      teamName: 'cleanup-b',
      leaderSessionFile: '/tmp/cleanup-b-leader.jsonl',
      leaderCwd: '/tmp',
    })
    cleanupA.members['team-lead'].paneId = '%cleanup-old-leader'
    cleanupA.members['team-lead'].windowTarget = 'test:@1'
    cleanupB.members['team-lead'].paneId = '%leader'
    cleanupB.members['team-lead'].windowTarget = 'test:@1'
    patches.livePanes.add('%cleanup-old-leader')
    modules.state.writeTeamState(cleanupA)
    modules.state.writeTeamState(cleanupB)

    oneShotPanel(leaderCtx, { type: 'cleanup-all' })
    await command('team').handler('', leaderCtx)
    leaderCtx.ui.custom = originalCustom
    assert.equal(modules.state.readTeamState('cleanup-a'), null)
    assert.equal(modules.state.readTeamState('cleanup-b'), null)
    assert.equal(patches.livePanes.has('%cleanup-old-leader'), false, 'cleanup should kill non-current leader pane')
    assert.equal(patches.livePanes.has('%leader'), true, 'cleanup should keep current pane alive')
    assert.ok(patches.clearedPaneLabels.includes('%leader'), 'cleanup should clear current pane label')

    const deleteCurrentPaneMemberTeam = modules.state.createInitialTeamState({
      teamName: 'delete-current-pane-member-suite',
      leaderSessionFile: '/tmp/delete-current-pane-member-leader.jsonl',
      leaderCwd: '/tmp',
    })
    modules.state.upsertMember(deleteCurrentPaneMemberTeam, {
      name: 'stale-current-worker',
      role: 'researcher',
      cwd: '/tmp',
      sessionFile: '/tmp/delete-current-pane-member-worker.jsonl',
      status: 'error',
      paneId: '%leader',
      windowTarget: 'test:@1',
    })
    modules.state.writeTeamState(deleteCurrentPaneMemberTeam)
    oneShotPanel(leaderCtx, {
      type: 'delete-team',
      teamName: 'delete-current-pane-member-suite',
    })
    await command('team').handler('', leaderCtx)
    leaderCtx.ui.custom = originalCustom
    assert.equal(modules.state.readTeamState('delete-current-pane-member-suite'), null)
    assert.equal(patches.livePanes.has('%leader'), true, 'delete team should never kill current pane even if a stale worker points at it')
    assert.ok(patches.clearedPaneLabels.includes('%leader'), 'delete team should clear current pane label when preserving it')

    const recoverTeam = modules.state.createInitialTeamState({
      teamName: 'recover-suite',
      leaderSessionFile: '/tmp/old-recover-leader.jsonl',
      leaderCwd: '/tmp/old',
    })
    modules.state.upsertMember(recoverTeam, {
      name: 'stale-current-pane-member',
      role: 'researcher',
      cwd: '/tmp',
      sessionFile: '/tmp/stale-current-pane-member.jsonl',
      status: 'error',
      paneId: '%leader',
      windowTarget: 'test:@1',
    })
    modules.state.writeTeamState(recoverTeam)
    const recoverCtx = env.helpers.createCtx('/tmp/new-leader', '/tmp/new-recover-leader.jsonl', env.notifications)
    oneShotPanel(recoverCtx, {
      type: 'recover-team',
      teamName: 'recover-suite',
    })
    await command('team').handler('', recoverCtx)
    const recovered = modules.state.readTeamState('recover-suite')
    assert.equal(recovered.leaderSessionFile, '/tmp/new-recover-leader.jsonl')
    assert.equal(recovered.members['team-lead'].sessionFile, '/tmp/new-recover-leader.jsonl')
    assert.equal(recovered.members['team-lead'].paneId, '%leader')
    assert.ok(!recovered.members['stale-current-pane-member'], 'recover should clear stale worker binding that points at current pane')
    assert.equal(modules.state.readSessionContext('/tmp/new-recover-leader.jsonl').teamName, 'recover-suite')

    modules.state.deleteTeamState('recover-suite')
  },
}
