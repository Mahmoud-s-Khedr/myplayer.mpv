import { statSync } from 'node:fs'
import type { PlaySource, PlayerState, QueueSnapshot, RepeatMode, Toast, Track } from '@shared/types'
import type { CacheManager } from '../cache/cache'
import type { Repo } from '../db/repo'
import type { MediaProvider } from '../providers/types'
import { UserFacingError } from '../util/errors'
import { ExecError } from '../util/exec'
import type { EndFileEvent, Mpv } from './mpv'
import { PlayTracker } from './playTracker'
import * as Q from './queue'

export interface PlaybackEmitter {
  state(s: PlayerState): void
  queue(q: QueueSnapshot): void
  tracksChanged(ids: string[]): void
  toast(t: Toast): void
}

interface Session { playId: number; trackId: string; tracker: PlayTracker; lastFlush: number }
interface Source { target: string; headers?: Record<string, string>; kind: PlaySource }

const MAX_AUTO_SKIPS = 3
const POSITION_EMIT_MS = 250
const SAVE_EVERY_MS = 5000
const FLUSH_EVERY_MS = 10_000

/**
 * The single place that decides what plays. It owns the queue, asks the cache/provider where a track's
 * audio lives, drives mpv, and turns playback progress into listening history and cache requests.
 */
export class PlaybackService {
  private queue: Q.QueueState = Q.emptyQueue()
  private state: PlayerState = { status: 'idle', positionSec: 0, durationSec: 0, volume: 80, muted: false, source: null, error: null }
  private loadToken = 0
  private abort: AbortController | null = null
  private entryId: number | null = null
  private awaiting: { token: number; track: Track; source: PlaySource } | null = null
  private loaded = false
  private session: Session | null = null
  private pendingStartSec = 0
  private failures = 0
  private lastEmit = 0
  private lastSave = 0
  private saveTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly mpv: Mpv,
    private readonly repo: Repo,
    private readonly provider: MediaProvider,
    private readonly cache: CacheManager,
    private readonly out: PlaybackEmitter,
    private readonly now: () => number = Date.now
  ) {}

  /** Restore the saved queue and volume, then start listening to mpv. Nothing plays until the user asks. */
  init(): void {
    const vol = this.repo.getJson<{ volume: number; muted: boolean }>('audio')
    if (vol && vol.volume >= 0 && vol.volume <= 100) this.state = { ...this.state, volume: vol.volume, muted: !!vol.muted }

    const saved = this.repo.getJson<{ entries: Q.QueueEntry[]; index: number; repeat: RepeatMode; positionSec: number }>('queue')
    if (saved && Array.isArray(saved.entries)) {
      const wanted = saved.entries.filter((e) => e && typeof e.uid === 'string' && typeof e.trackId === 'string')
      const known = new Set(this.repo.getTracks(wanted.map((e) => e.trackId)).map((t) => t.id))
      const entries = wanted.filter((e) => known.has(e.trackId))
      const currentUid = wanted[saved.index]?.uid
      let index = entries.findIndex((e) => e.uid === currentUid)
      if (index === -1) index = entries.length ? 0 : -1
      const repeat: RepeatMode = ['off', 'all', 'one'].includes(saved.repeat) ? saved.repeat : 'off'
      this.queue = { entries, index, repeat }
      const track = this.currentTrack()
      if (track) {
        const pos = typeof saved.positionSec === 'number' && saved.positionSec > 2 ? saved.positionSec : 0
        this.pendingStartSec = track.durationSec && pos > track.durationSec - 2 ? 0 : pos
        this.state = { ...this.state, status: 'paused', positionSec: this.pendingStartSec, durationSec: track.durationSec ?? 0 }
      }
    }

    this.mpv.on('time-pos', (p) => this.onTimePos(p))
    this.mpv.on('duration', (d) => this.onDuration(d))
    this.mpv.on('pause', (p) => this.onPause(p))
    this.mpv.on('file-loaded', () => this.onFileLoaded())
    this.mpv.on('end-file', (e) => this.onEndFile(e))
    this.mpv.on('died', () => this.onDied())
  }

  // ---- queries ----

  snapshot(): { player: PlayerState; queue: QueueSnapshot } {
    return { player: { ...this.state }, queue: this.queueSnapshot() }
  }

  private queueSnapshot(): QueueSnapshot {
    const tracks = new Map(this.repo.getTracks([...new Set(this.queue.entries.map((e) => e.trackId))]).map((t) => [t.id, t]))
    return {
      items: this.queue.entries.flatMap((e) => (tracks.has(e.trackId) ? [{ uid: e.uid, track: tracks.get(e.trackId)! }] : [])),
      index: this.queue.index,
      repeat: this.queue.repeat
    }
  }

  private currentTrack(): Track | null {
    const e = Q.currentEntry(this.queue)
    return e ? this.repo.getTrack(e.trackId) : null
  }

  // ---- commands ----

  async playNow(ids: string[], startIndex: number): Promise<void> {
    const known = new Set(this.repo.getTracks(ids).map((t) => t.id))
    const valid = ids.filter((id) => known.has(id))
    const start = ids[startIndex] ? valid.indexOf(ids[startIndex]) : 0
    this.queue = Q.replaceQueue(this.queue, valid, Math.max(start, 0))
    this.failures = 0
    this.queueChanged()
    await this.playCurrent(0)
  }

  enqueue(ids: string[], where: 'next' | 'end'): void {
    const known = new Set(this.repo.getTracks(ids).map((t) => t.id))
    const wasEmpty = this.queue.entries.length === 0
    this.queue = Q.enqueue(this.queue, ids.filter((id) => known.has(id)), where)
    if (wasEmpty && this.queue.index >= 0) {
      const t = this.currentTrack()
      this.pendingStartSec = 0
      this.setState({ status: 'paused', positionSec: 0, durationSec: t?.durationSec ?? 0, error: null })
    }
    this.queueChanged()
  }

  async playQueueItem(uid: string): Promise<void> {
    this.queue = Q.jumpTo(this.queue, uid)
    this.failures = 0
    this.queueChanged()
    await this.playCurrent(0)
  }

  async togglePause(): Promise<void> {
    if (this.state.status === 'loading') return
    if (!this.loaded || this.state.status === 'error' || this.state.status === 'idle') {
      if (Q.currentEntry(this.queue)) {
        this.failures = 0
        await this.playCurrent(this.state.status === 'error' ? this.state.positionSec : this.pendingStartSec)
      }
      return
    }
    await this.mpv.setProperty('pause', this.state.status === 'playing')
  }

  async next(): Promise<void> {
    const r = Q.advance(this.queue, false)
    if (r.action === 'stop') return
    this.queue = r.state
    this.failures = 0
    this.queueChanged()
    await this.playCurrent(0)
  }

  async previous(): Promise<void> {
    const r = Q.retreat(this.queue, this.state.positionSec)
    if (r.action === 'restart') return this.seek(0)
    this.queue = r.state
    this.failures = 0
    this.queueChanged()
    await this.playCurrent(0)
  }

  async seek(sec: number): Promise<void> {
    const max = this.state.durationSec > 0 ? this.state.durationSec : Infinity
    const target = Math.min(Math.max(sec, 0), max)
    if (!this.loaded) {
      if (Q.currentEntry(this.queue)) {
        this.pendingStartSec = target
        this.setState({ positionSec: target })
      }
      return
    }
    this.state.positionSec = target // feel instant; mpv's next report confirms it
    await this.mpv.command('seek', target, 'absolute+exact')
    this.emitState(true)
  }

  async seekBy(delta: number): Promise<void> {
    await this.seek((this.loaded ? this.state.positionSec : this.pendingStartSec) + delta)
  }

  async setVolume(volume: number): Promise<void> {
    this.state.volume = Math.min(Math.max(Math.round(volume), 0), 100)
    if (this.state.volume > 0) this.state.muted = false
    this.persistAudio()
    this.emitState(true)
    if (this.mpv.running) await this.applyAudio()
  }

  async toggleMute(): Promise<void> {
    this.state.muted = !this.state.muted
    this.persistAudio()
    this.emitState(true)
    if (this.mpv.running) await this.applyAudio()
  }

  setRepeat(mode: RepeatMode): void {
    this.queue = { ...this.queue, repeat: mode }
    this.queueChanged()
  }

  async removeFromQueue(uid: string): Promise<void> {
    const wasPlaying = this.state.status === 'playing' || this.state.status === 'loading'
    const r = Q.removeEntry(this.queue, uid)
    this.queue = r.state
    this.queueChanged()
    if (!r.wasCurrent) return
    if (this.queue.index === -1) return this.stopPlayback()
    if (wasPlaying) await this.playCurrent(0)
    else {
      await this.unload()
      const t = this.currentTrack()
      this.setState({ status: 'paused', positionSec: 0, durationSec: t?.durationSec ?? 0, error: null })
    }
  }

  moveInQueue(uid: string, toIndex: number): void {
    this.queue = Q.moveEntry(this.queue, uid, toIndex)
    this.queueChanged()
  }

  async clearQueue(): Promise<void> {
    this.queue = Q.clearQueue(this.queue)
    this.queueChanged()
    await this.stopPlayback()
  }

  /** Flush listening time and the queue, then stop mpv. Called once on app exit. */
  async shutdown(): Promise<void> {
    this.loadToken++
    this.abort?.abort()
    this.endSession()
    this.saveQueue()
    await this.mpv.quit()
  }

  // ---- loading ----

  private async playCurrent(startSec: number, opts: { skipCache?: boolean } = {}): Promise<void> {
    const entry = Q.currentEntry(this.queue)
    const track = entry ? this.repo.getTrack(entry.trackId) : null
    if (!entry || !track) return this.stopPlayback()

    const token = ++this.loadToken
    this.abort?.abort()
    const abort = (this.abort = new AbortController())
    this.endSession()
    this.loaded = false
    this.entryId = null
    this.awaiting = null
    this.pendingStartSec = 0
    this.setState({ status: 'loading', positionSec: startSec, durationSec: track.durationSec ?? 0, error: null, source: null })

    try {
      const source = await this.resolveSource(track, abort.signal, opts.skipCache === true)
      if (token !== this.loadToken) return
      await this.applyAudio()
      this.awaiting = { token, track, source: source.kind }
      this.entryId = await this.mpv.loadFile(source.target, { headers: source.headers, startSec })
      if (token !== this.loadToken) return
      this.loaded = true
    } catch (err) {
      if (token !== this.loadToken) return
      this.fail(token, err)
    }
  }

  private async resolveSource(track: Track, signal: AbortSignal, skipCache: boolean): Promise<Source> {
    if (track.source === 'local') {
      try {
        if (!track.localPath || !statSync(track.localPath).isFile()) throw new Error('missing')
      } catch {
        throw new UserFacingError(`“${track.title}” can’t be found. The file may have been moved or deleted.`)
      }
      return { target: track.localPath, kind: 'local' }
    }
    // A verified offline copy always wins over the network.
    if (!skipCache) {
      const file = this.cache.validFile(track.id)
      if (file) return { target: file, kind: 'cache' }
    }
    const resolved = await this.provider.resolve(track.sourceId, signal)
    this.repo.upsertTrack(resolved.info)
    this.out.tracksChanged([track.id])
    return { target: resolved.streamUrl, headers: resolved.headers, kind: 'network' }
  }

  private async applyAudio(): Promise<void> {
    await this.mpv.setProperty('volume', this.state.volume)
    await this.mpv.setProperty('mute', this.state.muted)
  }

  private async unload(): Promise<void> {
    this.loadToken++
    this.abort?.abort()
    this.endSession()
    this.loaded = false
    this.awaiting = null
    this.entryId = null
    if (this.mpv.running) await this.mpv.stop().catch(() => undefined)
  }

  private async stopPlayback(): Promise<void> {
    await this.unload()
    this.pendingStartSec = 0
    this.setState({ status: 'idle', positionSec: 0, durationSec: 0, source: null, error: null })
    this.saveQueue()
  }

  private fail(token: number, err: unknown): void {
    if (err instanceof ExecError && err.aborted) return
    const message = err instanceof UserFacingError ? err.message : 'Couldn’t play this track.'
    this.loaded = false
    this.awaiting = null
    this.setState({ status: 'error', error: message, source: null })
    this.out.toast({ kind: 'error', message })
    this.failures++
    // Keep a queue moving past an unplayable track, but give up after a few in a row (e.g. when offline).
    const hasNext = Q.advance(this.queue, false).action === 'play' && this.queue.repeat !== 'one'
    if (hasNext && this.failures < MAX_AUTO_SKIPS) {
      setTimeout(() => {
        if (token === this.loadToken && this.state.status === 'error') void this.next()
      }, 1500)
    }
  }

  // ---- mpv events ----

  private onFileLoaded(): void {
    const a = this.awaiting
    if (!a || a.token !== this.loadToken) return
    this.awaiting = null
    this.loaded = true
    this.failures = 0
    const playId = this.repo.startSession(a.track.id)
    this.session = { playId, trackId: a.track.id, tracker: new PlayTracker(a.track.durationSec), lastFlush: this.now() }
    this.setState({ status: 'playing', source: a.source, error: null })
    this.out.tracksChanged([a.track.id])
    void this.mpv.getProperty('pause').then((p) => this.onPause(p === true)).catch(() => undefined)
  }

  private onTimePos(pos: number | null): void {
    if (pos === null || !this.loaded) return
    this.state.positionSec = pos
    const s = this.session
    if (s) {
      const t = this.now()
      if (s.tracker.tick(pos, t, this.state.status === 'playing')) this.onQualified(s)
      if (t - s.lastFlush > FLUSH_EVERY_MS) {
        s.lastFlush = t
        this.repo.updateSession(s.playId, s.tracker.listenedMs)
      }
    }
    if (this.now() - this.lastSave > SAVE_EVERY_MS) this.saveQueue()
    this.emitState(false)
  }

  private onQualified(s: Session): void {
    this.repo.qualifySession(s.playId, s.trackId, s.tracker.listenedMs)
    this.out.tracksChanged([s.trackId])
    this.cache.consider(s.trackId)
  }

  private onDuration(d: number | null): void {
    if (!this.loaded || !d || d <= 0) return
    this.session?.tracker.setDuration(d)
    this.setState({ durationSec: d })
  }

  private onPause(paused: boolean): void {
    if (!this.loaded || this.state.status === 'loading' || this.state.status === 'error') return
    this.setState({ status: paused ? 'paused' : 'playing' })
    if (paused) this.saveQueue()
  }

  private onEndFile(e: EndFileEvent): void {
    if (e.reason !== 'eof' && e.reason !== 'error') return
    const mine = this.awaiting ? this.entryId === null || e.entryId === this.entryId : e.entryId === this.entryId
    if (!mine) return
    const wasSource = this.awaiting?.source ?? this.state.source
    const track = this.currentTrack()
    const resumeAt = this.state.positionSec

    if (e.reason === 'eof') {
      this.endSession()
      this.loaded = false
      const r = Q.advance(this.queue, true)
      if (r.action === 'play') {
        this.queue = r.state
        this.queueChanged()
        void this.playCurrent(0)
      } else {
        this.pendingStartSec = 0
        this.setState({ status: 'paused', positionSec: 0, source: null })
        this.saveQueue()
      }
      return
    }

    this.endSession()
    this.loaded = false
    const token = this.loadToken
    if (wasSource === 'cache' && track) {
      // The saved copy is damaged. Remove it and stream instead of failing.
      this.cache.discard(track.id)
      this.out.toast({ kind: 'info', message: `The saved copy of “${track.title}” was damaged. Streaming it instead.` })
      void this.playCurrent(resumeAt, { skipCache: true })
      return
    }
    this.fail(token, new UserFacingError(wasSource === 'local' ? `“${track?.title ?? 'This file'}” couldn’t be played. It may be damaged or in an unsupported format.` : 'This track stopped loading. Check your connection and try again.'))
  }

  private onDied(): void {
    this.loaded = false
    this.awaiting = null
    this.endSession()
    if (this.state.status === 'playing' || this.state.status === 'loading' || this.state.status === 'paused') {
      this.pendingStartSec = this.state.positionSec
      this.setState({ status: 'error', error: 'The audio player stopped unexpectedly. Press play to restart it.', source: null })
    }
  }

  // ---- sessions, state and persistence ----

  private endSession(): void {
    const s = this.session
    if (!s) return
    this.session = null
    this.repo.updateSession(s.playId, s.tracker.listenedMs)
  }

  private setState(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch }
    this.emitState(true)
  }

  private emitState(force: boolean): void {
    const t = this.now()
    if (!force && t - this.lastEmit < POSITION_EMIT_MS) return
    this.lastEmit = t
    this.out.state({ ...this.state })
  }

  private queueChanged(): void {
    this.out.queue(this.queueSnapshot())
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.saveQueue(), 300)
  }

  private persistAudio(): void {
    this.repo.setJson('audio', { volume: this.state.volume, muted: this.state.muted })
  }

  saveQueue(): void {
    this.lastSave = this.now()
    this.repo.setJson('queue', {
      entries: this.queue.entries, index: this.queue.index, repeat: this.queue.repeat,
      positionSec: this.loaded ? this.state.positionSec : this.pendingStartSec
    })
  }
}
