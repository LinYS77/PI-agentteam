<div align="center">

# 🤝 pi-agentteam

**Multi-agent team orchestration for [pi](https://github.com/badlogic/pi-mono)**

Coordinate a leader with specialized teammates — researcher, planner, and implementer —
each running in a visible tmux pane, collaborating through shared tasks and typed messages.

[![npm](https://img.shields.io/npm/v/pi-agentteam?style=flat-square&color=blue)](https://www.npmjs.com/package/pi-agentteam)
[![license](https://img.shields.io/npm/l/pi-agentteam?style=flat-square)](https://github.com/LinYS77/PI-agentteam/blob/main/LICENSE)
[![pi](https://img.shields.io/badge/requires-pi%20%3E%3D%200.60-blueviolet?style=flat-square)](https://github.com/badlogic/pi-mono)

</div>

---

## ✨ Highlights

| | Feature | |
|---|---|---|
| 🖥️ | **tmux-native swarm** | Each teammate is a real `pi` session in its own pane — watch them work in real time |
| 📋 | **Shared task board** | Create, claim, update, complete — full lifecycle tracking across the team |
| 💬 | **Typed messaging** | `assignment` · `question` · `blocked` · `completion_report` · `fyi` — each with auto-wake semantics |
| 🎯 | **Role-based access** | Researcher (read-only) → Planner (read-only) → Implementer (full tools) — least privilege by default |
| 📡 | **Event-driven wake** | Teammates auto-wake on actionable messages; no polling, no wasted tokens |
| 📊 | **Interactive `/team` panel** | Browse members, tasks, mailbox — all from a keyboard-driven dashboard |
| 🔗 | **Peer handoff** | Workers coordinate directly (researcher → planner) without going through the leader |
| 🧹 | **Zero footprint** | One folder, file-based state, no database — delete and it's gone |

---

## 📦 Install

```bash
pi install npm:pi-agentteam
```

**Requirements:** [pi](https://github.com/badlogic/pi-mono) ≥ 0.60 · [tmux](https://github.com/tmux/tmux) ≥ 3.3 · Node.js ≥ 22

---

## 🚀 Quick Start

```text
You (leader):
  Create a team and spawn a researcher to analyze the build pipeline.

  > agentteam_create("my-project", { description: "Optimize the build pipeline" })
  > agentteam_spawn({ name: "research", role: "researcher",
                      task: "Analyze the build pipeline and report bottlenecks" })
  > agentteam_spawn({ name: "plan", role: "planner" })

  ... researcher works in its own tmux pane ...

  > agentteam_send({ to: "plan", message: "Research done, draft an optimization plan",
                     type: "fyi" })

  ... planner drafts plan ...

  > agentteam_receive()   ← pick up completion_report from planner
```

Or open the interactive dashboard:

```text
/team          ← browse members · tasks · mailbox
```

---

## 🎮 `/team` Dashboard

```
 ╭─────────────────────────────────────────────────────────╮
 │  👑 leader    🔬 research     📋 plan                    │
 │  ✦ Members                                              │
 │  ├ ⟳ research-one (researcher) · running                │
 │  ┊  Last: direct assignment                             │
 │  ┊                                                      │
 │  ├ ⋯ plan-one (planner) · idle                          │
 │     Last: created waiting for follow-up instruction     │
 │                                                          │
 │  ✦ Tasks                                                │
 │  ├ T001 · ⟳ Inspect project · research-one              │
 │                                                          │
 │  ✦ Mailbox                                   1 unread   │
 │  ┊ From plan-one · completion_report                    │
 │                                                          │
 │  Tab cycle · ↑↓ navigate · Enter focus · s sync · Esc   │
 ╰──────────────────────────────────────────────────────────╯
```

| Key | Action |
|:---:|--------|
| `Tab` | Cycle sections (members → tasks → mailbox) |
| `↑` `↓` | Navigate within section |
| `Enter` | Focus selected teammate pane |
| `l` | Focus leader pane |
| `o` | Toggle detail expansion |
| `s` | Sync leader mailbox |
| `r` | Refresh panel |
| `Esc` | Close panel |

---

## 💬 Messages & Wake Behavior

Messages carry an implicit **wake hint** that controls how the recipient reacts:

| Type | Purpose | Wake | Typical Flow |
|------|---------|:----:|--------------|
| `assignment` | Leader → worker task assignment | 🔴 hard | Leader delegates work |
| `question` | Clarification request | 🟡 soft | Anyone asks a question |
| `blocked` | Escalation needing attention | 🔴 hard | Worker hits a wall |
| `completion_report` | Work finished | 🔴/🟡 | Worker reports back |
| `fyi` | Informational update | ⚪ none* | Context sharing |

> \* *Peer handoff exception:* when a non-leader sends `fyi` to an idle teammate, wake is auto-upgraded to `soft` so the handoff doesn't stall silently.

---

## 👥 Built-in Roles

| Role | Tools | Best For |
|------|-------|----------|
| 🔬 **researcher** | `read` `grep` `find` `ls` + collaboration | Codebase analysis, documentation research |
| 📋 **planner** | `read` `grep` `find` `ls` + collaboration | Task decomposition, acceptance criteria |
| 🛠 **implementer** | `read` `grep` `find` `ls` `bash` `edit` `write` + collaboration | Code changes, file creation, test runs |

**Aliases:** `plan`/`planning` → planner · `research` → researcher · `implement`/`developer` → implementer

Add custom agents in `.pi/agents/` and use those role names when spawning.

---

## ⚙️ Model Configuration

Create `~/.pi/agent/extensions/agentteam/config.json` to assign models per role:

```json
{
  "agentModels": {
    "leader": "glm-5.1",
    "planner": "glm-5.1",
    "researcher": "glm-5.1",
    "implementer": "gpt-5.3-codex"
  }
}
```

Values are model selectors from `~/.pi/agent/models.json`. Empty string = use the default model.

---

## 🛠 Tools & Commands

### Tools

| Tool | Description |
|------|-------------|
| `agentteam_create` | Create a new team |
| `agentteam_spawn` | Spawn a teammate (omit `task` for idle) |
| `agentteam_send` | Send a typed message |
| `agentteam_receive` | Pull unread mailbox messages |
| `agentteam_task` | Manage shared tasks (`create` · `claim` · `update` · `complete` · `list` · `note`) |
| `agentteam_dispatch` | Auto-assign pending tasks to idle teammates |

### Commands

| Command | Description |
|---------|-------------|
| `/team` | Interactive team dashboard |
| `/team-sync` | Sync leader mailbox from disk |
| `/team-remove-member <name>` | Remove a teammate and clean up |
| `/team-delete` | Delete the current team |
| `/team-cleanup` | Delete all teams, kill orphan panes |

---

## 🏗 Architecture

```
index.ts              ← Extension entry point
├── tools/            ← agentteam_create, spawn, send, receive, task
├── commands/         ← /team dashboard, /team-cleanup
├── hooks/            ← Agent lifecycle, session binding, tool guard
├── teamPanel/        ← Interactive dashboard (layout, view model, input)
├── state.ts          ← File-based team state, mailbox, locks
├── runtime.ts        ← Worker wake, pane management
├── runtimeService.ts ← Leader mailbox sync, digest injection
├── protocol.ts       ← Message type defaults & wake hints
├── orchestration.ts  ← Leader digest (coordination counters)
├── policy.ts         ← Leader delegation policy
├── agents.ts         ← Role discovery & agent loading
├── tmux.ts           ← tmux pane/window management
├── types.ts          ← Shared type definitions
└── agents/           ← Bundled role prompts (markdown)
    ├── researcher.md
    ├── planner.md
    └── implementer.md
```

### Design Principles

- **Removable** — delete the folder and reload; no core modifications
- **Observable** — each teammate is a visible tmux pane you can watch
- **Minimal prompt burden** — role behavior in markdown, not inflated system prompts
- **File-based state** — JSON + lock files + atomic writes; no database
- **Event-driven** — teammates wake on actionable messages, not polling

---

## ✅ Tests

```bash
node tests/run.cjs
```

| Suite | Covers |
|-------|--------|
| Tools + state flow | create → spawn → send → receive → task lifecycle |
| Commands | /team, /team-sync, /team-cleanup |
| Protocol + orchestration | Wake defaults, leader digest injection |
| Panel rendering | Visual output across terminal widths |
| Wake + permission guards | Role-based access control |

---

## ⚠️ Limitations

- Workers are separate `pi` sessions in tmux panes, not in-process subagents
- Creating a teammate and starting work are two steps (`spawn` + `send`)
- State is local to one machine (no remote/distributed support)
- Requires tmux; Windows terminals not supported (WSL works)

---

## 📄 License

[MIT](LICENSE) © 2026 linys77
