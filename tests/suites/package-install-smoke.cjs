const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

module.exports = {
  name: 'package install smoke',
  async run(env) {
    const root = path.resolve(__dirname, '..', '..')
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

    assert.equal(pkg.name, 'pi-agentteam')
    assert.ok(pkg.pi && Array.isArray(pkg.pi.extensions), 'package.json should declare pi.extensions')
    assert.ok(pkg.pi.extensions.includes('./index.ts'), 'package.json should expose ./index.ts as pi extension entry')

    const files = pkg.files || []
    assert.ok(files.includes('commands/'), 'package files should include command console submodules')
    assert.ok(files.includes('state/'), 'package files should include state submodules')
    assert.ok(files.includes('teamPanel/'), 'package files should include team panel submodules')
    assert.ok(files.includes('tmux/'), 'package files should include tmux submodules')
    assert.ok(files.includes('*.ts'), 'package files should include top-level runtime facade/submodules')
    assert.ok(!files.includes('tests/'), 'published package should not include test suites')
    assert.ok(!files.includes('scripts/'), 'published package should not include local development seed scripts')

    const toolRegistrationFiles = [
      'tools/team.ts',
      'tools/message.ts',
      'tools/task.ts',
    ]
    for (const file of toolRegistrationFiles) {
      const text = fs.readFileSync(path.join(root, file), 'utf8')
      assert.ok(!text.includes("../state.js"), `${file} should delegate state access to service modules`)
      assert.ok(!text.includes("../tmux.js"), `${file} should delegate tmux access to service modules`)
      assert.ok(!text.includes("../agents.js"), `${file} should delegate agent discovery to service modules`)
    }

    const removedFiles = [
      'commands/cleanup.ts',
      'tools/messageMirror.ts',
      'tools/taskUtils.ts',
      'docs/release-checklist.md',
      'docs/testing-real-experience.md',
    ]
    for (const file of removedFiles) {
      assert.equal(fs.existsSync(path.join(root, file)), false, `${file} should not exist before release`)
    }

    const sourceText = [
      ...toolRegistrationFiles,
      'tmux/core.ts',
      'tmux/panes.ts',
      'tmux/windows.ts',
    ].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n')
    assert.ok(!sourceText.includes('@sinclair/typebox'), 'source should use typebox, not @sinclair/typebox')
    for (const name of [
      'ensureTmuxAvailableAsync',
      'firstPaneInWindowAsync',
      'windowExistsAsync',
      'markWindowAsAgentTeamAsync',
      'refreshWindowPaneLabelsAsync',
    ]) {
      assert.ok(!sourceText.includes(name), `source should not reference removed helper ${name}`)
    }

    const researcherPrompt = fs.readFileSync(path.join(root, 'agents/researcher.md'), 'utf8')
    assert.ok(researcherPrompt.includes('Core question: What is true?'), 'researcher prompt should be fact-focused')
    assert.ok(researcherPrompt.includes('Avoid full implementation planning unless team-lead explicitly asks'), 'researcher should avoid full planning by default')

    const plannerPrompt = fs.readFileSync(path.join(root, 'agents/planner.md'), 'utf8')
    assert.ok(plannerPrompt.includes('not a second leader'), 'planner prompt should preserve advisory role')
    assert.ok(plannerPrompt.includes('Do not create downstream execution tasks by default'), 'planner should not own downstream task creation by default')
    assert.ok(plannerPrompt.includes('Only create/update task-board decomposition when team-lead explicitly asks'), 'planner task-board decomposition should be explicit')

    const implementerPrompt = fs.readFileSync(path.join(root, 'agents/implementer.md'), 'utf8')
    assert.ok(implementerPrompt.includes('Core question: Make it real.'), 'implementer prompt should be execution-focused')
    assert.ok(implementerPrompt.includes('assigned task boundary'), 'implementer should stay within task boundary')

    const peers = pkg.peerDependencies || {}
    assert.equal(peers['@mariozechner/pi-ai'], '*', 'peerDependencies should include @mariozechner/pi-ai')
    assert.equal(peers['typebox'], '*', 'peerDependencies should include typebox')
    assert.equal(peers['@mariozechner/pi-coding-agent'], '*')
    assert.equal(peers['@mariozechner/pi-tui'], '*')

    const requiredTools = [
      'agentteam_create',
      'agentteam_spawn',
      'agentteam_send',
      'agentteam_receive',
      'agentteam_task',
    ]

    for (const name of requiredTools) {
      const tool = env.pi.__tools.get(name)
      assert.ok(tool, `tool should be registered: ${name}`)
      assert.ok(typeof tool.promptSnippet === 'string' && tool.promptSnippet.length > 0, `${name} should define promptSnippet`)
      assert.ok(Array.isArray(tool.promptGuidelines) && tool.promptGuidelines.length > 0, `${name} should define promptGuidelines`)
    }

    const messageTool = env.pi.__tools.get('agentteam_send')
    assert.deepEqual(messageTool.parameters.o.type.v.enum, ['assignment', 'question', 'blocked', 'completion_report', 'fyi'])
    assert.deepEqual(messageTool.parameters.o.priority.v.enum, ['low', 'normal', 'high'])

    const taskTool = env.pi.__tools.get('agentteam_task')
    assert.deepEqual(taskTool.parameters.o.action.enum, ['create', 'list', 'claim', 'update', 'complete', 'note'])
    assert.deepEqual(taskTool.parameters.o.status.v.enum, ['pending', 'in_progress', 'blocked', 'completed'])

    assert.deepEqual([...env.pi.__commands.keys()].filter(name => name.startsWith('team')), ['team'])
  },
}
