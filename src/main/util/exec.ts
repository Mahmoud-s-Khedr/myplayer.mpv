import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { setPriority } from 'node:os'

export class ExecError extends Error {
  constructor(message: string, readonly stderr: string, readonly aborted = false) {
    super(message)
  }
}

/** Run a program with an argument array (never through a shell) and collect its output. */
export function run(
  command: string,
  args: string[],
  opts: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      { maxBuffer: 64 * 1024 * 1024, signal: opts.signal, timeout: opts.timeoutMs, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (!error) return resolve({ stdout, stderr })
        const aborted = opts.signal?.aborted === true
        const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
        reject(new ExecError(missing ? `${command} is not installed` : `${command} failed`, stderr ?? '', aborted))
      }
    )
    child.stdin?.end()
  })
}

/** Spawn a long-running child, lowering its priority so background work never competes with playback. */
export function spawnBackground(command: string, args: string[]): ChildProcess {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    if (child.pid) setPriority(child.pid, 10)
  } catch {
    /* priority is best effort */
  }
  return child
}
