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
    assert.ok(files.includes('state/'), 'package files should include state submodules')
    assert.ok(files.includes('tmux/'), 'package files should include tmux submodules')
    assert.ok(!files.includes('tests/'), 'published package should not include test suites')

    const sourceText = [
      'tools/team.ts',
      'tools/message.ts',
      'tools/task.ts',
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
  },
}
