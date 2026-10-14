import type Database from 'better-sqlite3'
import type {
  CacheState, HistoryEntry, LibraryFilter, PlaylistEntry, PlaylistSummary, Track, TrackInfo
} from '@shared/types'

interface TrackRow {
  id: string; source: 'youtube' | 'local'; source_id: string; title: string; channel: string
  duration_sec: number | null; thumbnail: string | null; url: string | null; local_path: string | null
  license: string | null; download_policy: 'allowed' | 'denied' | 'unknown'; policy_reason: string | null
  qualified_plays: number; favorited_at: number | null; last_played_at: number | null
  cache_file: string | null; cache_bytes: number | null; thumb_file: string | null
}

export interface CacheEntry { trackId: string; file: string; bytes: number; thumbFile: string | null }

// Every read goes through this select so a Track always carries its favorite and cache state.
const TRACK_SELECT = `
  SELECT t.*, c.file AS cache_file, c.bytes AS cache_bytes, c.thumb_file AS thumb_file
  FROM tracks t LEFT JOIN cache_entries c ON c.track_id = t.id`

const IN_LIBRARY = `(t.source = 'local' OR t.favorited_at IS NOT NULL OR t.last_played_at IS NOT NULL
  OR c.track_id IS NOT NULL OR EXISTS (SELECT 1 FROM playlist_entries pe WHERE pe.track_id = t.id))`

export class Repo {
  /** Track ids with a download in flight; owned by the cache manager. */
  readonly downloading = new Set<string>()

  constructor(private readonly db: Database.Database, private readonly now: () => number = Date.now) {}

  // ---- tracks ----

  upsertTrack(info: TrackInfo): void {
    // Search results only know title/channel/duration. Never let them erase a policy we already decided.
    this.db.prepare(
      `INSERT INTO tracks (id, source, source_id, title, channel, duration_sec, thumbnail, url, local_path, license, download_policy, policy_reason, added_at)
       VALUES (@id, @source, @sourceId, @title, @channel, @durationSec, @thumbnail, @url, @localPath, @license, @downloadPolicy, @policyReason, @addedAt)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title, channel = excluded.channel,
         duration_sec = COALESCE(excluded.duration_sec, duration_sec),
         thumbnail = COALESCE(excluded.thumbnail, thumbnail), url = COALESCE(excluded.url, url),
         local_path = COALESCE(excluded.local_path, local_path),
         license = CASE WHEN excluded.download_policy = 'unknown' THEN license ELSE excluded.license END,
         policy_reason = CASE WHEN excluded.download_policy = 'unknown' THEN policy_reason ELSE excluded.policy_reason END,
         download_policy = CASE WHEN excluded.download_policy = 'unknown' THEN download_policy ELSE excluded.download_policy END`
    ).run({ ...info, addedAt: this.now() })
  }

  getTracks(ids: string[]): Track[] {
    if (ids.length === 0) return []
    const rows = this.db.prepare(`${TRACK_SELECT} WHERE t.id IN (${ids.map(() => '?').join(',')})`).all(...ids) as TrackRow[]
    const byId = new Map(rows.map((r) => [r.id, this.toTrack(r)]))
    return ids.map((id) => byId.get(id)).filter((t): t is Track => t !== undefined)
  }

  getTrack(id: string): Track | null {
    return this.getTracks([id])[0] ?? null
  }

  library(filter: LibraryFilter): Track[] {
    const where = filter === 'local' ? `t.source = 'local'` : filter === 'offline' ? `c.track_id IS NOT NULL` : IN_LIBRARY
    return this.rows(`${TRACK_SELECT} WHERE ${where} ORDER BY t.title COLLATE NOCASE`)
  }

  favorites(): Track[] {
    return this.rows(`${TRACK_SELECT} WHERE t.favorited_at IS NOT NULL ORDER BY t.favorited_at DESC`)
  }

  recent(limit: number): Track[] {
    return this.rows(`${TRACK_SELECT} WHERE t.last_played_at IS NOT NULL ORDER BY t.last_played_at DESC LIMIT ?`, limit)
  }

  toggleFavorite(id: string): boolean {
    const row = this.db.prepare('SELECT favorited_at FROM tracks WHERE id = ?').get(id) as { favorited_at: number | null } | undefined
    if (!row) throw new Error('Unknown track')
    const next = row.favorited_at === null ? this.now() : null
    this.db.prepare('UPDATE tracks SET favorited_at = ? WHERE id = ?').run(next, id)
    return next !== null
  }

  // ---- listening sessions ----

  startSession(trackId: string): number {
    const now = this.now()
    return this.db.transaction(() => {
      this.db.prepare('UPDATE tracks SET last_played_at = ? WHERE id = ?').run(now, trackId)
      return Number(this.db.prepare('INSERT INTO plays (track_id, started_at) VALUES (?, ?)').run(trackId, now).lastInsertRowid)
    })()
  }

  updateSession(playId: number, listenedMs: number): void {
    this.db.prepare('UPDATE plays SET listened_ms = ? WHERE id = ?').run(Math.round(listenedMs), playId)
  }

  /** Marks the session qualified and counts it. Idempotent per session, so a play is counted once. */
  qualifySession(playId: number, trackId: string, listenedMs: number): number {
    return this.db.transaction(() => {
      const res = this.db.prepare('UPDATE plays SET qualified = 1, listened_ms = ? WHERE id = ? AND qualified = 0').run(Math.round(listenedMs), playId)
      if (res.changes === 1) this.db.prepare('UPDATE tracks SET qualified_plays = qualified_plays + 1 WHERE id = ?').run(trackId)
      return (this.db.prepare('SELECT qualified_plays AS n FROM tracks WHERE id = ?').get(trackId) as { n: number }).n
    })()
  }

  history(limit: number): HistoryEntry[] {
    const rows = this.db.prepare(
      'SELECT id, track_id, started_at, listened_ms, qualified FROM plays WHERE listened_ms >= 5000 OR qualified = 1 ORDER BY started_at DESC, id DESC LIMIT ?'
    ).all(limit) as { id: number; track_id: string; started_at: number; listened_ms: number; qualified: number }[]
    const tracks = new Map(this.getTracks([...new Set(rows.map((r) => r.track_id))]).map((t) => [t.id, t]))
    return rows.flatMap((r) => {
      const track = tracks.get(r.track_id)
      return track ? [{ id: r.id, startedAt: r.started_at, listenedMs: r.listened_ms, qualified: r.qualified === 1, track }] : []
    })
  }

  clearHistory(): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM plays').run()
      this.db.prepare('UPDATE tracks SET last_played_at = NULL').run()
    })()
  }

  // ---- playlists ----

  playlists(): PlaylistSummary[] {
    return (this.db.prepare(
      `SELECT p.id, p.name, p.updated_at AS updatedAt, COUNT(e.id) AS count
       FROM playlists p LEFT JOIN playlist_entries e ON e.playlist_id = p.id
       GROUP BY p.id ORDER BY p.created_at, p.id`
    ).all() as PlaylistSummary[])
  }

  createPlaylist(name: string): PlaylistSummary {
    const now = this.now()
    const id = Number(this.db.prepare('INSERT INTO playlists (name, created_at, updated_at) VALUES (?, ?, ?)').run(name, now, now).lastInsertRowid)
    return { id, name, count: 0, updatedAt: now }
  }

  renamePlaylist(id: number, name: string): void {
    this.db.prepare('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?').run(name, this.now(), id)
  }

  deletePlaylist(id: number): void {
    this.db.prepare('DELETE FROM playlists WHERE id = ?').run(id)
  }

  playlistTracks(id: number): PlaylistEntry[] {
    const rows = this.db.prepare('SELECT id, track_id FROM playlist_entries WHERE playlist_id = ? ORDER BY position, id').all(id) as { id: number; track_id: string }[]
    const tracks = new Map(this.getTracks([...new Set(rows.map((r) => r.track_id))]).map((t) => [t.id, t]))
    return rows.flatMap((r) => {
      const track = tracks.get(r.track_id)
      return track ? [{ entryId: r.id, track }] : []
    })
  }

  /** Appends tracks, skipping ones already in the playlist. Returns how many were added. */
  addToPlaylist(id: number, trackIds: string[]): number {
    const now = this.now()
    return this.db.transaction(() => {
      let position = (this.db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM playlist_entries WHERE playlist_id = ?').get(id) as { p: number }).p
      const exists = this.db.prepare('SELECT 1 FROM playlist_entries WHERE playlist_id = ? AND track_id = ?')
      const insert = this.db.prepare('INSERT INTO playlist_entries (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)')
      let added = 0
      for (const trackId of trackIds) {
        if (exists.get(id, trackId)) continue
        insert.run(id, trackId, ++position, now)
        added++
      }
      if (added) this.db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now, id)
      return added
    })()
  }

  removeFromPlaylist(id: number, entryId: number): void {
    this.db.prepare('DELETE FROM playlist_entries WHERE id = ? AND playlist_id = ?').run(entryId, id)
  }

  // ---- cache bookkeeping ----

  getCacheEntry(trackId: string): CacheEntry | null {
    const r = this.db.prepare('SELECT track_id, file, bytes, thumb_file FROM cache_entries WHERE track_id = ?').get(trackId) as
      { track_id: string; file: string; bytes: number; thumb_file: string | null } | undefined
    return r ? { trackId: r.track_id, file: r.file, bytes: r.bytes, thumbFile: r.thumb_file } : null
  }

  listCacheEntries(): CacheEntry[] {
    return (this.db.prepare('SELECT track_id, file, bytes, thumb_file FROM cache_entries').all() as
      { track_id: string; file: string; bytes: number; thumb_file: string | null }[])
      .map((r) => ({ trackId: r.track_id, file: r.file, bytes: r.bytes, thumbFile: r.thumb_file }))
  }

  setCacheEntry(e: CacheEntry): void {
    this.db.prepare(
      `INSERT INTO cache_entries (track_id, file, bytes, thumb_file, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(track_id) DO UPDATE SET file = excluded.file, bytes = excluded.bytes, thumb_file = excluded.thumb_file`
    ).run(e.trackId, e.file, e.bytes, e.thumbFile, this.now())
  }

  deleteCacheEntry(trackId: string): void {
    this.db.prepare('DELETE FROM cache_entries WHERE track_id = ?').run(trackId)
  }

  cacheStats(): { count: number; bytes: number } {
    return this.db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes FROM cache_entries').get() as { count: number; bytes: number }
  }

  // ---- small key/value store (queue, volume) ----

  getJson<T>(key: string): T | null {
    const r = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
    if (!r) return null
    try { return JSON.parse(r.value) as T } catch { return null }
  }

  setJson(key: string, value: unknown): void {
    this.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value))
  }

  // ---- mapping ----

  private rows(sql: string, ...params: unknown[]): Track[] {
    return (this.db.prepare(sql).all(...params) as TrackRow[]).map((r) => this.toTrack(r))
  }

  private toTrack(r: TrackRow): Track {
    const cache: CacheState = r.cache_file ? 'ready' : this.downloading.has(r.id) ? 'downloading' : 'none'
    return {
      id: r.id, source: r.source, sourceId: r.source_id, title: r.title, channel: r.channel,
      durationSec: r.duration_sec, thumbnail: r.thumbnail, url: r.url, localPath: r.local_path,
      license: r.license, downloadPolicy: r.download_policy, policyReason: r.policy_reason,
      qualifiedPlays: r.qualified_plays, favorite: r.favorited_at !== null, cache,
      cacheBytes: r.cache_bytes ?? 0, localThumb: r.thumb_file !== null, lastPlayedAt: r.last_played_at
    }
  }
}
