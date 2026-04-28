const assert = require('node:assert/strict')

module.exports = {
  name: 'tools + state flow',
  async run(env) {
    const { pi, modules, leaderCtx, helpers } = env
    const tool = name => pi.__tools.get(name)

    let res = await tool('agentteam_create').execute('create-1', {
      team_name: 'full-suite-team',
      description: 'Integration test team',
    }, null, () => {}, leaderCtx)
    helpers.assertContains(res.content[0].text, 'Created team full-suite-team')

    let team = modules.state.readTeamState('full-suite-team')
    assert.ok(team, 'team should exist after create')
    assert.equal(team.members['team-lead'].role, 'leader')

    res = await tool('agentteam_spawn').execute('spawn-1', {
      name: 'Research One',
      role: 'worker',
    }, null, () => {}, leaderCtx)
    helpers.assertContains(res.content[0].text, 'Created idle teammate research-one (researcher)')

    res = await tool('agentteam_spawn').execute('spawn-2', {
      name: 'Plan One',
      role: 'plan',
      task: '请先等待 research 的报告，收到消息后给出计划。',
    }, null, () => {}, leaderCtx)
    helpers.assertContains(res.content[0].text, 'Created waiting teammate plan-one (planner)')

    const originalWriteTeamState = modules.state.writeTeamState
    let duplicateSpawnWrites = 0
    modules.state.writeTeamState = state => {
      duplicateSpawnWrites += 1
      return originalWriteTeamState(state)
    }
    try {
      res = await tool('agentteam_spawn').execute('spawn-dup-existing', {
        name: 'Research One',
        role: 'researcher',
      }, null, () => {}, leaderCtx)
      helpers.assertContains(res.content[0].text, 'already exists')
    } finally {
      modules.state.writeTeamState = originalWriteTeamState
    }
    assert.equal(duplicateSpawnWrites, 0, 'duplicate spawn should not perform unconditional outer writeTeamState')

    team = modules.state.readTeamState('full-suite-team')
    assert.equal(team.members['research-one'].role, 'researcher')
    assert.equal(team.members['plan-one'].role, 'planner')
    assert.equal(team.members['plan-one'].lastWakeReason, 'created waiting for follow-up instruction')

    res = await tool('agentteam_task').execute('task-create-1', {
      action: 'create',
      title: 'Inspect project',
      description: 'Explore project and report findings',
    }, null, () => {}, leaderCtx)
    helpers.assertContains(res.content[0].text, 'Created T001')

    res = await tool('agentteam_task').execute('claim-1', {
      action: 'claim',
      taskId: 'T001',
      owner: 'research-one',
    }, null, () => {}, leaderCtx)
    helpers.assertContains(res.content[0].text, 'Claimed T001')

    team = modules.state.readTeamState('full-suite-team')
    assert.equal(team.members['research-one'].status, 'idle', 'claim should update shared state only and not wake worker')

    res = await tool('agentteam_send').execute('assign-1', {
      to: 'research-one',
      message: 'You were assigned shared task T001: Inspect project\n\nExplore project and report findings',
      summary: 'Assigned T001',
      type: 'assignment',
      taskId: 'T001',
    }, null, () => {}, leaderCtx)
    assert.deepEqual(res.details.recipients, ['research-one'])

    team = modules.state.readTeamState('full-suite-team')
    assert.equal(team.tasks['T001'].owner, 'research-one')
    assert.equal(team.tasks['T001'].status, 'in_progress')

    res = await tool('agentteam_send').execute('send-1', {
      to: 'plan-one',
      message: 'Research done, please draft plan',
      type: 'fyi',
      taskId: 'T001',
    }, null, () => {}, leaderCtx)
    assert.deepEqual(res.details.recipients, ['plan-one'])
    assert.equal(res.details.wakeByRecipient[0].wakeHint, 'none')

    const planSession = team.members['plan-one'].sessionFile
    const planCtx = helpers.createCtx(leaderCtx.cwd, planSession, env.notifications)
    const researchSession = team.members['research-one'].sessionFile
    const researchCtx = helpers.createCtx(leaderCtx.cwd, researchSession, env.notifications)

    res = await tool('agentteam_receive').execute('recv-1', {
      markRead: true,
      limit: 10,
    }, null, () => {}, planCtx)
    helpers.assertContains(res.content[0].text, 'Received 1 message from team-lead')

    const planMailboxAfterRead = modules.state.readMailbox('full-suite-team', 'plan-one')
    assert.ok(planMailboxAfterRead[0].readAt, 'receive markRead should stamp readAt')

    res = await tool('agentteam_send').execute('send-peer-fyi-idle-wakes-soft', {
      to: 'plan-one',
      message: 'peer handoff with report summary',
      type: 'fyi',
      taskId: 'T001',
    }, null, () => {}, researchCtx)
    assert.deepEqual(res.details.recipients, ['plan-one'])
    assert.equal(res.details.wakeByRecipient[0].wakeHint, 'soft')

    const planMailbox = modules.state.readMailbox('full-suite-team', 'plan-one')
    assert.equal(planMailbox.length, 2)
    assert.ok(planMailbox.every(item => item.type === 'fyi'))
    const peerFyi = planMailbox.find(item => item.text.includes('peer handoff'))
    assert.ok(peerFyi?.deliveredAt, 'worker wake should mark mailbox messages delivered')
    assert.equal(peerFyi?.readAt, undefined, 'worker wake should not mark mailbox messages read')

    res = await tool('agentteam_send').execute('send-peer-completion', {
      to: 'plan-one',
      message: 'Research complete, full report delivered to planner.',
      type: 'completion_report',
      taskId: 'T001',
    }, null, () => {}, researchCtx)
    assert.deepEqual(res.details.recipients, ['plan-one'])
    assert.deepEqual(res.details.mirroredToLeader, ['plan-one'])
    assert.ok(
      modules.state.readMailbox('full-suite-team', 'team-lead').some(m =>
        m.type === 'completion_report' &&
        m.metadata?.mirrorOf === 'plan-one' &&
        m.text.includes('Research complete'),
      ),
      'peer completion_report should be mirrored to leader mailbox',
    )

    let teamAfterPeerSend = modules.state.readTeamState('full-suite-team')
    const peerEvent = [...(teamAfterPeerSend.events ?? [])].reverse().find(event =>
      event.type === 'peer_message' &&
      event.by === 'research-one' &&
      String(event.text).includes('completion_report -> plan-one'),
    )
    assert.ok(peerEvent, 'worker-to-worker message should be captured by lightweight team event log')

    let leadMailbox = modules.state.readMailbox('full-suite-team', 'team-lead')

    res = await tool('agentteam_send').execute('send-2', {
      to: 'team-lead',
      message: 'Task T001 completed',
      type: 'completion_report',
      taskId: 'T001',
    }, null, () => {}, researchCtx)
    assert.equal(res.details.wakeByRecipient[0].wakeHint, 'hard')

    leadMailbox = modules.state.readMailbox('full-suite-team', 'team-lead')
    assert.ok(leadMailbox.some(m => m.type === 'completion_report'))

    res = await tool('agentteam_task').execute('task-complete-worker', {
      action: 'complete',
      taskId: 'T001',
      note: 'Done',
    }, null, () => {}, researchCtx)
    helpers.assertContains(res.content[0].text, 'Completed T001')

    team = modules.state.readTeamState('full-suite-team')
    assert.equal(team.tasks['T001'].status, 'completed')

    const mergeTeam = modules.state.createInitialTeamState({
      teamName: 'merge-freshness-suite',
      leaderSessionFile: '/tmp/merge-freshness-leader.jsonl',
      leaderCwd: '/tmp',
    })
    modules.state.upsertMember(mergeTeam, {
      name: 'worker-one',
      role: 'researcher',
      cwd: '/tmp',
      sessionFile: '/tmp/merge-freshness-worker.jsonl',
      status: 'idle',
    })
    const mergeTask = modules.state.createTask(mergeTeam, {
      title: 'Freshness merge task',
      description: 'ensure stale writer does not clobber newer task/member state',
    })
    modules.state.writeTeamState(mergeTeam)

    const staleSnapshot = modules.state.readTeamState('merge-freshness-suite')
    const newerSnapshot = modules.state.readTeamState('merge-freshness-suite')

    // Newer writer updates existing member + existing task.
    modules.state.updateMemberStatus(newerSnapshot, 'worker-one', {
      status: 'running',
      lastWakeReason: 'newer writer update',
    })
    newerSnapshot.tasks[mergeTask.id].status = 'blocked'
    newerSnapshot.tasks[mergeTask.id].updatedAt = Date.now() + 10
    newerSnapshot.tasks[mergeTask.id].notes.push({
      at: Date.now() + 10,
      author: 'worker-one',
      text: 'newer task update',
    })
    modules.state.writeTeamState(newerSnapshot)

    // Stale writer updates unrelated top-level field and writes older entity copies back.
    staleSnapshot.description = 'stale writer changed description only'
    modules.state.writeTeamState(staleSnapshot)

    const mergedFreshness = modules.state.readTeamState('merge-freshness-suite')
    assert.equal(mergedFreshness.members['worker-one'].status, 'running')
    assert.equal(mergedFreshness.members['worker-one'].lastWakeReason, 'newer writer update')
    assert.equal(mergedFreshness.tasks[mergeTask.id].status, 'blocked')
    assert.ok(
      mergedFreshness.tasks[mergeTask.id].notes.some(note => note.text === 'newer task update'),
      'newer task note should survive stale writer merge',
    )
    assert.equal(mergedFreshness.description, 'stale writer changed description only')

    const statusKeyTeam = modules.state.createInitialTeamState({
      teamName: 'status-key-suite',
      leaderSessionFile: '/tmp/status-key-leader.jsonl',
      leaderCwd: '/tmp',
    })
    modules.state.upsertMember(statusKeyTeam, {
      name: 'status-worker',
      role: 'researcher',
      cwd: '/tmp',
      sessionFile: '/tmp/status-key-worker.jsonl',
      status: 'idle',
    })
    modules.state.writeTeamState(statusKeyTeam)

    const statusCtx = helpers.createCtx('/tmp', '/tmp/status-key-leader.jsonl', env.notifications)
    const attachedStatus = {
      context: { teamName: 'status-key-suite', memberName: 'team-lead' },
      source: 'cached',
    }
    const statusKey1 = modules.runtime.buildSessionStatusKey(statusCtx, attachedStatus)

    const statusTeamV2 = modules.state.readTeamState('status-key-suite')
    modules.state.updateMemberStatus(statusTeamV2, 'status-worker', {
      status: 'running',
      lastWakeReason: 'status-key-update',
    })
    modules.state.writeTeamState(statusTeamV2)

    const statusKey2 = modules.runtime.buildSessionStatusKey(statusCtx, attachedStatus)
    assert.notEqual(statusKey1, statusKey2, 'status key should change when team revision changes')

    const storageTeam = modules.state.createInitialTeamState({
      teamName: 'storage-cache-suite',
      leaderSessionFile: '/tmp/storage-cache-leader.jsonl',
      leaderCwd: '/tmp',
    })
    modules.state.upsertMember(storageTeam, {
      name: 'storage-worker',
      role: 'researcher',
      cwd: '/tmp',
      sessionFile: '/tmp/storage-cache-worker.jsonl',
      status: 'idle',
      paneId: '%storage-worker',
      windowTarget: 'test:@1',
    })

    const originalEnsureMailbox = modules.state.ensureMailbox
    let ensureMailboxCalls = 0
    modules.state.ensureMailbox = (...args) => {
      ensureMailboxCalls += 1
      return originalEnsureMailbox(...args)
    }

    try {
      modules.runtime.ensureTeamStorageReady(storageTeam)
      modules.runtime.ensureTeamStorageReady(storageTeam)
      assert.equal(ensureMailboxCalls, 2, 'ensureTeamStorageReady should avoid repeated per-member ensureMailbox calls')
    } finally {
      modules.state.ensureMailbox = originalEnsureMailbox
    }

    const originalResolvePaneBinding = modules.tmux.resolvePaneBinding
    let resolveCalls = 0
    modules.tmux.resolvePaneBinding = paneId => {
      resolveCalls += 1
      if (paneId === '%lost-pane') return null
      if (paneId === '%live-pane') return { paneId, target: 'test:@1' }
      return originalResolvePaneBinding(paneId)
    }

    const reconcileTeam = modules.state.createInitialTeamState({
      teamName: 'reconcile-invalidate-suite',
      leaderSessionFile: '/tmp/reconcile-invalidate-leader.jsonl',
      leaderCwd: '/tmp',
    })
    modules.state.upsertMember(reconcileTeam, {
      name: 'lost-worker',
      role: 'researcher',
      cwd: '/tmp',
      sessionFile: '/tmp/reconcile-lost-worker.jsonl',
      status: 'running',
      paneId: '%lost-pane',
      windowTarget: 'test:@1',
    })
    modules.state.upsertMember(reconcileTeam, {
      name: 'live-worker',
      role: 'researcher',
      cwd: '/tmp',
      sessionFile: '/tmp/reconcile-live-worker.jsonl',
      status: 'idle',
      paneId: '%live-pane',
      windowTarget: 'test:@1',
    })

    modules.runtime.invalidatePaneReconcileCache()
    const firstReconcileChanged = modules.runtime.reconcileTeamPanes(reconcileTeam)
    const secondReconcileChanged = modules.runtime.reconcileTeamPanes(reconcileTeam)
    modules.tmux.resolvePaneBinding = originalResolvePaneBinding

    assert.equal(firstReconcileChanged, true, 'first reconcile should detect lost pane changes')
    assert.equal(secondReconcileChanged, false, 'second reconcile should be stable after healing')
    assert.equal(
      resolveCalls,
      3,
      'pane reconcile cache should be invalidated after pane-loss healing so immediate second reconcile still checks live panes',
    )

    const txTeam = modules.state.createInitialTeamState({
      teamName: 'transaction-suite',
      leaderSessionFile: '/tmp/transaction-leader.jsonl',
      leaderCwd: '/tmp',
    })
    modules.state.upsertMember(txTeam, {
      name: 'transaction-worker',
      role: 'researcher',
      cwd: '/tmp',
      sessionFile: '/tmp/transaction-worker.jsonl',
      status: 'idle',
    })
    modules.state.writeTeamState(txTeam)

    const txUpdated = modules.state.updateTeamState('transaction-suite', team => {
      team.description = 'updated through transaction api'
      modules.state.updateMemberStatus(team, 'transaction-worker', {
        status: 'running',
        lastWakeReason: 'transaction update',
      })
      modules.state.createTask(team, {
        title: 'transaction task',
        description: 'created inside updateTeamState',
      })
    })

    assert.ok(txUpdated, 'updateTeamState should return updated team state')
    assert.equal(txUpdated.description, 'updated through transaction api')
    assert.equal(txUpdated.members['transaction-worker'].status, 'running')
    assert.equal(txUpdated.members['transaction-worker'].lastWakeReason, 'transaction update')
    assert.ok(txUpdated.tasks.T001, 'updateTeamState should persist task creation')

    const txMissing = modules.state.updateTeamState('missing-transaction-suite', team => team)
    assert.equal(txMissing, null, 'updateTeamState should return null for missing team')

    const txBeforeNoop = modules.state.readTeamState('transaction-suite')
    const txNoop = modules.state.updateTeamState('transaction-suite', () => undefined)
    assert.equal(txNoop.revision, txBeforeNoop.revision, 'no-op updateTeamState should not bump revision')

    const txBeforeSameStatus = modules.state.readTeamState('transaction-suite')
    const sameStatusUpdatedAt = txBeforeSameStatus.members['transaction-worker'].updatedAt
    const txSameStatus = modules.state.updateTeamState('transaction-suite', team => {
      modules.state.updateMemberStatus(team, 'transaction-worker', {
        status: 'running',
        lastWakeReason: 'transaction update',
      })
    })
    assert.equal(txSameStatus.revision, txBeforeSameStatus.revision, 'same member status patch should not bump revision')
    assert.equal(
      txSameStatus.members['transaction-worker'].updatedAt,
      sameStatusUpdatedAt,
      'same member status patch should not update member timestamp',
    )

    const txStatusChanged = modules.state.updateTeamState('transaction-suite', team => {
      modules.state.updateMemberStatus(team, 'transaction-worker', {
        status: 'idle',
        lastWakeReason: 'transaction finished',
      })
    })
    assert.equal(
      txStatusChanged.revision,
      txBeforeSameStatus.revision + 1,
      'actual member status change should bump revision',
    )
    assert.equal(txStatusChanged.members['transaction-worker'].status, 'idle')
    assert.equal(txStatusChanged.members['transaction-worker'].lastWakeReason, 'transaction finished')

    const concurrentTeam = modules.state.createInitialTeamState({
      teamName: 'concurrent-note-suite',
      leaderSessionFile: '/tmp/concurrent-note-leader.jsonl',
      leaderCwd: '/tmp',
    })
    modules.state.upsertMember(concurrentTeam, {
      name: 'note-worker-a',
      role: 'researcher',
      cwd: '/tmp',
      sessionFile: '/tmp/concurrent-note-worker-a.jsonl',
      status: 'idle',
    })
    modules.state.upsertMember(concurrentTeam, {
      name: 'note-worker-b',
      role: 'researcher',
      cwd: '/tmp',
      sessionFile: '/tmp/concurrent-note-worker-b.jsonl',
      status: 'idle',
    })
    const concurrentTask = modules.state.createTask(concurrentTeam, {
      title: 'Concurrent notes',
      description: 'ensure transaction updates preserve both notes',
    })
    modules.state.writeTeamState(concurrentTeam)

    const noteWorkerACtx = helpers.createCtx('/tmp', '/tmp/concurrent-note-worker-a.jsonl', env.notifications)
    const noteWorkerBCtx = helpers.createCtx('/tmp', '/tmp/concurrent-note-worker-b.jsonl', env.notifications)
    await Promise.all([
      tool('agentteam_task').execute('concurrent-note-a', {
        action: 'note',
        taskId: concurrentTask.id,
        note: 'note-from-a',
      }, null, () => {}, noteWorkerACtx),
      tool('agentteam_task').execute('concurrent-note-b', {
        action: 'note',
        taskId: concurrentTask.id,
        note: 'note-from-b',
      }, null, () => {}, noteWorkerBCtx),
    ])
    const concurrentAfter = modules.state.readTeamState('concurrent-note-suite')
    const concurrentNotes = concurrentAfter.tasks[concurrentTask.id].notes.map(note => note.text)
    assert.ok(concurrentNotes.includes('note-from-a'), 'transaction task note update should preserve note from worker A')
    assert.ok(concurrentNotes.includes('note-from-b'), 'transaction task note update should preserve note from worker B')

    modules.state.deleteTeamState('concurrent-note-suite')
    modules.state.deleteTeamState('status-key-suite')
    modules.state.deleteTeamState('storage-cache-suite')
    modules.state.deleteTeamState('reconcile-invalidate-suite')
    modules.state.deleteTeamState('transaction-suite')
  },
}
