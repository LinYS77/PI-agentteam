const assert = require('node:assert/strict')

module.exports = {
  name: 'protocol + orchestration',
  async run(env) {
    const { modules } = env

    assert.equal(modules.protocol.normalizeWakeHint('completion_report', undefined, 'team-lead'), 'hard')
    assert.equal(modules.protocol.normalizeWakeHint('completion_report', undefined, 'researcher'), 'soft')
    assert.equal(modules.protocol.normalizeWakeHint('question', undefined, 'planner'), 'soft')
    assert.equal(modules.protocol.normalizeWakeHint('question', undefined, 'team-lead'), 'soft')

    const team = modules.state.createInitialTeamState({
      teamName: 'decision-suite',
      leaderSessionFile: '/tmp/leader-decision.jsonl',
      leaderCwd: '/tmp',
      description: 'decision test',
    })
    modules.state.upsertMember(team, {
      name: 'researcher',
      role: 'researcher',
      cwd: '/tmp',
      sessionFile: '/tmp/researcher.jsonl',
      status: 'idle',
    })
    const task = modules.state.createTask(team, {
      title: 'Investigate issue',
      description: 'collect findings',
    })
    task.owner = 'researcher'
    task.status = 'blocked'
    task.updatedAt = Date.now()
    modules.state.writeTeamState(team)

    const blockedMessage = modules.state.pushMailboxMessage(team.name, 'team-lead', {
      from: 'researcher',
      to: 'team-lead',
      text: `${task.id} blocked due to missing dataset`,
      summary: `${task.id} blocked`,
      type: 'blocked',
      taskId: task.id,
      threadId: `task:${task.id}`,
      requestId: 'blocked-1',
      priority: 'high',
      wakeHint: 'hard',
    })

    const injected = modules.orchestration.maybeInjectLeaderOrchestrationContext(
      { messages: [{ role: 'user', content: 'please continue' }] },
      {
        team,
        memberName: 'team-lead',
        state: {
          lastDigestKey: '',
          lastDigestAt: 0,
          lastBlockedCount: 0,
          lastBlockedFingerprints: [],
        },
      },
    )
    assert.ok(injected.injected, 'leader orchestration digest should be injected')
    assert.ok(injected.injected.messages.some(m => typeof m.content === 'string' && m.content.includes('[agentteam-orchestration-digest]')))
    const injectedText = injected.injected.messages
      .map(m => (typeof m.content === 'string' ? m.content : ''))
      .join('\n')
    assert.ok(injectedText.includes('blocked task count: 1'))
    assert.ok(injectedText.includes('unread leader mailbox count: 1'))
    assert.ok(injectedText.includes(blockedMessage.id), 'digest should include latest unread message id')

    const digestKey = modules.orchestration.computeLeaderDigestKey(modules.state.readTeamState('decision-suite'))
    assert.ok(digestKey.includes('blocked:1'))
    assert.ok(digestKey.includes(task.id), 'digest key should track blocked task identity')
    assert.ok(digestKey.includes('unread:1'))
    assert.ok(digestKey.includes(`latest:${blockedMessage.id}`))

    const repeatedActionableDigest = modules.orchestration.maybeInjectLeaderOrchestrationContext(
      { messages: [{ role: 'user', content: 'please continue' }] },
      {
        team,
        memberName: 'team-lead',
        state: {
          lastDigestKey: injected.digestKey,
          lastDigestAt: injected.digestAt - 3000,
          lastBlockedCount: injected.blockedCount,
          lastBlockedFingerprints: injected.blockedFingerprints,
        },
      },
    )
    assert.equal(
      repeatedActionableDigest.injected,
      undefined,
      'same actionable digest should not repeat on a short interval',
    )

    const reminderActionableDigest = modules.orchestration.maybeInjectLeaderOrchestrationContext(
      { messages: [{ role: 'user', content: 'please continue' }] },
      {
        team,
        memberName: 'team-lead',
        state: {
          lastDigestKey: injected.digestKey,
          lastDigestAt: injected.digestAt - (11 * 60 * 1000),
          lastBlockedCount: injected.blockedCount,
          lastBlockedFingerprints: injected.blockedFingerprints,
        },
      },
    )
    assert.ok(
      reminderActionableDigest.injected,
      'same actionable digest may repeat only as a low-frequency reminder',
    )

    const quietTeam = modules.state.createInitialTeamState({
      teamName: 'quiet-mode-suite',
      leaderSessionFile: '/tmp/leader-quiet.jsonl',
      leaderCwd: '/tmp',
      description: 'quiet mode test',
    })
    modules.state.upsertMember(quietTeam, {
      name: 'researcher',
      role: 'researcher',
      cwd: '/tmp',
      sessionFile: '/tmp/researcher-quiet.jsonl',
      status: 'running',
      lastWakeReason: 'processing prompt',
    })
    const quietTask = modules.state.createTask(quietTeam, {
      title: 'Long running exploration',
      description: 'let teammate run without leader polling',
    })
    quietTask.owner = 'researcher'
    quietTask.status = 'in_progress'
    quietTask.updatedAt = Date.now()
    modules.state.writeTeamState(quietTeam)

    const quietInjected = modules.orchestration.maybeInjectLeaderOrchestrationContext(
      { messages: [{ role: 'user', content: 'continue' }] },
      {
        team: quietTeam,
        memberName: 'team-lead',
        state: {
          lastDigestKey: '',
          lastDigestAt: 0,
          lastBlockedCount: 0,
          lastBlockedFingerprints: [],
        },
      },
    )
    assert.equal(
      quietInjected.injected,
      undefined,
      'quiet team should not inject a 0/0 coordination digest',
    )

    const quietSecond = modules.orchestration.maybeInjectLeaderOrchestrationContext(
      { messages: [{ role: 'user', content: 'continue' }] },
      {
        team: quietTeam,
        memberName: 'team-lead',
        state: {
          lastDigestKey: quietInjected.digestKey,
          lastDigestAt: quietInjected.digestAt,
          lastBlockedCount: quietInjected.blockedCount,
          lastBlockedFingerprints: quietInjected.blockedFingerprints,
        },
      },
    )
    assert.equal(
      quietSecond.injected,
      undefined,
      'digest should throttle repeated injection when nothing changed',
    )

    const quietAfterInterval = modules.orchestration.maybeInjectLeaderOrchestrationContext(
      { messages: [{ role: 'user', content: 'continue' }] },
      {
        team: quietTeam,
        memberName: 'team-lead',
        state: {
          lastDigestKey: quietInjected.digestKey,
          lastDigestAt: quietInjected.digestAt - (16 * 60 * 1000),
          lastBlockedCount: quietInjected.blockedCount,
          lastBlockedFingerprints: quietInjected.blockedFingerprints,
        },
      },
    )
    assert.equal(
      quietAfterInterval.injected,
      undefined,
      'quiet team should stay silent even after the reminder interval',
    )

    const unreadScopeTeam = modules.state.createInitialTeamState({
      teamName: 'unread-scope-suite',
      leaderSessionFile: '/tmp/unread-scope-leader.jsonl',
      leaderCwd: '/tmp',
      description: 'unread filtering test',
    })
    modules.state.upsertMember(unreadScopeTeam, {
      name: 'planner',
      role: 'planner',
      cwd: '/tmp',
      sessionFile: '/tmp/unread-scope-planner.jsonl',
      status: 'idle',
    })
    modules.state.writeTeamState(unreadScopeTeam)

    modules.state.pushMailboxMessage('unread-scope-suite', 'team-lead', {
      from: 'planner',
      to: 'team-lead',
      text: 'completed and acknowledged',
      type: 'completion_report',
      taskId: 'T001',
      threadId: 'task:T001',
      priority: 'normal',
      wakeHint: 'hard',
      readAt: Date.now(),
    })

    const unreadQuestion = modules.state.pushMailboxMessage('unread-scope-suite', 'team-lead', {
      from: 'planner',
      to: 'team-lead',
      text: 'still need decision',
      type: 'question',
      taskId: 'T002',
      threadId: 'task:T002',
      priority: 'normal',
      wakeHint: 'soft',
    })

    const unreadScopeSnapshot = modules.orchestration.buildLeaderCoordinationSnapshot(
      modules.state.readTeamState('unread-scope-suite'),
    )

    assert.equal(unreadScopeSnapshot.blockedCount, 0)
    assert.equal(unreadScopeSnapshot.unreadCount, 1)
    assert.equal(unreadScopeSnapshot.latestUnreadMessageId, unreadQuestion.id)

    const policy = env.helpers.requireDist('policy.js')
    const leaderPolicy = policy.buildLeaderDelegationPolicy('decision-suite')
    assert.ok(leaderPolicy.includes('Manual control'), 'leader policy should reject autonomous orchestration')
    assert.ok(leaderPolicy.includes('delegate at least one meaningful task'), 'leader policy should prevent solo-worker fallback when user asks for team help')
    assert.ok(leaderPolicy.includes('spawn only the minimum necessary teammate'), 'leader policy should discourage over-spawning')
    assert.ok(leaderPolicy.includes('Planner is advisory'), 'leader policy should keep planner from becoming a second leader')
    assert.ok(leaderPolicy.includes('task-first flow'), 'leader policy should keep task-first workflow')
    assert.ok(leaderPolicy.includes('Current teammate roster:'), 'leader policy should include current roster when attached')
  },
}
