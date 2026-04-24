import * as core from './tmux/core.js'
import * as labels from './tmux/labels.js'
import * as panes from './tmux/panes.js'
import * as windows from './tmux/windows.js'
import * as wake from './tmux/wake.js'

// Small writable facade so runtime/tests can patch only the business-level tmux helpers.
export const captureCurrentPaneBinding = core.captureCurrentPaneBinding
export const listAgentTeamPanes = core.listAgentTeamPanes
export const paneExists = core.paneExists
export const resolvePaneBinding = core.resolvePaneBinding
export const shellEscapeArg = core.shellEscapeArg

export const clearPaneLabelsForTeam = labels.clearPaneLabelsForTeam
export const syncPaneLabelsForTeam = labels.syncPaneLabelsForTeam

export const createTeammatePane = panes.createTeammatePane
export const focusPane = panes.focusPane
export const killPane = panes.killPane

export const ensureSwarmWindow = windows.ensureSwarmWindow

export const sendEnterToPane = wake.sendEnterToPane
export const sendPromptToPane = wake.sendPromptToPane
export const waitForPaneAppStart = wake.waitForPaneAppStart
