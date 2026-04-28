#!/usr/bin/env node
const cp = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function usage() {
  console.log(`Usage:
  node scripts/seed-team-panel.cjs [--home <dir>] [--clean] [--scenario cockpit] [--with-stale-pane]

Default:
  --home /tmp/pi-agentteam-panel-seed

Examples:
  # Safe isolated state for testing /team in a separate pi session
  node scripts/seed-team-panel.cjs --clean
  PI_AGENTTEAM_HOME=/tmp/pi-agentteam-panel-seed pi

  # Also create one real tmux orphan/stale pane for the Stale panes section
  node scripts/seed-team-panel.cjs --clean --with-stale-pane

  # Write into real agentteam state (be careful)
  node scripts/seed-team-panel.cjs --home ~/.pi/agent/agentteam
`)
}

function parseArgs(argv) {
  const args = {
    home: path.join(os.tmpdir(), 'pi-agentteam-panel-seed'),
    clean: false,
    scenario: 'cockpit',
    withStalePane: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    }
    if (arg === '--clean') {
      args.clean = true
      continue
    }
    if (arg === '--with-stale-pane') {
      args.withStalePane = true
      continue
    }
    if (arg === '--home') {
      const value = argv[++i]
      if (!value) throw new Error('--home requires a directory')
      args.home = path.resolve(value.replace(/^~(?=$|\/)/, os.homedir()))
      continue
    }
    if (arg === '--scenario') {
      const value = argv[++i]
      if (!value) throw new Error('--scenario requires a value')
      args.scenario = value
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  if (args.scenario !== 'cockpit') throw new Error(`Unsupported scenario: ${args.scenario}`)
  return args
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function writeJson(file, value) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function sanitizeName(name) {
  return String(name).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
}

function teamDir(root, teamName) {
  return path.join(root, 'teams', sanitizeName(teamName))
}

function mailboxPath(root, teamName, memberName) {
  return path.join(teamDir(root, teamName), 'mailboxes', `${sanitizeName(memberName)}.json`)
}

function workerSession(root, teamName, memberName) {
  const file = `${sanitizeName(teamName)}-${sanitizeName(memberName)}.jsonl`
  return path.join(root, 'worker-sessions', file)
}

function minutesAgo(minutes) {
  return Date.now() - minutes * 60_000
}

function makeMember(root, teamName, name, role, patch = {}) {
  return {
    name,
    role,
    cwd: '/tmp/pi-agentteam-panel-seed-project',
    sessionFile: workerSession(root, teamName, name),
    status: 'idle',
    createdAt: minutesAgo(180),
    updatedAt: minutesAgo(15),
    ...patch,
  }
}

function makeTask(id, patch = {}) {
  return {
    id,
    title: `Seed task ${id}`,
    description: `Seed description for ${id}`,
    status: 'pending',
    owner: undefined,
    blockedBy: [],
    notes: [],
    createdAt: minutesAgo(120),
    updatedAt: minutesAgo(60),
    ...patch,
  }
}

function note(author, text, minutes) {
  return {
    at: minutesAgo(minutes),
    author,
    text,
  }
}

function message(id, patch = {}) {
  const createdAt = patch.createdAt ?? minutesAgo(10)
  return {
    id,
    from: 'unknown',
    to: 'team-lead',
    text: 'seed message',
    type: 'fyi',
    priority: 'normal',
    createdAt,
    deliveredAt: patch.deliveredAt,
    readAt: patch.readAt,
    ...patch,
  }
}

function longDetailText(kind) {
  const cjk = '连续中文无空格长文本用于验证visible-width换行不会把详情撑爆也不会触发tmuxscrollback接管'.repeat(4)
  const token = 'very-long-token-for-wrapping-'.repeat(12)
  return [
    `${kind} long detail reader fixture. This intentionally spans many wrapped lines so the /team Details reader must scroll internally.`,
    '',
    'Checklist:',
    '1. The details box should stay bounded by terminal height.',
    '2. Arrow keys should scroll inside /team when details are expanded.',
    '3. Esc should collapse details without requiring terminal scrollback to return to bottom.',
    '4. Long words and CJK text should wrap by visible width.',
    '',
    `CJK: ${cjk}`,
    '',
    `Long token: ${token}`,
    '',
    'Evidence lines:',
    ...Array.from({ length: 18 }, (_, i) => `- ${kind} evidence line ${String(i + 1).padStart(2, '0')}: simulated finding, risk, owner, and validation note for manual reader testing.`),
    '',
    'End of long detail fixture. If you can read this line after scrolling, the internal reader has enough content.',
  ].join('\n')
}

function writeTeam(root, team) {
  writeJson(path.join(teamDir(root, team.name), 'state.json'), team)
}

function writeMailbox(root, teamName, memberName, messages) {
  writeJson(mailboxPath(root, teamName, memberName), messages)
}

function touchWorkerSessions(root, team) {
  ensureDir(path.join(root, 'worker-sessions'))
  for (const member of Object.values(team.members)) {
    if (member.name === 'team-lead') continue
    if (!member.sessionFile) continue
    ensureDir(path.dirname(member.sessionFile))
    if (!fs.existsSync(member.sessionFile)) fs.writeFileSync(member.sessionFile, '', 'utf8')
  }
}

function makeBaseTeam(root, name, description, revision = 1) {
  const createdAt = minutesAgo(240)
  const leaderSessionFile = path.join(root, `${sanitizeName(name)}-leader.jsonl`)
  return {
    version: 1,
    name,
    description,
    createdAt,
    leaderSessionFile,
    leaderCwd: '/tmp/pi-agentteam-panel-seed-project',
    members: {
      'team-lead': {
        name: 'team-lead',
        role: 'leader',
        cwd: '/tmp/pi-agentteam-panel-seed-project',
        sessionFile: leaderSessionFile,
        status: 'idle',
        createdAt,
        updatedAt: minutesAgo(5),
      },
    },
    tasks: {},
    events: [],
    nextTaskSeq: 1,
    revision,
    memberTombstones: {},
  }
}

function addTask(team, task) {
  team.tasks[task.id] = task
  const seq = Number(String(task.id).replace(/^T/, '')) + 1
  if (Number.isFinite(seq)) team.nextTaskSeq = Math.max(team.nextTaskSeq, seq)
  return task
}

function seedAlpha(root) {
  const team = makeBaseTeam(root, 'seed-cockpit-alpha', 'Dense cockpit team: attention, long details, mixed member health, many tasks/messages', 12)

  team.members['researcher-alpha'] = makeMember(root, team.name, 'researcher-alpha', 'researcher', {
    status: 'running',
    lastWakeReason: 'mailbox/task update',
    updatedAt: minutesAgo(1),
  })
  team.members['planner-alpha'] = makeMember(root, team.name, 'planner-alpha', 'planner', {
    status: 'queued',
    lastWakeReason: 'created waiting for follow-up instruction',
    updatedAt: minutesAgo(7),
  })
  team.members['implementer-alpha'] = makeMember(root, team.name, 'implementer-alpha', 'implementer', {
    status: 'error',
    lastWakeReason: 'pane lost',
    lastError: 'tmux pane disappeared',
    updatedAt: minutesAgo(14),
  })
  team.members['qa-alpha'] = makeMember(root, team.name, 'qa-alpha', 'researcher', {
    status: 'idle',
    lastWakeReason: 'finished turn',
    updatedAt: minutesAgo(33),
  })
  team.members['reviewer-alpha-long-name'] = makeMember(root, team.name, 'reviewer-alpha-long-name', 'planner', {
    status: 'idle',
    updatedAt: minutesAgo(57),
  })
  team.members['writer-alpha'] = makeMember(root, team.name, 'writer-alpha', 'implementer', {
    status: 'error',
    lastWakeReason: 'wake failed',
    lastError: 'manual seed error: simulated wake failure for error-member display',
    updatedAt: minutesAgo(44),
  })
  team.members['observer-alpha'] = makeMember(root, team.name, 'observer-alpha', 'researcher', {
    status: 'idle',
    updatedAt: minutesAgo(120),
  })

  addTask(team, makeTask('T001', {
    title: 'Read very long detail content inside /team',
    description: longDetailText('Task T001 description'),
    status: 'in_progress',
    owner: 'researcher-alpha',
    notes: [
      note('researcher-alpha', 'Found relevant files: teamPanel/layout.ts, teamPanel/viewModel.ts, tests/suites/panel-renderer.cjs.', 20),
      note('researcher-alpha', longDetailText('Latest note'), 3),
    ],
    createdAt: minutesAgo(140),
    updatedAt: minutesAgo(3),
  }))
  addTask(team, makeTask('T002', {
    title: 'Decide compact marker policy for global mode',
    description: 'Planner is blocked until leader chooses whether compact symbols are acceptable for npm users.',
    status: 'blocked',
    owner: 'planner-alpha',
    blockedBy: ['leader decision on visual density', 'confirm narrow terminal behavior'],
    notes: [note('planner-alpha', 'Options: compact symbols, words, or details-only. Recommendation: compact rows, words in Details.', 18)],
    createdAt: minutesAgo(130),
    updatedAt: minutesAgo(18),
  }))
  addTask(team, makeTask('T003', {
    title: 'Unowned pending follow-up after teammate removal',
    description: 'This intentionally has no owner so /team can show unowned active task attention.',
    status: 'pending',
    owner: undefined,
    notes: [note('team-lead', 'Owner was removed in a previous test; task returned to pending.', 35)],
    createdAt: minutesAgo(125),
    updatedAt: minutesAgo(35),
  }))
  addTask(team, makeTask('T004', {
    title: 'Completed baseline render regression',
    description: 'A completed task for task breakdown testing.',
    status: 'completed',
    owner: 'implementer-alpha',
    notes: [note('implementer-alpha', 'Files changed: teamPanel/layout.ts. Checks run: npm test. Result: passed.', 55)],
    createdAt: minutesAgo(120),
    updatedAt: minutesAgo(55),
  }))
  addTask(team, makeTask('T005', {
    title: 'Queued teammate boot prompt review',
    description: 'A pending owned task so the task list has enough rows for scrolling indicators.',
    status: 'pending',
    owner: 'qa-alpha',
    notes: [note('qa-alpha', 'Waiting for leader to decide whether this should be assigned.', 42)],
    createdAt: minutesAgo(100),
    updatedAt: minutesAgo(42),
  }))
  addTask(team, makeTask('T006', {
    title: 'Generic wake failure follow-up',
    description: 'Owned by error member to verify member health details and task counts.',
    status: 'in_progress',
    owner: 'writer-alpha',
    notes: [note('writer-alpha', 'Could not wake pane; needs leader cleanup or respawn decision.', 39)],
    createdAt: minutesAgo(90),
    updatedAt: minutesAgo(39),
  }))
  addTask(team, makeTask('T007', {
    title: 'Read-only observer audit',
    description: 'Extra task to make the task list taller than the visible window.',
    status: 'pending',
    owner: 'observer-alpha',
    notes: [note('observer-alpha', 'No action yet.', 70)],
    createdAt: minutesAgo(80),
    updatedAt: minutesAgo(70),
  }))
  addTask(team, makeTask('T008', {
    title: 'Completed density snapshot',
    description: 'Additional completed task for global done count.',
    status: 'completed',
    owner: 'reviewer-alpha-long-name',
    notes: [note('reviewer-alpha-long-name', 'Visual density snapshot accepted.', 65)],
    createdAt: minutesAgo(75),
    updatedAt: minutesAgo(65),
  }))

  writeTeam(root, team)
  writeMailbox(root, team.name, 'team-lead', [
    message('seed-alpha-m1', {
      from: 'planner-alpha',
      type: 'blocked',
      priority: 'high',
      taskId: 'T002',
      threadId: 'task:T002',
      summary: 'Blocked on compact marker decision',
      text: longDetailText('Blocked mailbox message'),
      createdAt: minutesAgo(12),
      deliveredAt: minutesAgo(12),
    }),
    message('seed-alpha-m2', {
      from: 'researcher-alpha',
      type: 'question',
      priority: 'high',
      taskId: 'T001',
      threadId: 'task:T001',
      summary: 'Need leader decision on Details reader behavior',
      text: 'Should long notes prefer internal /team reader over terminal scrollback? This should stay unread and visible.',
      createdAt: minutesAgo(9),
    }),
    message('seed-alpha-m3', {
      from: 'implementer-alpha',
      type: 'completion_report',
      priority: 'normal',
      taskId: 'T004',
      threadId: 'task:T004',
      summary: 'Render regression passed',
      text: 'Files changed: teamPanel/layout.ts. Checks run: npm test. Validation result: passed.',
      createdAt: minutesAgo(8),
      deliveredAt: minutesAgo(8),
    }),
    message('seed-alpha-m4', {
      from: 'writer-alpha',
      type: 'blocked',
      priority: 'normal',
      taskId: 'T006',
      threadId: 'task:T006',
      summary: 'Wake failure needs cleanup decision',
      text: 'The writer pane failed to wake. Use this message to verify blocked mail attention and action menu wording.',
      createdAt: minutesAgo(7),
    }),
    message('seed-alpha-m5', {
      from: 'qa-alpha',
      type: 'fyi',
      priority: 'low',
      taskId: 'T005',
      threadId: 'task:T005',
      summary: 'FYI unread low priority',
      text: 'Low priority unread FYI should still count as unread but appear below urgent blocked/question messages.',
      createdAt: minutesAgo(6),
    }),
    message('seed-alpha-m6', {
      from: 'reviewer-alpha-long-name',
      type: 'completion_report',
      priority: 'normal',
      taskId: 'T008',
      threadId: 'task:T008',
      summary: 'Already read completion',
      text: 'This read message should remain visible in mailbox history but not count as unread.',
      createdAt: minutesAgo(50),
      deliveredAt: minutesAgo(50),
      readAt: minutesAgo(49),
    }),
    message('seed-alpha-m7', {
      from: 'observer-alpha',
      type: 'fyi',
      priority: 'normal',
      summary: 'Old read observer note',
      text: 'Read FYI used to verify read/unread visual contrast.',
      createdAt: minutesAgo(70),
      deliveredAt: minutesAgo(70),
      readAt: minutesAgo(69),
    }),
    message('seed-alpha-m8', {
      from: 'researcher-alpha',
      type: 'fyi',
      priority: 'normal',
      summary: 'Additional unread row to force mailbox windowing',
      text: 'Extra unread mailbox item so the mailbox list can show hidden rows below.',
      createdAt: minutesAgo(5),
    }),
  ])

  for (const memberName of Object.keys(team.members)) {
    if (memberName === 'team-lead') continue
    writeMailbox(root, team.name, memberName, [])
  }
  touchWorkerSessions(root, team)
  return team.name
}

function seedBeta(root) {
  const team = makeBaseTeam(root, 'seed-global-beta', 'Global-mode team with stale work, blocked mailbox, and roster preview', 5)
  team.members['researcher-beta'] = makeMember(root, team.name, 'researcher-beta', 'researcher', { status: 'idle', updatedAt: minutesAgo(300) })
  team.members['planner-beta'] = makeMember(root, team.name, 'planner-beta', 'planner', { status: 'error', lastError: 'manual seed error: worker exited', updatedAt: minutesAgo(180) })
  team.members['implementer-beta'] = makeMember(root, team.name, 'implementer-beta', 'implementer', { status: 'idle', updatedAt: minutesAgo(160) })
  team.members['qa-beta'] = makeMember(root, team.name, 'qa-beta', 'researcher', { status: 'queued', lastWakeReason: 'created', updatedAt: minutesAgo(140) })
  team.members['reviewer-beta'] = makeMember(root, team.name, 'reviewer-beta', 'planner', { status: 'idle', updatedAt: minutesAgo(130) })
  team.members['writer-beta'] = makeMember(root, team.name, 'writer-beta', 'implementer', { status: 'idle', updatedAt: minutesAgo(125) })

  addTask(team, makeTask('T001', {
    title: 'Old blocked global task',
    description: 'Used to verify global mode details without an attached session.',
    status: 'blocked',
    owner: 'planner-beta',
    blockedBy: ['worker exited'],
    notes: [note('planner-beta', 'Cannot continue because the worker pane is gone.', 170)],
    createdAt: minutesAgo(260),
    updatedAt: minutesAgo(170),
  }))
  addTask(team, makeTask('T002', {
    title: 'Unowned cleanup review',
    description: 'Used to verify unowned task attention in global mode.',
    status: 'pending',
    owner: undefined,
    createdAt: minutesAgo(250),
    updatedAt: minutesAgo(160),
  }))
  addTask(team, makeTask('T003', {
    title: 'Completed old implementation',
    description: 'Used for global task breakdown done count.',
    status: 'completed',
    owner: 'implementer-beta',
    createdAt: minutesAgo(245),
    updatedAt: minutesAgo(155),
  }))

  writeTeam(root, team)
  writeMailbox(root, team.name, 'team-lead', [
    message('seed-beta-m1', {
      from: 'planner-beta',
      type: 'blocked',
      priority: 'high',
      taskId: 'T001',
      summary: 'Old team blocked because worker exited',
      text: 'The old beta team is blocked. This is useful for checking global mode recover/delete decisions.',
      createdAt: minutesAgo(150),
      deliveredAt: minutesAgo(150),
    }),
    message('seed-beta-m2', {
      from: 'qa-beta',
      type: 'question',
      priority: 'normal',
      taskId: 'T002',
      summary: 'Should this old team be recovered?',
      text: 'Question message used to verify global latest mail attention source.',
      createdAt: minutesAgo(120),
    }),
  ])
  for (const memberName of Object.keys(team.members)) {
    if (memberName === 'team-lead') continue
    writeMailbox(root, team.name, memberName, [])
  }
  touchWorkerSessions(root, team)
  return team.name
}

function seedGamma(root) {
  const team = makeBaseTeam(root, 'seed-clean-gamma', 'Clean team with OK global row and no attention', 2)
  team.members['implementer-gamma'] = makeMember(root, team.name, 'implementer-gamma', 'implementer', {
    status: 'idle',
    updatedAt: minutesAgo(4),
  })
  addTask(team, makeTask('T001', {
    title: 'Completed clean team task',
    description: 'A quiet completed task so /team can show Attention OK for one team.',
    status: 'completed',
    owner: 'implementer-gamma',
    notes: [note('implementer-gamma', 'All checks passed.', 3)],
    createdAt: minutesAgo(20),
    updatedAt: minutesAgo(3),
  }))
  writeTeam(root, team)
  writeMailbox(root, team.name, 'team-lead', [
    message('seed-gamma-m1', {
      from: 'implementer-gamma',
      type: 'completion_report',
      priority: 'normal',
      taskId: 'T001',
      summary: 'Already read completion',
      text: 'This clean team has no unread attention.',
      createdAt: minutesAgo(2),
      deliveredAt: minutesAgo(2),
      readAt: minutesAgo(1),
    }),
  ])
  writeMailbox(root, team.name, 'implementer-gamma', [])
  touchWorkerSessions(root, team)
  return team.name
}

function seedCockpit(root) {
  return [seedAlpha(root), seedBeta(root), seedGamma(root)]
}

function runTmux(args) {
  return cp.spawnSync('tmux', args, { encoding: 'utf8' })
}

function createStalePaneIfRequested(enabled) {
  if (!enabled) return null
  if (!process.env.TMUX) {
    return { warning: '--with-stale-pane requested, but this shell is not inside tmux; skipped stale pane creation.' }
  }
  const split = runTmux(['split-window', '-h', '-P', '-F', '#{pane_id}', 'sleep 3600'])
  if (split.status !== 0 || !split.stdout.trim()) {
    return { warning: `failed to create stale pane: ${split.stderr || split.stdout || 'unknown tmux error'}` }
  }
  const paneId = split.stdout.trim()
  const label = 'seed stale orphan · cleanup candidate'
  runTmux(['set-option', '-p', '-t', paneId, '@agentteam-name', label])
  runTmux(['select-pane', '-t', paneId, '-T', label])
  runTmux(['set-option', '-w', 'pane-border-status', 'top'])
  runTmux(['set-option', '-w', 'pane-border-format', '#{?@agentteam-name,#{@agentteam-name},#{pane_title}}'])
  return { paneId, label }
}

const args = parseArgs(process.argv.slice(2))

if (args.clean) {
  fs.rmSync(args.home, { recursive: true, force: true })
}
ensureDir(args.home)
ensureDir(path.join(args.home, 'teams'))
ensureDir(path.join(args.home, 'worker-sessions'))
ensureDir(path.join(args.home, 'session-bindings'))

const teams = seedCockpit(args.home)
const stalePane = createStalePaneIfRequested(args.withStalePane)

console.log(`✅ Seeded ${teams.length} team(s) for /team panel testing`)
console.log(`State root: ${args.home}`)
console.log(`Teams: ${teams.join(', ')}`)
if (stalePane?.paneId) console.log(`Stale pane: ${stalePane.paneId} (${stalePane.label})`)
if (stalePane?.warning) console.log(`⚠ ${stalePane.warning}`)
console.log('')
console.log('Recommended safe test:')
console.log(`  PI_AGENTTEAM_HOME=${args.home} pi`)
console.log('  then open /team')
console.log('')
console.log('Manual gate coverage tips:')
console.log('  1. /team opens global mode with noisy, old, and clean teams.')
console.log('  2. Select seed-clean-gamma to confirm an OK row.')
console.log('  3. Select seed-cockpit-alpha, Enter, Recover as current leader to inspect attached Members/Tasks/Mailbox.')
console.log('  4. In attached mode, Tab to Tasks or Mailbox and expand Details on T001 or seed-alpha-m1 for long-reader testing.')
console.log('  5. Use Enter on action menus to inspect target naming and current-pane safety wording; cancel unless intentionally testing actions.')
if (args.withStalePane) console.log('  6. Global mode should also show the created stale pane under Stale panes.')
console.log('')
console.log('Clean up:')
console.log(`  rm -rf ${args.home}`)
if (stalePane?.paneId) console.log(`  tmux kill-pane -t ${stalePane.paneId}`)
