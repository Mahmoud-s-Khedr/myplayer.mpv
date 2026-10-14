import { mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Repo } from '../db/repo'
import type { MediaProvider } from '../providers/types'
import { ExecError } from '../util/exec'
import { probeAudio } from '../util/ffprobe'
import { sanitizeThumbnailUrl } from '../util/sanitize'
import { evaluateCaching } from './eligibility'

export interface CacheOptions {
  dir: string
  repo: Repo
  provider: MediaProvider
  /** Called whenever tracks' cache state changed. */
  onChange: (ids: string[]) => void
  onMessage?: (kind: 'info' | 'error', message: string) => void
  /** Overridable in tests. */
  verify?: (file: string, expectedSec: number | null) => Promise<void>
  fetchThumb?: (url: string) => Promise<Buffer | null>
}

interface Job { cancel: () => void; cancelled: boolean }

/** Verify a finished download is real, playable audio of about the length we expect. */
export async function verifyDownloadedAudio(file: string, expectedSec: number | null): Promise<void> {
  const size = statSync(file).size
  if (size < 16 * 1024) throw new Error('The download was incomplete.')
  const probe = await probeAudio(file) // throws if unreadable; null (no ffprobe) falls back to the size check
  if (!probe) return
  if (!probe.hasAudio || !probe.durationSec) throw new Error('The download contained no audio.')
  if (expectedSec && Math.abs(probe.durationSec - expectedSec) > Math.max(3, expectedSec * 0.05)) {
    throw new Error('The download was cut short.')
  }
}

async function fetchThumbnail(url: string): Promise<Buffer | null> {
  const safe = sanitizeThumbnailUrl(url)
  if (!safe) return null
  try {
    const res = await fetch(safe, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > 0 && buf.length <= 2 * 1024 * 1024 ? buf : null
  } catch {
    return null
  }
}

/**
 * Saves audio for offline use. Downloads run one at a time in a low-priority child process into a temp
 * folder; a file only reaches the cache folder (by atomic rename) after it has been verified.
 */
export class CacheManager {
  private readonly audioDir: string
  private readonly thumbDir: string
  private readonly tmpDir: string
  private readonly jobs = new Map<string, Job>()
  private chain: Promise<void> = Promise.resolve()

  constructor(private readonly o: CacheOptions) {
    this.audioDir = join(o.dir, 'audio')
    this.thumbDir = join(o.dir, 'thumbs')
    this.tmpDir = join(o.dir, 'tmp')
  }

  get thumbsDir(): string {
    return this.thumbDir
  }

  /** Create folders, discard leftovers of interrupted downloads and drop entries whose file is gone. */
  init(): void {
    for (const d of [this.audioDir, this.thumbDir]) mkdirSync(d, { recursive: true })
    rmSync(this.tmpDir, { recursive: true, force: true })
    mkdirSync(this.tmpDir, { recursive: true })
    const known = new Set<string>()
    const changed: string[] = []
    for (const e of this.o.repo.listCacheEntries()) {
      if (this.validFile(e.trackId, false)) known.add(e.file)
      else changed.push(e.trackId)
    }
    for (const f of readdirSync(this.audioDir)) {
      const full = join(this.audioDir, f)
      if (!known.has(full)) rmSync(full, { force: true }) // orphan: not in the database
    }
    if (changed.length) this.o.onChange(changed)
  }

  /** The cached file for a track if it exists and is intact, otherwise null (and the stale entry is dropped). */
  validFile(trackId: string, notify = true): string | null {
    const entry = this.o.repo.getCacheEntry(trackId)
    if (!entry) return null
    try {
      if (statSync(entry.file).size === entry.bytes) return entry.file
    } catch { /* missing */ }
    this.discard(trackId, notify)
    return null
  }

  /** Remove a damaged or missing entry so the next play streams again. */
  discard(trackId: string, notify = true): void {
    const entry = this.o.repo.getCacheEntry(trackId)
    if (entry) {
      rmSync(entry.file, { force: true })
      if (entry.thumbFile) rmSync(entry.thumbFile, { force: true })
      this.o.repo.deleteCacheEntry(trackId)
    }
    if (notify) this.o.onChange([trackId])
  }

  /** Called after a qualified play. Starts a background download if (and only if) the track is eligible. */
  consider(trackId: string): void {
    const track = this.o.repo.getTrack(trackId)
    if (!track || !evaluateCaching(track).eligible || this.jobs.has(trackId)) return
    const job: Job = { cancelled: false, cancel: () => undefined }
    this.jobs.set(trackId, job)
    this.o.repo.downloading.add(trackId)
    this.o.onChange([trackId])
    this.chain = this.chain.then(() => this.run(trackId, job))
  }

  private async run(trackId: string, job: Job): Promise<void> {
    const track = this.o.repo.getTrack(trackId)
    const jobDir = join(this.tmpDir, trackId.replace(/[^\w-]/g, '_'))
    try {
      if (!track || job.cancelled) return
      rmSync(jobDir, { recursive: true, force: true })
      mkdirSync(jobDir, { recursive: true })
      const handle = this.o.provider.download(track.sourceId, jobDir, () => undefined)
      job.cancel = handle.cancel
      if (job.cancelled) handle.cancel()
      const tmpFile = await handle.done

      await (this.o.verify ?? verifyDownloadedAudio)(tmpFile, track.durationSec)
      const ext = (tmpFile.split('.').pop() ?? 'm4a').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'm4a'
      const finalFile = join(this.audioDir, `${track.sourceId}.${ext}`)
      renameSync(tmpFile, finalFile) // same filesystem: atomic

      let thumbFile: string | null = null
      const img = track.thumbnail ? await (this.o.fetchThumb ?? fetchThumbnail)(track.thumbnail) : null
      if (img) {
        const tmpThumb = join(jobDir, 'thumb.jpg')
        writeFileSync(tmpThumb, img)
        thumbFile = join(this.thumbDir, `${track.sourceId}.jpg`)
        renameSync(tmpThumb, thumbFile)
      }
      if (job.cancelled) {
        rmSync(finalFile, { force: true })
        if (thumbFile) rmSync(thumbFile, { force: true })
        return
      }
      this.o.repo.setCacheEntry({ trackId, file: finalFile, bytes: statSync(finalFile).size, thumbFile })
      this.o.onMessage?.('info', `“${track.title}” is saved for offline listening.`)
    } catch (err) {
      if (!job.cancelled && !(err instanceof ExecError && err.aborted)) {
        const why = err instanceof Error ? err.message : 'Unknown error'
        this.o.onMessage?.('error', `Couldn’t save “${track?.title ?? 'track'}” offline. ${why}`)
      }
    } finally {
      rmSync(jobDir, { recursive: true, force: true })
      this.jobs.delete(trackId)
      this.o.repo.downloading.delete(trackId)
      this.o.onChange([trackId])
    }
  }

  /** Stop a running or queued download. */
  cancel(trackId: string): void {
    const job = this.jobs.get(trackId)
    if (!job) return
    job.cancelled = true
    job.cancel()
  }

  /** Delete a track's offline copy (and stop any download of it). Metadata stays in the library. */
  delete(trackId: string): void {
    this.cancel(trackId)
    this.discard(trackId)
  }

  deleteAll(): void {
    for (const id of [...this.jobs.keys()]) this.cancel(id)
    const ids = this.o.repo.listCacheEntries().map((e) => e.trackId)
    for (const id of ids) this.discard(id, false)
    if (ids.length) this.o.onChange(ids)
  }

  shutdown(): void {
    for (const id of [...this.jobs.keys()]) this.cancel(id)
    rmSync(this.tmpDir, { recursive: true, force: true })
  }
}
