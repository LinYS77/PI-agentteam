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
  const now = Date.now()
  return {
    name,
    role,
    cwd: '/tmp/pi-agentteam-panel-seed-project',
    sessionFile: workerSession(root, teamName, name),
    status: 'idle',
    createdAt: minutesAgo(180),
    updatedAt: now,
    ...patch,
  }
}

function makeTask(id, patch = {}) {
  const now = Date.now()
  return {
    id,
    title: `Seed task ${id}`,
    description: `Seed description for ${id}`,
    status: 'pending',
    owner: undefined,
    blockedBy: [],
    notes: [],
    createdAt: now,
    updatedAt: now,
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

function seedCockpit(root) {
  const alpha = makeBaseTeam(root, 'seed-cockpit-alpha', 'Attached-style team with mixed attention states', 7)
  alpha.members.researcher = makeMember(root, alpha.name, 'researcher', 'researcher', {
    status: 'running',
    lastWakeReason: 'mailbox/task update',
    updatedAt: minutesAgo(1),
  })
  alpha.members.planner = makeMember(root, alpha.name, 'planner', 'planner', {
    status: 'idle',
    updatedAt: minutesAgo(32),
  })
  alpha.members.implementer = makeMember(root, alpha.name, 'implementer', 'implementer', {
    status: 'error',
    lastWakeReason: 'pane lost',
    lastError: 'tmux pane disappeared',
    updatedAt: minutesAgo(14),
  })

  addTask(alpha, makeTask('T001', {
    title: 'Research the failing /team attention rendering path',
    description: 'Find likely files and constraints. This task is in progress and owned by researcher.',
    status: 'in_progress',
    owner: 'researcher',
    notes: [note('researcher', 'Found relevant files: teamPanel/layout.ts, teamPanel/viewModel.ts, tests/suites/panel-renderer.cjs. Risk: long attention strings can be clipped on narrow terminals.', 8)],
    createdAt: minutesAgo(90),
    updatedAt: minutesAgo(8),
  }))
  addTask(alpha, makeTask('T002', {
    title: 'Decide compact marker policy for global mode',
    description: 'Planner is blocked until leader chooses whether compact symbols are acceptable for npm users.',
    status: 'blocked',
    owner: 'planner',
    blockedBy: ['leader decision on visual density'],
    notes: [note('planner', 'Options: keep compact symbols, switch to words, or show only in Details. Recommendation: compact in rows, words in Details.', 18)],
    createdAt: minutesAgo(75),
    updatedAt: minutesAgo(18),
  }))
  addTask(alpha, makeTask('T003', {
    title: 'Unowned pending follow-up after teammate removal',
    description: 'This intentionally has no owner so /team can show unowned active task attention.',
    status: 'pending',
    owner: undefined,
    notes: [note('team-lead', 'Owner was removed in a previous test; task returned to pending.', 35)],
    createdAt: minutesAgo(60),
    updatedAt: minutesAgo(35),
  }))
  addTask(alpha, makeTask('T004', {
    title: 'Completed baseline render regression',
    description: 'A completed task for task breakdown testing.',
    status: 'completed',
    owner: 'implementer',
    notes: [note('implementer', 'Changed files: teamPanel/layout.ts. Checks: npm test. Result: passed.', 55)],
    createdAt: minutesAgo(120),
    updatedAt: minutesAgo(55),
  }))

  writeTeam(root, alpha)
  writeMailbox(root, alpha.name, 'team-lead', [
    message('seed-alpha-m1', {
      from: 'planner',
      type: 'blocked',
      priority: 'high',
      taskId: 'T002',
      summary: 'Blocked on visual density decision',
      text: 'T002 is blocked. Please choose compact marker policy for global rows: symbols, words, or details-only.',
      createdAt: minutesAgo(12),
      deliveredAt: minutesAgo(12),
    }),
    message('seed-alpha-m2', {
      from: 'researcher',
      type: 'completion_report',
      priority: 'normal',
      taskId: 'T001',
      summary: 'Research complete with likely files',
      text: 'Research found teamPanel/layout.ts and viewModel.ts as primary files. Watch for width clipping and nested colored strings.',
      createdAt: minutesAgo(6),
      deliveredAt: minutesAgo(6),
    }),
    message('seed-alpha-m3', {
      from: 'implementer',
      type: 'fyi',
      priority: 'low',
      summary: 'Old read FYI',
      text: 'This message is already read and should not count as unread.',
      createdAt: minutesAgo(80),
      deliveredAt: minutesAgo(80),
      readAt: minutesAgo(79),
    }),
  ])
  for (const memberName of ['researcher', 'planner', 'implementer']) writeMailbox(root, alpha.name, memberName, [])
  touchWorkerSessions(root, alpha)

  const beta = makeBaseTeam(root, 'seed-global-beta', 'Global-mode team with no live panes and stale work', 4)
  beta.members.researcher2 = makeMember(root, beta.name, 'researcher2', 'researcher', {
    status: 'idle',
    updatedAt: minutesAgo(300),
  })
  beta.members.planner2 = makeMember(root, beta.name, 'planner2', 'planner', {
    status: 'error',
    lastError: 'manual seed error: worker exited',
    updatedAt: minutesAgo(180),
  })
  addTask(beta, makeTask('T001', {
    title: 'Old blocked global task',
    description: 'Used to verify global mode details without an attached session.',
    status: 'blocked',
    owner: 'planner2',
    blockedBy: ['worker exited'],
    notes: [note('planner2', 'Cannot continue because the worker pane is gone.', 170)],
    createdAt: minutesAgo(260),
    updatedAt: minutesAgo(170),
  }))
  addTask(beta, makeTask('T002', {
    title: 'Unowned cleanup review',
    description: 'Used to verify unowned task attention in global mode.',
    status: 'pending',
    owner: undefined,
    createdAt: minutesAgo(250),
    updatedAt: minutesAgo(160),
  }))
  writeTeam(root, beta)
  writeMailbox(root, beta.name, 'team-lead', [
    message('seed-beta-m1', {
      from: 'planner2',
      type: 'blocked',
      priority: 'high',
      taskId: 'T001',
      summary: 'Old team blocked because worker exited',
      text: 'The old beta team is blocked. This is useful for checking global mode recover/delete decisions.',
      createdAt: minutesAgo(150),
      deliveredAt: minutesAgo(150),
    }),
  ])
  for (const memberName of ['researcher2', 'planner2']) writeMailbox(root, beta.name, memberName, [])
  touchWorkerSessions(root, beta)

  const gamma = makeBaseTeam(root, 'seed-clean-gamma', 'Clean team with mostly OK status', 2)
  gamma.members.implementer3 = makeMember(root, gamma.name, 'implementer3', 'implementer', {
    status: 'idle',
    updatedAt: minutesAgo(4),
  })
  addTask(gamma, makeTask('T001', {
    title: 'Completed clean team task',
    description: 'A quiet completed task so /team can show Attention OK for one team.',
    status: 'completed',
    owner: 'implementer3',
    notes: [note('implementer3', 'All checks passed.', 3)],
    createdAt: minutesAgo(20),
    updatedAt: minutesAgo(3),
  }))
  writeTeam(root, gamma)
  writeMailbox(root, gamma.name, 'team-lead', [
    message('seed-gamma-m1', {
      from: 'implementer3',
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
  writeMailbox(root, gamma.name, 'implementer3', [])
  touchWorkerSessions(root, gamma)

  return [alpha.name, beta.name, gamma.name]
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
console.log('Clean up:')
console.log(`  rm -rf ${args.home}`)
if (stalePane?.paneId) console.log(`  tmux kill-pane -t ${stalePane.paneId}`)
