const assert = require('node:assert/strict')

module.exports = {
  name: 'leader wake + permission guards',
  async run(env) {
    const { pi, modules, helpers, sentPrompts, notifications } = env
    const tool = name => pi.__tools.get(name)

    const leaderCtx = helpers.createCtx('/tmp/guard-suite-project', '/tmp/guard-suite-leader.jsonl', notifications)

    let res = await tool('agentteam_create').execute('guard-create', {
      team_name: 'guard-suite-team',
      description: 'Guard and wake regression suite',
    }, null, () => {}, leaderCtx)
    helpers.assertContains(res.content[0].text, 'Created team guard-suite-team')

    res = await tool('agentteam_spawn').execute('guard-spawn-r', {
      name: 'researcher-guard',
      role: 'researcher',
    }, null, () => {}, leaderCtx)
    helpers.assertContains(res.content[0].text, 'Created idle teammate researcher-guard (researcher)')

    res = await tool('agentteam_spawn').execute('guard-spawn-p', {
      name: 'planner-guard',
      role: 'planner',
    }, null, () => {}, leaderCtx)
    helpers.assertContains(res.content[0].text, 'Created idle teammate planner-guard (planner)')

    res = await tool('agentteam_spawn').execute('guard-spawn-i', {
      name: 'implementer-guard',
      role: 'implementer',
    }, null, () => {}, leaderCtx)
    helpers.assertContains(res.content[0].text, 'Created idle teammate implementer-guard (implementer)')

    const team = modules.state.readTeamState('guard-suite-team')
    assert.ok(team, 'guard-suite-team should exist')

    const plannerCtx = helpers.createCtx('/tmp/guard-suite-project', team.members['planner-guard'].sessionFile, notifications)
    const researcherCtx = helpers.createCtx('/tmp/guard-suite-project', team.members['researcher-guard'].sessionFile, notifications)
    const implementerCtx = helpers.createCtx('/tmp/guard-suite-project', team.members['implementer-guard'].sessionFile, notifications)

    res = await tool('agentteam_task').execute('guard-task-create', {
      action: 'create',
      title: 'Guard smoke task',
      description: 'Used to validate leader wake and permissions',
    }, null, () => {}, leaderCtx)
    helpers.assertContains(res.content[0].text, 'Created T001')

    res = await tool('agentteam_task').execute('guard-claim-leader', {
      action: 'claim',
      taskId: 'T001',
      owner: 'researcher-guard',
    }, null, () => {}, leaderCtx)
    helpers.assertContains(res.content[0].text, 'Claimed T001')

    res = await tool('agentteam_send').execute('guard-assign-leader', {
      to: 'researcher-guard',
      message: 'You were assigned shared task T001: Guard smoke task\n\nUsed to validate leader wake and permissions',
      summary: 'Assigned T001',
      type: 'assignment',
      taskId: 'T001',
    }, null, () => {}, leaderCtx)
    assert.deepEqual(res.details.recipients, ['researcher-guard'])

    res = await tool('agentteam_spawn').execute('guard-spawn-denied', {
      name: 'illegal-worker',
      role: 'researcher',
    }, null, () => {}, plannerCtx)
    helpers.assertContains(res.content[0].text, 'Only team-lead can perform this operation')

    res = await tool('agentteam_task').execute('guard-task-create-planner', {
      action: 'create',
      title: 'planner-created-task',
      description: 'planner should be able to maintain task decomposition',
    }, null, () => {}, plannerCtx)
    helpers.assertContains(res.content[0].text, 'Created T002')

    res = await tool('agentteam_task').execute('guard-task-create-implementer-denied', {
      action: 'create',
      title: 'illegal',
      description: 'illegal',
    }, null, () => {}, implementerCtx)
    helpers.assertContains(res.content[0].text, "Task action 'create' is not allowed")

    res = await tool('agentteam_task').execute('guard-task-claim-planner-owned', {
      action: 'claim',
      taskId: 'T002',
      owner: 'planner-guard',
    }, null, () => {}, plannerCtx)
    helpers.assertContains(res.content[0].text, 'Claimed T002')

    res = await tool('agentteam_task').execute('guard-task-complete-planner-allowed', {
      action: 'complete',
      taskId: 'T002',
      note: 'planner completed planning breakdown',
    }, null, () => {}, plannerCtx)
    helpers.assertContains(res.content[0].text, 'Completed T002')

    const plannerCompleteTask = modules.state.readTeamState('guard-suite-team').tasks['T002']
    const plannerCompletionNote = plannerCompleteTask.notes.find(note =>
      note.author === 'planner-guard' &&
      note.text.includes('planner completed planning breakdown'),
    )
    assert.ok(plannerCompletionNote, 'planner completion should preserve planner note content without forced template inflation')

    res = await tool('agentteam_send').execute('guard-planner-long-send-allowed', {
      to: 'team-lead',
      type: 'fyi',
      message: `LONG-${'x'.repeat(700)}`,
    }, null, () => {}, plannerCtx)
    assert.deepEqual(res.details.recipients, ['team-lead'])
    assert.equal(Boolean(res.details.denied), false)

    res = await tool('agentteam_send').execute('guard-planner-completion-to-peer-allowed', {
      to: 'researcher-guard',
      type: 'completion_report',
      message: 'planning done',
      summary: 'done',
      taskId: 'T002',
    }, null, () => {}, plannerCtx)
    assert.deepEqual(res.details.recipients, ['researcher-guard'])
    assert.equal(res.details.mirroredToLeader, undefined)
    let guardTeamState = modules.state.readTeamState('guard-suite-team')
    const peerLogEntry = [...(guardTeamState.events ?? [])].reverse().find(event =>
      event.type === 'peer_message' &&
      event.by === 'planner-guard' &&
      String(event.text).includes('completion_report -> researcher-guard'),
    )
    assert.ok(peerLogEntry, 'peer message should be tracked in team event log for observability')

    res = await tool('agentteam_send').execute('guard-planner-completion-missing-taskid-denied', {
      to: 'team-lead',
      type: 'completion_report',
      message: 'planning done',
      summary: 'done',
    }, null, () => {}, plannerCtx)
    assert.equal(res.details.denied, true)
    assert.equal(res.details.reason, 'planner_send_policy')

    res = await tool('agentteam_send').execute('guard-planner-completion-missing-summary-allowed', {
      to: 'team-lead',
      type: 'completion_report',
      message: 'planning done',
      taskId: 'T002',
    }, null, () => {}, plannerCtx)
    assert.deepEqual(res.details.recipients, ['team-lead'])

    res = await tool('agentteam_send').execute('guard-planner-completion-valid', {
      to: 'team-lead',
      type: 'completion_report',
      summary: 'Planning package ready',
      message: 'T002 planning handoff finalized. See task notes for structured plan decomposition.',
      taskId: 'T002',
    }, null, () => {}, plannerCtx)
    assert.deepEqual(res.details.recipients, ['team-lead'])

    res = await tool('agentteam_task').execute('guard-task-create-impl-owned', {
      action: 'create',
      title: 'implementer-completion-template-task',
      description: 'validate completion template for implementer',
    }, null, () => {}, leaderCtx)
    helpers.assertContains(res.content[0].text, 'Created T003')

    res = await tool('agentteam_task').execute('guard-claim-impl-owned', {
      action: 'claim',
      taskId: 'T003',
      owner: 'implementer-guard',
    }, null, () => {}, leaderCtx)
    helpers.assertContains(res.content[0].text, 'Claimed T003')

    res = await tool('agentteam_send').execute('guard-assign-impl-owned', {
      to: 'implementer-guard',
      message: 'You were assigned shared task T003: implementer-completion-template-task\n\nvalidate completion template for implementer',
      summary: 'Assigned T003',
      type: 'assignment',
      taskId: 'T003',
    }, null, () => {}, leaderCtx)
    assert.deepEqual(res.details.recipients, ['implementer-guard'])

    res = await tool('agentteam_task').execute('guard-task-complete-impl-template', {
      action: 'complete',
      taskId: 'T003',
      note: 'Implemented targeted patch',
    }, null, () => {}, implementerCtx)
    helpers.assertContains(res.content[0].text, 'Completed T003')

    const guardTeamAfterComplete = modules.state.readTeamState('guard-suite-team')
    const t003 = guardTeamAfterComplete.tasks['T003']
    const completionTemplateNote = t003.notes.find(note =>
      note.author === 'implementer-guard' &&
      note.text.includes('Files changed:') &&
      note.text.includes('Checks run:'),
    )
    assert.ok(completionTemplateNote, 'implementer completion note should include change summary template')

    res = await tool('agentteam_send').execute('guard-peer-fyi-allowed', {
      to: 'researcher-guard',
      message: 'peer informational update',
      type: 'fyi',
    }, null, () => {}, plannerCtx)
    assert.deepEqual(res.details.recipients, ['researcher-guard'])

    res = await tool('agentteam_send').execute('guard-peer-question-allowed', {
      to: 'researcher-guard',
      message: 'Can you confirm the blocker details?',
      type: 'question',
      taskId: 'T001',
    }, null, () => {}, plannerCtx)
    assert.deepEqual(res.details.recipients, ['researcher-guard'])

    // Workers can send non-assignment core types to team-lead as well.
    res = await tool('agentteam_send').execute('guard-fyi-to-leader-allowed', {
      to: 'team-lead',
      message: 'informational update',
      type: 'fyi',
    }, null, () => {}, plannerCtx)
    assert.deepEqual(res.details.recipients, ['team-lead'])

    // Workers cannot send assignment type.
    res = await tool('agentteam_send').execute('guard-assignment-send-denied', {
      to: 'team-lead',
      message: 'unauthorized assignment',
      type: 'assignment',
    }, null, () => {}, plannerCtx)
    assert.equal(res.details.denied, true)

    const teamBeforeLeaderWake = modules.state.readTeamState('guard-suite-team')
    modules.state.updateMemberStatus(teamBeforeLeaderWake, 'team-lead', {
      status: 'idle',
      lastWakeReason: 'test reset before wake assertion',
    })
    modules.state.writeTeamState(teamBeforeLeaderWake)

    sentPrompts.length = 0
    res = await tool('agentteam_send').execute('guard-leader-wake', {
      to: 'team-lead',
      message: 'T001 completed by researcher',
      type: 'completion_report',
      taskId: 'T001',
    }, null, () => {}, researcherCtx)
    assert.equal(res.details.wakeByRecipient[0].wakeHint, 'hard')
    assert.ok(
      sentPrompts.some(item => item.paneId === '%leader' && item.prompt.includes('completion_report')),
      'leader pane should receive completion_report wake prompt',
    )

    const originalSendPrompt = modules.tmux.sendPromptToPane
    modules.tmux.sendPromptToPane = async () => {
      throw new Error('simulated wake failure')
    }

    const teamBeforeWakeFailure = modules.state.readTeamState('guard-suite-team')
    modules.state.updateMemberStatus(teamBeforeWakeFailure, 'researcher-guard', {
      status: 'idle',
      lastWakeReason: 'reset before wake failure assertion',
    })
    modules.state.writeTeamState(teamBeforeWakeFailure)

    res = await tool('agentteam_send').execute('guard-worker-wake-failure', {
      to: 'researcher-guard',
      message: 'trigger wake failure path',
      type: 'question',
    }, null, () => {}, leaderCtx)
    assert.deepEqual(res.details.recipients, ['researcher-guard'])

    const teamAfterWakeFailure = modules.state.readTeamState('guard-suite-team')
    assert.equal(teamAfterWakeFailure.members['researcher-guard'].status, 'error')
    assert.equal(teamAfterWakeFailure.members['researcher-guard'].lastWakeReason, 'wake failed')
    assert.ok(
      String(teamAfterWakeFailure.members['researcher-guard'].lastError || '').includes('simulated wake failure'),
      'wake failure should be recorded in member lastError',
    )

    modules.tmux.sendPromptToPane = originalSendPrompt

    const inputHooks = pi.__hooks.get('input') || []
    async function runInputHooks(event, ctx) {
      for (const hook of inputHooks) {
        await hook(event, ctx)
      }
    }

    const probeMessage = modules.state.pushMailboxMessage('guard-suite-team', 'team-lead', {
      from: 'planner-guard',
      to: 'team-lead',
      text: 'probe unrelated input should not sync',
      type: 'question',
      taskId: 'T001',
      threadId: 'task:T001',
      priority: 'normal',
      wakeHint: 'none',
    })

    await runInputHooks({ type: 'input', source: 'interactive', text: 'hello world' }, leaderCtx)

    let leaderMailbox = modules.state.readMailbox('guard-suite-team', 'team-lead')
    const unrelatedProbe = leaderMailbox.find(item => item.id === probeMessage.id)
    assert.equal(
      unrelatedProbe?.readAt,
      undefined,
      'non-agentteam interactive input should not trigger mailbox sync consumption',
    )

    await runInputHooks({ type: 'input', source: 'interactive', text: '/team-sync' }, leaderCtx)

    leaderMailbox = modules.state.readMailbox('guard-suite-team', 'team-lead')
    const syncedProbe = leaderMailbox.find(item => item.id === probeMessage.id)
    assert.equal(
      syncedProbe?.readAt,
      undefined,
      'team command input should not auto-consume leader mailbox (manual receive should own read-at transitions)',
    )

    const toolCallHooks = pi.__hooks.get('tool_call') || []
    async function runToolCallHooks(event, ctx) {
      for (const hook of toolCallHooks) {
        const result = await hook(event, ctx)
        if (result && result.block) return result
      }
      return undefined
    }

    let blocked = await runToolCallHooks(
      { type: 'tool_call', toolCallId: 'guard-hook-1', toolName: 'edit', input: {} },
      plannerCtx,
    )
    assert.equal(blocked?.block, true)

    blocked = await runToolCallHooks(
      { type: 'tool_call', toolCallId: 'guard-hook-2', toolName: 'agentteam_send', input: { to: 'researcher-guard', type: 'question' } },
      plannerCtx,
    )
    assert.equal(blocked, undefined)

    blocked = await runToolCallHooks(
      { type: 'tool_call', toolCallId: 'guard-hook-3', toolName: 'bash', input: { command: 'echo hi' } },
      plannerCtx,
    )
    assert.equal(blocked?.block, true)

    const allowed = await runToolCallHooks(
      { type: 'tool_call', toolCallId: 'guard-hook-4', toolName: 'find', input: { pattern: '*.md' } },
      plannerCtx,
    )
    assert.equal(allowed, undefined)

    const implementerAllowed = await runToolCallHooks(
      { type: 'tool_call', toolCallId: 'guard-hook-5', toolName: 'edit', input: {} },
      implementerCtx,
    )
    assert.equal(implementerAllowed, undefined)

    modules.state.deleteTeamState('guard-suite-team')
  },
}
