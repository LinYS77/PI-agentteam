import * as fs from 'node:fs'
import * as path from 'node:path'

// ---------------------------------------------------------------------------
// Generic file-system primitives shared by the state submodules.
// ---------------------------------------------------------------------------

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

const LOCK_TIMEOUT_MS = 8000
const LOCK_RETRY_MS = 25
const STALE_LOCK_MS = 5 * 60_000

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function getLockPath(filePath: string): string {
  return `${filePath}.lock`
}

function clearStaleLock(lockPath: string): void {
  try {
    const stat = fs.statSync(lockPath)
    if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
      fs.rmSync(lockPath, { force: true })
    }
  } catch {
    // ignore
  }
}

function acquireFileLock(filePath: string, timeoutMs = LOCK_TIMEOUT_MS): () => void {
  ensureDir(path.dirname(filePath))
  const lockPath = getLockPath(filePath)
  const startedAt = Date.now()

  while (true) {
    try {
      const fd = fs.openSync(lockPath, 'wx')
      try {
        fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, 'utf8')
      } catch {
        // ignore metadata write errors
      }
      return () => {
        try {
          fs.closeSync(fd)
        } catch {
          // ignore
        }
        try {
          fs.rmSync(lockPath, { force: true })
        } catch {
          // ignore
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code !== 'EEXIST') {
        throw error
      }
      clearStaleLock(lockPath)
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out acquiring file lock: ${lockPath}`)
      }
      sleep(LOCK_RETRY_MS)
    }
  }
}

export function withFileLock<T>(filePath: string, fn: () => T, timeoutMs = LOCK_TIMEOUT_MS): T {
  const release = acquireFileLock(filePath, timeoutMs)
  try {
    return fn()
  } finally {
    release()
  }
}

export function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

export function writeJsonFile(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath))
  const payload = `${JSON.stringify(value, null, 2)}\n`
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  try {
    fs.writeFileSync(tempPath, payload, 'utf8')
    fs.renameSync(tempPath, filePath)
  } finally {
    try {
      if (fs.existsSync(tempPath)) {
        fs.rmSync(tempPath, { force: true })
      }
    } catch {
      // ignore
    }
  }
}
