#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')

const DEFAULT_EXT_ROOT = path.resolve(__dirname, '..')
const EXT_ROOT = process.env.AGENTTEAM_EXT_ROOT
  ? path.resolve(process.env.AGENTTEAM_EXT_ROOT)
  : DEFAULT_EXT_ROOT
function requireTypeScript() {
  try {
    return require('typescript')
  } catch {
    return require('/home/linyusheng/.nvm/versions/node/v24.9.0/lib/node_modules/typescript')
  }
}
const ts = requireTypeScript()

const BUILD_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'agentteam-test-build-'))
const DIST_ROOT = path.join(BUILD_ROOT, 'dist')
const STUB_ROOT = path.join(DIST_ROOT, 'stubs')
process.env.PI_AGENTTEAM_HOME = path.join(BUILD_ROOT, 'agentteam-home')
process.env.TMUX = process.env.TMUX || '/tmp/agentteam-test-tmux'


function log(msg) {
  process.stdout.write(`${msg}\n`)
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function walkFiles(root, out = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'data' || entry.name === 'tests' || entry.name === 'node_modules') continue
      walkFiles(full, out)
      continue
    }
    if (entry.isFile() && full.endsWith('.ts')) out.push(full)
  }
  return out
}

function writeFile(p, content) {
  ensureDir(path.dirname(p))
  fs.writeFileSync(p, content, 'utf8')
}

function createStubs() {
  writeFile(
    path.join(STUB_ROOT, 'pi-coding-agent.js'),
    `
function parseFrontmatter(content) {
  const s = String(content || '')
  const m = s.match(/^---\\n([\\s\\S]*?)\\n---\\n?([\\s\\S]*)$/)
  if (!m) return { frontmatter: {}, body: s }
  const frontmatter = {}
  for (const line of m[1].split('\\n')) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (key) frontmatter[key] = value
  }
  return { frontmatter, body: m[2] || '' }
}

module.exports = { parseFrontmatter }
`,
  )

  writeFile(
    path.join(STUB_ROOT, 'pi-tui.js'),
    `
function visibleWidth(text) {
  const raw = String(text || '')
  const stripped = raw.replace(/\\u001b\\[[0-9;]*m/g, '')
  return [...stripped].length
}

function truncateToWidth(text, width) {
  const safe = Math.max(0, Number.isFinite(width) ? width : 0)
  const raw = String(text || '')
  let out = ''
  let count = 0
  for (const ch of [...raw]) {
    if (count >= safe) break
    out += ch
    count += 1
  }
  return out
}

class Text {
  constructor(text, x = 0, y = 0) {
    this.text = String(text || '')
    this.x = x
    this.y = y
  }
}

class Box {
  constructor() {
    this.children = []
  }
  addChild(child) {
    this.children.push(child)
  }
}

const Key = {
  tab: '__tab__',
  up: '__up__',
  down: '__down__',
  escape: '__esc__',
  enter: '__enter__',
}

function matchesKey(input, key) {
  return input === key
}

module.exports = {
  visibleWidth,
  truncateToWidth,
  Text,
  Box,
  Key,
  matchesKey,
}
`,
  )

  writeFile(
    path.join(STUB_ROOT, 'typebox.js'),
    `
const Type = {
  Object: o => ({ kind: 'object', o }),
  String: o => ({ kind: 'string', o }),
  Optional: v => ({ kind: 'optional', v }),
  Union: v => ({ kind: 'union', v }),
  Literal: v => ({ kind: 'literal', v }),
  Array: (v, o) => ({ kind: 'array', v, o }),
  Number: o => ({ kind: 'number', o }),
  Boolean: o => ({ kind: 'boolean', o }),
  Record: (k, v) => ({ kind: 'record', k, v }),
  Unknown: () => ({ kind: 'unknown' }),
}
module.exports = { Type }
`,
  )

  writeFile(
    path.join(STUB_ROOT, 'pi-ai.js'),
    `
const { Type } = require('./typebox.js')
function StringEnum(values, options) {
  return { kind: 'string-enum', enum: [...values], options: options || {} }
}
module.exports = { Type, StringEnum }
`,
  )
}

function mapImport(specifier) {
  if (specifier === '@mariozechner/pi-coding-agent') return path.join(STUB_ROOT, 'pi-coding-agent.js')
  if (specifier === '@mariozechner/pi-ai') return path.join(STUB_ROOT, 'pi-ai.js')
  if (specifier === '@mariozechner/pi-tui') return path.join(STUB_ROOT, 'pi-tui.js')
  if (specifier === 'typebox') return path.join(STUB_ROOT, 'typebox.js')
  return specifier
}

function transpile() {
  ensureDir(DIST_ROOT)
  const files = walkFiles(EXT_ROOT)
  for (const sourceFile of files) {
    const sourceText = fs.readFileSync(sourceFile, 'utf8')
    let out = ts.transpileModule(sourceText, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: sourceFile,
      reportDiagnostics: false,
    }).outputText

    out = out.replace(/require\((['"])([^'"]+)\1\)/g, (_, q, s) => {
      return `require(${q}${mapImport(s)}${q})`
    })

    const relative = path.relative(EXT_ROOT, sourceFile).replace(/\.ts$/, '.js')
    const target = path.join(DIST_ROOT, relative)
    writeFile(target, out)
  }
}

function createFakeTheme() {
  const passthrough = v => String(v ?? '')
  return {
    fg: (_name, text) => String(text ?? ''),
    bg: (_name, text) => String(text ?? ''),
    bold: passthrough,
  }
}

function createStubPi() {
  const tools = new Map()
  const commands = new Map()
  const hooks = new Map()
  const renderers = new Map()
  const messages = []

  return {
    registerTool(def) { tools.set(def.name, def) },
    registerCommand(name, def) { commands.set(name, def) },
    on(name, handler) {
      const list = hooks.get(name) || []
      list.push(handler)
      hooks.set(name, list)
    },
    registerMessageRenderer(type, renderer) { renderers.set(type, renderer) },
    sendMessage(message) { messages.push(message) },
    sendUserMessage(content, options) {
      messages.push({ customType: 'user-message', content, details: options || {} })
    },
    __tools: tools,
    __commands: commands,
    __hooks: hooks,
    __renderers: renderers,
    __messages: messages,
  }
}

function createCtx(cwd, sessionFile, notifications) {
  return {
    cwd,
    sessionManager: {
      getSessionFile() { return sessionFile },
    },
    ui: {
      notify(message, level) {
        notifications.push({ message, level })
      },
      setStatus() {},
      setWidget() {},
      confirm: async () => true,
      custom: async callback => {
        let doneValue
        const done = value => { doneValue = value }
        const panel = await callback({ requestRender() {}, terminal: { rows: 40, columns: 120 } }, createFakeTheme(), {}, done)
        if (doneValue === undefined && panel && typeof panel.handleInput === 'function') {
          panel.handleInput('__esc__')
        }
        return doneValue
      },
      theme: createFakeTheme(),
    },
  }
}

function assertContains(text, expected, msg) {
  assert.ok(String(text).includes(expected), msg || `Expected text to contain: ${expected}\nActual: ${text}`)
}

function setupRuntimePatches(modules) {
  const sentPrompts = []
  const clearedPaneLabels = []
  const tmux = modules.tmux

  const original = {
    captureCurrentPaneBinding: tmux.captureCurrentPaneBinding,
    resolvePaneBinding: tmux.resolvePaneBinding,
    paneExists: tmux.paneExists,
    createTeammatePane: tmux.createTeammatePane,
    waitForPaneAppStart: tmux.waitForPaneAppStart,
    sendPromptToPane: tmux.sendPromptToPane,
    sendEnterToPane: tmux.sendEnterToPane,
    syncPaneLabelsForTeam: tmux.syncPaneLabelsForTeam,
    clearPaneLabelsForTeam: tmux.clearPaneLabelsForTeam,
    clearPaneLabelSync: tmux.clearPaneLabelSync,
    ensureSwarmWindow: tmux.ensureSwarmWindow,
    killPane: tmux.killPane,
    listAgentTeamPanes: tmux.listAgentTeamPanes,
  }

  const livePanes = new Set(['%leader'])
  let nextPane = 10

  tmux.captureCurrentPaneBinding = () => ({ paneId: '%leader', target: 'test:@1' })
  tmux.resolvePaneBinding = paneId => (livePanes.has(paneId) ? { paneId, target: 'test:@1' } : null)
  tmux.paneExists = paneId => livePanes.has(paneId)
  tmux.createTeammatePane = async () => {
    const paneId = `%${nextPane++}`
    livePanes.add(paneId)
    return { paneId, target: 'test:@1' }
  }
  tmux.waitForPaneAppStart = async () => true
  tmux.sendPromptToPane = async (paneId, prompt) => { sentPrompts.push({ paneId, prompt }) }
  tmux.sendEnterToPane = () => {}
  tmux.syncPaneLabelsForTeam = () => {}
  tmux.clearPaneLabelsForTeam = () => {}
  tmux.clearPaneLabelSync = paneId => { clearedPaneLabels.push(paneId) }
  tmux.ensureSwarmWindow = async () => ({ session: 'test', window: '@1', target: 'test:@1', leaderPaneId: '%leader' })
  tmux.killPane = paneId => { livePanes.delete(paneId) }
  tmux.listAgentTeamPanes = () => []

  const agents = modules.agents
  const originalDiscoverAgents = agents.discoverAgents
  agents.discoverAgents = () => [
    { name: 'planner', description: 'planner', tools: ['read', 'grep', 'find', 'ls', 'agentteam_send', 'agentteam_receive', 'agentteam_task'], model: '077-gpt-5.4', systemPrompt: 'planner prompt', source: 'builtin', filePath: '/tmp/planner.md' },
    { name: 'researcher', description: 'researcher', tools: ['read', 'grep', 'find', 'ls', 'agentteam_send', 'agentteam_receive', 'agentteam_task'], model: '077-glm-5.1', systemPrompt: 'researcher prompt', source: 'builtin', filePath: '/tmp/researcher.md' },
    { name: 'implementer', description: 'implementer', tools: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write', 'agentteam_send', 'agentteam_receive', 'agentteam_task'], model: '077-gpt-5.3-codex', systemPrompt: 'implementer prompt', source: 'builtin', filePath: '/tmp/implementer.md' },
  ]

  return {
    sentPrompts,
    livePanes,
    clearedPaneLabels,
    restore() {
      Object.assign(tmux, original)
      agents.discoverAgents = originalDiscoverAgents
    },
  }
}

function loadModules() {
  const req = rel => require(path.join(DIST_ROOT, rel))
  return {
    index: req('index.js'),
    state: req('state.js'),
    tmux: req('tmux.js'),
    agents: req('agents.js'),
    protocol: req('protocol.js'),
    orchestration: req('orchestration.js'),
    runtime: req('runtime.js'),
    viewModel: req('teamPanel/viewModel.js'),
    layout: req('teamPanel/layout.js'),
  }
}

function loadSuites() {
  const suitesDir = path.join(__dirname, 'suites')
  const preferredOrder = [
    'package-install-smoke.cjs',
    'tools-state.cjs',
    'commands.cjs',
    'protocol-decisions-orchestration.cjs',
    'panel-renderer.cjs',
  ]
  const existing = new Set(
    fs.readdirSync(suitesDir).filter(name => name.endsWith('.cjs')),
  )
  const ordered = preferredOrder.filter(name => existing.has(name))
  for (const file of [...existing].sort((a, b) => a.localeCompare(b))) {
    if (!ordered.includes(file)) ordered.push(file)
  }
  return ordered.map(file => require(path.join(suitesDir, file)))
}

async function main() {
  createStubs()
  transpile()

  try {
    const modules = loadModules()
    const pi = createStubPi()
    modules.index.default(pi)

    const notifications = []
    const leaderCtx = createCtx('/tmp/project-under-test', '/tmp/leader-session.jsonl', notifications)

    const patches = setupRuntimePatches(modules)
    try {
      const helpers = {
        createCtx,
        createFakeTheme,
        assertContains,
        requireDist: rel => require(path.join(DIST_ROOT, rel)),
        visibleWidth: require(path.join(STUB_ROOT, 'pi-tui.js')).visibleWidth,
        tuiKeys: require(path.join(STUB_ROOT, 'pi-tui.js')).Key,
      }
      const toolsSuite = require(path.join(__dirname, 'suites', 'tools-state.cjs'))
      const env = { pi, modules, leaderCtx, notifications, sentPrompts: patches.sentPrompts, patches, helpers, toolsSuite }

      for (const suite of loadSuites()) {
        log(`▶ suite: ${suite.name}`)
        await suite.run(env)
        log(`✅ ${suite.name} passed`)
      }
    } finally {
      patches.restore()
    }

    log('✅ ALL agentteam tests passed')
  } finally {
    fs.rmSync(BUILD_ROOT, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error('❌ agentteam tests failed:', error)
  process.exitCode = 1
})
