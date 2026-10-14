import type {
  CacheStats,
  HistoryEntry,
  LibraryFilter,
  PlayerState,
  PlaylistEntry,
  PlaylistSummary,
  QueueSnapshot,
  RepeatMode,
  Toast,
  Track,
  TrackChange
} from './types'

/**
 * The whole renderer-to-main surface. Tracks are always referenced by id: the main process
 * owns the track table, so the renderer can never make it play an arbitrary path or URL.
 */
export interface Api {
  // discovery
  search(query: string, creativeCommons: boolean): Promise<Track[]>
  resolveUrl(url: string): Promise<Track>
  // playback
  playNow(ids: string[], startIndex: number): Promise<void>
  enqueue(ids: string[], where: 'next' | 'end'): Promise<void>
  playQueueItem(uid: string): Promise<void>
  togglePause(): Promise<void>
  next(): Promise<void>
  previous(): Promise<void>
  seek(sec: number): Promise<void>
  seekBy(deltaSec: number): Promise<void>
  setVolume(volume: number): Promise<void>
  toggleMute(): Promise<void>
  setRepeat(mode: RepeatMode): Promise<void>
  removeFromQueue(uid: string): Promise<void>
  moveInQueue(uid: string, toIndex: number): Promise<void>
  clearQueue(): Promise<void>
  getSnapshot(): Promise<{ player: PlayerState; queue: QueueSnapshot }>
  // library
  tracks(ids: string[]): Promise<Track[]>
  library(filter: LibraryFilter): Promise<Track[]>
  favorites(): Promise<Track[]>
  recent(limit: number): Promise<Track[]>
  history(limit: number): Promise<HistoryEntry[]>
  clearHistory(): Promise<void>
  toggleFavorite(id: string): Promise<boolean>
  importLocalFiles(): Promise<Track[]>
  // playlists
  playlists(): Promise<PlaylistSummary[]>
  createPlaylist(name: string): Promise<PlaylistSummary>
  renamePlaylist(id: number, name: string): Promise<void>
  deletePlaylist(id: number): Promise<void>
  playlistTracks(id: number): Promise<PlaylistEntry[]>
  addToPlaylist(id: number, trackIds: string[]): Promise<void>
  removeFromPlaylist(id: number, entryId: number): Promise<void>
  // cache
  cacheStats(): Promise<CacheStats>
  deleteCached(id: string): Promise<void>
  clearCache(): Promise<void>
}

export interface Events {
  'player:state': PlayerState
  'queue:changed': QueueSnapshot
  'tracks:changed': TrackChange
  'toast': Toast
}

export type Unsubscribe = () => void

export interface Bridge extends Api {
  on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): Unsubscribe
}

export const API_METHODS: readonly (keyof Api)[] = [
  'search', 'resolveUrl', 'playNow', 'enqueue', 'playQueueItem', 'togglePause', 'next', 'previous',
  'seek', 'seekBy', 'setVolume', 'toggleMute', 'setRepeat', 'removeFromQueue', 'moveInQueue',
  'clearQueue', 'getSnapshot', 'tracks', 'library', 'favorites', 'recent', 'history', 'clearHistory',
  'toggleFavorite', 'importLocalFiles', 'playlists', 'createPlaylist', 'renamePlaylist',
  'deletePlaylist', 'playlistTracks', 'addToPlaylist', 'removeFromPlaylist', 'cacheStats',
  'deleteCached', 'clearCache'
]

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }
export const apiChannel = (name: string): string => `api:${name}`
export const eventChannel = (name: string): string => `event:${name}`
