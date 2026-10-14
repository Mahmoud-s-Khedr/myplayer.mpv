import { execFileSync } from 'node:child_process'
import { rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CacheManager } from '../src/main/cache/cache'
import { openDatabase } from '../src/main/db/database'
import { Repo } from '../src/main/db/repo'
import { Mpv } from '../src/main/player/mpv'
import { PlaybackService } from '../src/main/player/playback'
import type { PlayerState, QueueSnapshot, Toast } from '../src/shared/types'
import { FakeProvider, makeTempDir, makeTone, trackInfo, waitFor } from './helpers/fixtures'

const A = 'yt:aaaaaaaaaaa' // 3s clip: qualifies after 1.5s
const B = 'yt:bbbbbbbbbbb' // 20s clip: qualifies after 10s
const C = 'yt:ccccccccccc' // unplayable

const hasMpv = (() => { try { execFileSync('mpv', ['--version'], { stdio: 'ignore' }); return true } catch { return false } })()

describe.skipIf(!hasMpv)('PlaybackService (real mpv, silent output)', () => {
  let root: string
  let repo: Repo
  let provider: FakeProvider
  let cache: CacheManager
  let mpv: Mpv
  let svc: PlaybackService
  let player: PlayerState
  let queue: QueueSnapshot
  let toasts: Toast[]
  let n = 0

  const build = () => {
    mpv = new Mpv({ socketPath: join(root, `mpv${n}.sock`), pidFile: join(root, `mpv${n}.pid`), extraArgs: ['--ao=null'] })
    svc = new PlaybackService(mpv, repo, provider, cache, {
      state: (s) => (player = s), queue: (q) => (queue = q), tracksChanged: () => undefined, toast: (t) => toasts.push(t)
    })
    svc.init()
  }

  beforeAll(() => {
    root = makeTempDir()
    makeTone(join(root, 'a.wav'), 3)
    makeTone(join(root, 'b.wav'), 20)
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  beforeEach(() => {
    n++
    repo = new Repo(openDatabase(':memory:'))
    provider = new FakeProvider()
    provider.files.set('aaaaaaaaaaa', join(root, 'a.wav'))
    provider.files.set('bbbbbbbbbbb', join(root, 'b.wav'))
    provider.infos.set('aaaaaaaaaaa', trackInfo('aaaaaaaaaaa', { durationSec: 3 }))
    provider.infos.set('bbbbbbbbbbb', trackInfo('bbbbbbbbbbb', { durationSec: 20 }))
    provider.infos.forEach((i) => repo.upsertTrack(i))
    repo.upsertTrack(trackInfo('ccccccccccc', { durationSec: 5 }))
    toasts = []
    cache = new CacheManager({ dir: join(root, `cache${n}`), repo, provider, onChange: () => undefined, onMessage: () => undefined, fetchThumb: async () => null })
    cache.init()
    build()
  })
  afterEach(async () => { await mpv.quit() })

  it('plays a track, counts one qualified play, and records history', async () => {
    await svc.playNow([A], 0)
    await waitFor(() => player.status === 'playing')
    expect(player.source).toBe('network')
    await waitFor(() => repo.getTrack(A)!.qualifiedPlays === 1)
    await waitFor(() => player.status === 'paused' && player.positionSec === 0) // reached the end of the queue
    expect(repo.getTrack(A)!.qualifiedPlays).toBe(1) // not counted again at the end
    const h = repo.history(10)
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ qualified: true })
    expect(h[0].listenedMs).toBeGreaterThan(2000)
  })

  it('does not count a play for skipping around or scrubbing to the end', async () => {
    await svc.playNow([B], 0)
    await waitFor(() => player.status === 'playing')
    await svc.seek(17)
    await waitFor(() => player.positionSec >= 17)
    await new Promise((r) => setTimeout(r, 1200))
    expect(repo.getTrack(B)!.qualifiedPlays).toBe(0)
    await svc.next() // single-item queue: nothing to skip to
    expect(player.status).toBe('playing')
  })

  it('pauses, resumes and seeks', async () => {
    await svc.playNow([B], 0)
    await waitFor(() => player.status === 'playing' && player.positionSec > 0.3)
    await svc.togglePause()
    await waitFor(() => player.status === 'paused')
    const frozen = player.positionSec
    await new Promise((r) => setTimeout(r, 500))
    expect(player.positionSec).toBe(frozen)
    await svc.seekBy(5)
    await waitFor(() => player.positionSec >= frozen + 4.5)
    await svc.togglePause()
    await waitFor(() => player.status === 'playing')
  })

  it('caches on the second qualified play, then plays from the offline copy without touching the network', async () => {
    await svc.playNow([A], 0)
    await waitFor(() => repo.getTrack(A)!.qualifiedPlays === 1)
    expect(cache.validFile(A)).toBeNull()
    await waitFor(() => player.status === 'paused' && !player.source)
    await svc.togglePause() // replays the track: a new listening session
    await waitFor(() => repo.getTrack(A)!.qualifiedPlays === 2)
    await waitFor(() => repo.getTrack(A)!.cache === 'ready', 10000)

    provider.offline = true
    provider.resolveCalls = []
    await waitFor(() => player.status === 'paused' && !player.source)
    await svc.togglePause()
    await waitFor(() => player.source === 'cache')
    expect(provider.resolveCalls).toEqual([])
    expect(player.status === 'playing' || player.status === 'loading').toBe(true)
  })

  it('falls back to streaming when the cached copy is damaged', async () => {
    await svc.playNow([A], 0)
    await waitFor(() => repo.getTrack(A)!.qualifiedPlays === 1)
    await waitFor(() => player.status === 'paused' && !player.source)
    await svc.togglePause()
    await waitFor(() => repo.getTrack(A)!.cache === 'ready', 10000)
    await waitFor(() => player.status === 'paused' && !player.source)

    // Same size, wrong content: passes the cheap size check, fails in the decoder.
    const entry = repo.getCacheEntry(A)!
    writeFileSync(entry.file, Buffer.alloc(statSync(entry.file).size, 1))
    await svc.togglePause()
    await waitFor(() => toasts.some((t) => /damaged/.test(t.message)))
    await waitFor(() => player.source === 'network' && player.status === 'playing')
    expect(repo.getCacheEntry(A)).toBeNull()
  })

  it('reports a missing local file clearly', async () => {
    repo.upsertTrack({ ...trackInfo('x'), id: 'file:0123456789abcdef', source: 'local', sourceId: '0123456789abcdef', localPath: join(root, 'gone.mp3'), downloadPolicy: 'denied' })
    await svc.playNow(['file:0123456789abcdef'], 0)
    await waitFor(() => player.status === 'error')
    expect(player.error).toMatch(/can’t be found/)
  })

  it('plays a local file', async () => {
    repo.upsertTrack({ ...trackInfo('x'), id: 'file:0123456789abcdef', source: 'local', sourceId: '0123456789abcdef', localPath: join(root, 'b.wav'), downloadPolicy: 'denied' })
    await svc.playNow(['file:0123456789abcdef'], 0)
    await waitFor(() => player.status === 'playing' && player.source === 'local')
  })

  it('skips an unplayable track and continues the queue', async () => {
    await svc.playNow([C, A], 0)
    await waitFor(() => player.status === 'error')
    await waitFor(() => player.status === 'playing' && queue.index === 1, 6000)
    expect(toasts.some((t) => t.kind === 'error')).toBe(true)
  })

  it('cancels a slow load when another track is chosen', async () => {
    let release!: () => void
    provider.resolveGate = new Promise<void>((r) => (release = r))
    const first = svc.playNow([B], 0)
    await waitFor(() => provider.resolveCalls.length === 1)
    provider.resolveGate = null
    await svc.playNow([A], 0)
    await waitFor(() => player.status === 'playing')
    release()
    await first
    await new Promise((r) => setTimeout(r, 300))
    expect(queue.items[queue.index].track.id).toBe(A)
    expect(player.durationSec).toBeLessThan(5) // still the 3s clip, never switched to the 20s one
    expect(toasts).toEqual([])
  })

  it('restores the queue, position and volume after a restart without autoplaying', async () => {
    await svc.playNow([A, B], 1)
    await waitFor(() => player.status === 'playing' && player.positionSec > 2)
    await svc.setVolume(42)
    await svc.moveInQueue(queue.items[0].uid, 1)
    const order = queue.items.map((i) => i.track.id)
    await svc.shutdown()

    build()
    const snap = svc.snapshot()
    expect(snap.queue.items.map((i) => i.track.id)).toEqual(order)
    expect(snap.queue.items[snap.queue.index].track.id).toBe(B)
    expect(snap.player).toMatchObject({ status: 'paused', volume: 42 })
    expect(snap.player.positionSec).toBeGreaterThan(1.5)
    expect(mpv.running).toBe(false)

    await svc.togglePause()
    await waitFor(() => player.status === 'playing' && player.positionSec >= snap.player.positionSec)
  })

  it('manages the queue: next, previous, remove current, clear', async () => {
    await svc.playNow([B, A], 0)
    await waitFor(() => player.status === 'playing')
    await svc.next()
    await waitFor(() => queue.index === 1 && player.status === 'playing')
    await svc.previous() // within the first 3s of A: goes back
    await waitFor(() => queue.index === 0 && player.status === 'playing')
    await svc.removeFromQueue(queue.items[0].uid)
    await waitFor(() => queue.items.length === 1 && queue.items[0].track.id === A && player.status === 'playing')
    await svc.clearQueue()
    expect(queue.items).toEqual([])
    expect(player.status).toBe('idle')
    expect(mpv.running).toBe(true) // the same single mpv, idle
  })
})
