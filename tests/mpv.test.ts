import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Mpv, type EndFileEvent } from '../src/main/player/mpv'

const hasMpv = (() => { try { execFileSync('mpv', ['--version'], { stdio: 'ignore' }); return true } catch { return false } })()
const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true } catch { return false } })()

const waitFor = async <T>(fn: () => T | undefined | false | null, ms = 8000): Promise<T> => {
  const end = Date.now() + ms
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 25))
  }
}

describe.skipIf(!hasMpv || !hasFfmpeg)('mpv controller (real mpv, silent output)', () => {
  let dir: string
  let tone: string
  let mpv: Mpv
  const positions: number[] = []
  const ends: EndFileEvent[] = []

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'myplayer-mpv-'))
    tone = join(dir, 'tone.wav')
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', tone])
    mpv = new Mpv({ socketPath: join(dir, 'mpv.sock'), pidFile: join(dir, 'mpv.pid'), extraArgs: ['--ao=null'] })
    mpv.on('time-pos', (p) => p !== null && positions.push(p))
    mpv.on('end-file', (e) => ends.push(e))
  })
  afterAll(async () => {
    await mpv.quit()
    rmSync(dir, { recursive: true, force: true })
  })

  it('starts a single mpv and plays a local file', async () => {
    const id = await mpv.loadFile(tone)
    expect(id).toBeGreaterThan(0)
    await waitFor(() => positions.some((p) => p > 0.5))
    expect(await mpv.getProperty('duration')).toBeCloseTo(20, 0)
    expect(await mpv.getProperty('pause')).toBe(false)
  })

  it('reuses the same process for every command and writes one pid', async () => {
    const pid1 = readFileSync(join(dir, 'mpv.pid'), 'utf8')
    await Promise.all([mpv.ensureRunning(), mpv.ensureRunning(), mpv.command('get_property', 'volume')])
    expect(readFileSync(join(dir, 'mpv.pid'), 'utf8')).toBe(pid1)
    const pids = execFileSync('pgrep', ['-f', `input-ipc-server=${join(dir, 'mpv.sock')}`]).toString().trim().split('\n')
    expect(pids).toHaveLength(1)
  })

  it('pauses and resumes', async () => {
    await mpv.setProperty('pause', true)
    const frozen = await mpv.getProperty('time-pos') as number
    await new Promise((r) => setTimeout(r, 600))
    expect(await mpv.getProperty('time-pos')).toBe(frozen)
    await mpv.setProperty('pause', false)
    await waitFor(async () => true)
    await waitFor(() => positions.at(-1)! > frozen + 0.3)
  })

  it('seeks accurately, forward and backward', async () => {
    await mpv.command('seek', 12, 'absolute+exact')
    await waitFor(() => positions.at(-1)! >= 12 && positions.at(-1)! < 14)
    await mpv.command('seek', 3, 'absolute+exact')
    await waitFor(() => positions.at(-1)! >= 3 && positions.at(-1)! < 5)
  })

  it('sets volume', async () => {
    await mpv.setProperty('volume', 35)
    expect(await mpv.getProperty('volume')).toBe(35)
  })

  it('starts a track at a given offset (queue restore)', async () => {
    await mpv.loadFile(tone, { startSec: 15 })
    await waitFor(() => positions.at(-1)! >= 15)
  })

  it('reports natural end of file with reason eof, and replacing a file reports stop', async () => {
    ends.length = 0
    await mpv.loadFile(tone)
    await mpv.loadFile(tone, { startSec: 18.5 })
    const eof = await waitFor(() => ends.find((e) => e.reason === 'eof'), 6000)
    expect(eof.entryId).toBeGreaterThan(0)
    expect(ends.some((e) => e.reason === 'stop')).toBe(true)
  })

  it('reports an error for a corrupt or missing file', async () => {
    ends.length = 0
    const bad = join(dir, 'bad.mp3')
    execFileSync('sh', ['-c', 'head -c 4000 /dev/urandom > "$1"', 'sh', bad])
    await mpv.loadFile(bad)
    const err = await waitFor(() => ends.find((e) => e.reason === 'error'))
    expect(err.error).toBeTruthy()
    ends.length = 0
    await mpv.loadFile(join(dir, 'missing.mp3'))
    await waitFor(() => ends.find((e) => e.reason === 'error'))
  })

  it('cancels playback with stop and stays alive', async () => {
    await mpv.loadFile(tone)
    await mpv.stop()
    expect(mpv.running).toBe(true)
  })

  it('removes its pid file and process on quit', async () => {
    await mpv.quit()
    expect(existsSync(join(dir, 'mpv.pid'))).toBe(false)
    expect(() => execFileSync('pgrep', ['-f', `input-ipc-server=${join(dir, 'mpv.sock')}`])).toThrow()
  })
})
