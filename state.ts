import * as fsStore from './state/fsStore.js'
import * as paths from './state/paths.js'
import * as merge from './state/merge.js'
import * as taskStore from './state/taskStore.js'
import * as mailboxStore from './state/mailboxStore.js'
import * as sessionBinding from './state/sessionBinding.js'
import * as teamStore from './state/teamStore.js'

// ---------------------------------------------------------------------------
// Backwards-compatible state facade.
//
// Historical callers import from ./state.ts directly. The actual implementation
// is now split into focused submodules:
// - state/paths.ts          on-disk layout helpers
// - state/fsStore.ts        generic file-system + lock primitives
// - state/sessionBinding.ts session <-> team binding cache/repair
// - state/teamStore.ts      persisted team state + member mutations
// - state/mailboxStore.ts   mailbox persistence
// - state/taskStore.ts      task/note/event in-memory mutations
// - state/merge.ts          stale-writer merge policy
//
// Keep this file as a stable façade while the rest of the codebase migrates.
// ---------------------------------------------------------------------------

sessionBinding.configureSessionBindingStore({
  readTeamState: teamStore.readTeamState,
  listTeams: teamStore.listTeams,
})

// fsStore
export const ensureDir = fsStore.ensureDir
export const readJsonFile = fsStore.readJsonFile
export const withFileLock = fsStore.withFileLock
export const writeJsonFile = fsStore.writeJsonFile

// paths
export const getMailboxDir = paths.getMailboxDir
export const getMailboxPath = paths.getMailboxPath
export const getSessionContextPath = paths.getSessionContextPath
export const getSessionsDir = paths.getSessionsDir
export const getTeamDir = paths.getTeamDir
export const getTeamsDir = paths.getTeamsDir
export const getTeamStatePath = paths.getTeamStatePath
export const getWorkerSessionsDir = paths.getWorkerSessionsDir
export const sanitizeName = paths.sanitizeName
export const sanitizeSessionFile = paths.sanitizeSessionFile

// session binding
export const clearSessionContext = sessionBinding.clearSessionContext
export const ensureAttachedSessionContext = sessionBinding.ensureAttachedSessionContext
export const invalidateSessionContextCache = sessionBinding.invalidateSessionContextCache
export const readSessionContext = sessionBinding.readSessionContext
export const writeSessionContext = sessionBinding.writeSessionContext

// merge
export const mergeTaskNotes = merge.mergeTaskNotes
export const mergeTeamEvents = merge.mergeTeamEvents
export const mergeTeamStates = merge.mergeTeamStates
export const normalizeTeamState = merge.normalizeTeamState

// task store
export const appendTaskNote = taskStore.appendTaskNote
export const appendTeamEvent = taskStore.appendTeamEvent
export const createTask = taskStore.createTask

// mailbox store
export const ensureMailbox = mailboxStore.ensureMailbox
export const markMailboxMessagesRead = mailboxStore.markMailboxMessagesRead
export const peekUnreadMailbox = mailboxStore.peekUnreadMailbox
export const pushMailboxMessage = mailboxStore.pushMailboxMessage
export const readMailbox = mailboxStore.readMailbox

// team store
export const createInitialTeamState = teamStore.createInitialTeamState
export const deleteTeamState = teamStore.deleteTeamState
export const listTeams = teamStore.listTeams
export const readTeamState = teamStore.readTeamState
export const removeMember = teamStore.removeMember
export const updateMemberStatus = teamStore.updateMemberStatus
export const updateTeamState = teamStore.updateTeamState
export const upsertMember = teamStore.upsertMember
export const writeTeamState = teamStore.writeTeamState
