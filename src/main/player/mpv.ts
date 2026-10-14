import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { UserFacingError } from '../util/errors'

export interface MpvOptions {
  socketPath: string
  pidFile: string
  binary?: string
  /** Extra mpv flags, e.g. ['--ao=null'] in tests. */
  extraArgs?: string[]
}

export interface EndFileEvent {
  reason: string
  entryId: number | null
  error: string | null
}

interface MpvEventMap {
  'time-pos': [number | null]
  duration: [number | null]
  pause: [boolean]
  volume: [number]
  mute: [boolean]
  'file-loaded': []
  'end-file': [EndFileEvent]
  died: []
}

const DEBUG = process.env['MYPLAYER_DEBUG'] === '1'
const OBSERVED = ['time-pos', 'duration', 'pause', 'volume', 'mute'] as const

/**
 * Owns exactly one mpv process and talks to it over its JSON IPC socket. mpv does all decoding,
 * buffering, seeking and audio output; this class only translates commands and events.
 */
export class Mpv extends EventEmitter<MpvEventMap> {
  private child: ChildProcess | null = null
  private socket: net.Socket | null = null
  private starting: Promise<void> | null = null
  private nextRequest = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private buffer = ''

  constructor(private readonly opts: MpvOptions) {
    super()
  }

  get running(): boolean {
    return this.child !== null && this.socket !== null && !this.socket.destroyed
  }

  /** Start mpv if needed. Concurrent callers share one start, so a second instance can never appear. */
  ensureRunning(): Promise<void> {
    if (this.running) return Promise.resolve()
    this.starting ??= this.start().finally(() => (this.starting = null))
    return this.starting
  }

  private async start(): Promise<void> {
    this.killStale()
    try { unlinkSync(this.opts.socketPath) } catch { /* not there */ }

    const child = spawn(
      this.opts.binary ?? 'mpv',
      [
        '--no-config', '--idle=yes', '--no-video', '--no-terminal', '--force-window=no', '--audio-display=no',
        '--keep-open=no', '--ytdl=no', '--load-scripts=no', '--osc=no', '--input-default-bindings=no',
        '--input-vo-keyboard=no', '--pause=no', '--cache=yes', '--demuxer-max-bytes=64MiB',
        '--audio-client-name=MyPlayer', `--input-ipc-server=${this.opts.socketPath}`,
        ...(this.opts.extraArgs ?? [])
      ],
      { stdio: 'ignore' }
    )
    this.child = child
    child.once('exit', () => this.handleExit(child))
    child.once('error', () => this.handleExit(child))
    if (child.pid) writeFileSync(this.opts.pidFile, String(child.pid))

    try {
      this.socket = await this.connect(child)
    } catch (err) {
      child.kill('SIGKILL')
      this.child = null
      throw err
    }
    this.socket.setEncoding('utf8')
    this.socket.on('data', (chunk: string) => this.onData(chunk))
    this.socket.on('close', () => this.socket?.destroy())
    OBSERVED.forEach((name, i) => this.write({ command: ['observe_property', i + 1, name] }))
  }

  private async connect(child: ChildProcess): Promise<net.Socket> {
    const deadline = Date.now() + 6000
    for (;;) {
      if (child.exitCode !== null || child.signalCode !== null || (child.pid === undefined)) throw new UserFacingError('mpv could not start. Is it installed? (sudo dnf install mpv)')
      if (existsSync(this.opts.socketPath)) {
        try {
          return await new Promise<net.Socket>((resolve, reject) => {
            const s = net.connect(this.opts.socketPath)
            s.once('connect', () => resolve(s))
            s.once('error', reject)
          })
        } catch { /* socket file exists but mpv isn't accepting yet */ }
      }
      if (Date.now() > deadline) throw new UserFacingError('mpv did not respond. Try restarting the app.')
      await new Promise((r) => setTimeout(r, 40))
    }
  }

  /** A previous run that crashed may have left its mpv behind. Stop it so only one player ever exists. */
  private killStale(): void {
    try {
      const pid = Number(readFileSync(this.opts.pidFile, 'utf8'))
      if (!Number.isInteger(pid) || pid <= 1) return
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      if (cmdline.includes(this.opts.socketPath)) process.kill(pid, 'SIGKILL')
    } catch { /* no stale process */ }
  }

  private handleExit(child: ChildProcess): void {
    if (this.child !== child) return
    this.child = null
    this.socket?.destroy()
    this.socket = null
    for (const p of this.pending.values()) p.reject(new UserFacingError('The audio player stopped unexpectedly. Press play to restart it.'))
    this.pending.clear()
    try { unlinkSync(this.opts.pidFile) } catch { /* already gone */ }
    this.emit('died')
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let nl: number
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl)
      this.buffer = this.buffer.slice(nl + 1)
      if (!line) continue
      let msg: Record<string, unknown>
      try { msg = JSON.parse(line) } catch { continue }
      if (DEBUG && msg['name'] !== 'time-pos') console.log('[mpv]', line.slice(0, 200))
      if (typeof msg['request_id'] === 'number') {
        const p = this.pending.get(msg['request_id'])
        if (!p) continue
        this.pending.delete(msg['request_id'])
        msg['error'] === 'success' ? p.resolve(msg['data']) : p.reject(new Error(String(msg['error'])))
      } else if (msg['event'] === 'property-change') {
        const name = msg['name'] as (typeof OBSERVED)[number]
        ;(this.emit as (e: string, v: unknown) => boolean)(name, msg['data'] ?? null)
      } else if (msg['event'] === 'file-loaded') {
        this.emit('file-loaded')
      } else if (msg['event'] === 'end-file') {
        this.emit('end-file', {
          reason: String(msg['reason'] ?? 'unknown'),
          entryId: typeof msg['playlist_entry_id'] === 'number' ? msg['playlist_entry_id'] : null,
          error: typeof msg['file_error'] === 'string' ? msg['file_error'] : null
        })
      }
    }
  }

  private write(payload: object): void {
    this.socket?.write(JSON.stringify(payload) + '\n')
  }

  async command(...args: (string | number | boolean | string[])[]): Promise<unknown> {
    await this.ensureRunning()
    const id = this.nextRequest++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.write({ command: args, request_id: id })
    })
  }

  setProperty(name: string, value: string | number | boolean | string[]): Promise<unknown> {
    return this.command('set_property', name, value)
  }

  getProperty(name: string): Promise<unknown> {
    return this.command('get_property', name)
  }

  /** Replace whatever is playing. Resolves with mpv's id for the new playlist entry. */
  async loadFile(target: string, opts: { headers?: Record<string, string>; startSec?: number } = {}): Promise<number> {
    const headers = opts.headers ?? {}
    const ua = Object.entries(headers).find(([k]) => k.toLowerCase() === 'user-agent')?.[1]
    const fields = Object.entries(headers).filter(([k]) => k.toLowerCase() !== 'user-agent').map(([k, v]) => `${k}: ${v}`)
    await this.setProperty('http-header-fields', fields)
    await this.setProperty('user-agent', ua ?? 'mpv')
    const options = opts.startSec && opts.startSec > 0 ? `start=${opts.startSec.toFixed(3)}` : ''
    const res = (await this.command('loadfile', target, 'replace', -1, options)) as { playlist_entry_id?: number } | null
    return res?.playlist_entry_id ?? -1
  }

  /** Stop playback and unload the file; mpv itself stays idle and ready. */
  stop(): Promise<unknown> {
    return this.command('stop')
  }

  /** Shut mpv down. Used on app exit. */
  async quit(): Promise<void> {
    const child = this.child
    if (!child) return
    this.removeAllListeners()
    try { this.write({ command: ['quit'] }) } catch { /* socket already closed */ }
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 1500)
      child.once('exit', () => { clearTimeout(t); resolve() })
    })
    try { unlinkSync(this.opts.pidFile) } catch { /* ignore */ }
  }
}
