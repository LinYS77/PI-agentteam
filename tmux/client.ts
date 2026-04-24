import { execFile, execFileSync } from 'node:child_process'

type TmuxResult = {
  ok: boolean
  stdout: string
  stderr?: string
}

interface TmuxClient {
  exec(args: string[], input?: string): string
  execNoThrow(args: string[], input?: string): TmuxResult
  execAsync(args: string[], input?: string, signal?: AbortSignal): Promise<string>
  execNoThrowAsync(args: string[], input?: string, signal?: AbortSignal): Promise<TmuxResult>
}

const TMUX = 'tmux'

class DefaultTmuxClient implements TmuxClient {
  exec(args: string[], input?: string): string {
    return execFileSync(TMUX, args, {
      encoding: 'utf8',
      input,
    }).trim()
  }

  execNoThrow(args: string[], input?: string): TmuxResult {
    try {
      return { ok: true, stdout: this.exec(args, input) }
    } catch (error) {
      return {
        ok: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
      }
    }
  }

  execAsync(args: string[], input?: string, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(TMUX, args, {
        encoding: 'utf8',
        signal,
      }, (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        resolve(String(stdout).trim())
      })

      if (input !== undefined) {
        child.stdin?.end(input)
      }
    })
  }

  async execNoThrowAsync(args: string[], input?: string, signal?: AbortSignal): Promise<TmuxResult> {
    try {
      return { ok: true, stdout: await this.execAsync(args, input, signal) }
    } catch (error) {
      return {
        ok: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

let client: TmuxClient = new DefaultTmuxClient()

export function runTmux(args: string[], input?: string): string {
  return client.exec(args, input)
}

export function runTmuxNoThrow(args: string[], input?: string): TmuxResult {
  return client.execNoThrow(args, input)
}

export function runTmuxAsync(args: string[], input?: string, signal?: AbortSignal): Promise<string> {
  return client.execAsync(args, input, signal)
}

export function runTmuxNoThrowAsync(args: string[], input?: string, signal?: AbortSignal): Promise<TmuxResult> {
  return client.execNoThrowAsync(args, input, signal)
}
