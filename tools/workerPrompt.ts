import type { AgentDefinition } from '../agents.js'
import { shellEscapeArg } from '../tmux.js'

export function buildWorkerSystemPrompt(input: {
  teamName: string
  workerName: string
  role: string
  roleAgent: AgentDefinition
}): string {
  return [
    'You are a worker in an agent team running inside pi.',
    `Team: ${input.teamName}`,
    `Worker name: ${input.workerName}`,
    `Role: ${input.role}`,
    '',
    'Rules:',
    '- Coordinate through agentteam_send and agentteam_task; team-lead is the user-facing coordinator.',
    '- If awakened by an agentteam signal and unread messages may exist, call agentteam_receive before acting so mailbox read state stays clean.',
    '- Keep progress in task notes; keep handoff messages concise and task-id based when possible.',
    '- Be concise, practical, and action-oriented.',
    '- Complete assigned tasks with agentteam_task action=complete so the task board and leader mailbox are updated together.',
    '- Do not also send a separate agentteam_send completion_report for the same task after agentteam_task complete unless team-lead explicitly asks.',
    '- If blocked, update the task as blocked or send a blocked message with the taskId so team-lead can converge the next step.',
    '- If asked to summarize findings without completing a task, send the summary to team-lead using agentteam_send.',
    input.roleAgent.systemPrompt ? `\nRole prompt:\n${input.roleAgent.systemPrompt}` : '',
  ].filter(Boolean).join('\n')
}

export function buildWorkerLaunchCommand(input: {
  sessionFile: string
  basePrompt: string
  roleAgent: AgentDefinition
}): string {
  const envParts: string[] = []
  const agentTeamHome = process.env.PI_AGENTTEAM_HOME?.trim()
  if (agentTeamHome) {
    envParts.push(`PI_AGENTTEAM_HOME=${shellEscapeArg(agentTeamHome)}`)
  }

  const launchCommandParts = ['pi', '--session', input.sessionFile]
  if (input.basePrompt) {
    launchCommandParts.push('--append-system-prompt', input.basePrompt)
  }
  if (input.roleAgent.model) {
    launchCommandParts.push('--model', input.roleAgent.model)
  }
  if (input.roleAgent.tools && input.roleAgent.tools.length > 0) {
    const cliTools = input.roleAgent.tools.map(tool => tool.trim()).filter(Boolean)
    if (cliTools.length > 0) {
      launchCommandParts.push('--tools', cliTools.join(','))
    }
  }
  const command = launchCommandParts.map(part => shellEscapeArg(String(part))).join(' ')
  return [...envParts, command].join(' ')
}
