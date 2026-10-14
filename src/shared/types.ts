export type TrackSource = 'youtube' | 'local'
/** Whether the source allows us to keep an offline copy. Decided by the provider, never by the UI. */
export type DownloadPolicy = 'allowed' | 'denied' | 'unknown'
export type CacheState = 'none' | 'downloading' | 'ready'
export type RepeatMode = 'off' | 'all' | 'one'

/** What a provider (or the file importer) knows about a track. */
export interface TrackInfo {
  id: string
  source: TrackSource
  sourceId: string
  title: string
  channel: string
  durationSec: number | null
  thumbnail: string | null
  /** Public page URL (YouTube watch URL). */
  url: string | null
  /** Only set for local files. */
  localPath: string | null
  license: string | null
  downloadPolicy: DownloadPolicy
  policyReason: string | null
}

/** TrackInfo plus library state kept in SQLite. */
export interface Track extends TrackInfo {
  qualifiedPlays: number
  favorite: boolean
  cache: CacheState
  cacheBytes: number
  localThumb: boolean
  lastPlayedAt: number | null
}

export interface QueueItem {
  uid: string
  track: Track
}

export interface QueueSnapshot {
  items: QueueItem[]
  /** Index of the current item, -1 when the queue is empty. */
  index: number
  repeat: RepeatMode
}

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'
export type PlaySource = 'cache' | 'local' | 'network'

export interface PlayerState {
  status: PlayerStatus
  positionSec: number
  durationSec: number
  volume: number
  muted: boolean
  source: PlaySource | null
  error: string | null
}

export interface PlaylistSummary {
  id: number
  name: string
  count: number
  updatedAt: number
}

export interface PlaylistEntry {
  entryId: number
  track: Track
}

export interface HistoryEntry {
  id: number
  startedAt: number
  listenedMs: number
  qualified: boolean
  track: Track
}

export type LibraryFilter = 'all' | 'local' | 'offline'

export interface CacheStats {
  count: number
  bytes: number
}

export interface Toast {
  kind: 'info' | 'error'
  message: string
}

export type TrackChange = { ids: string[] }
