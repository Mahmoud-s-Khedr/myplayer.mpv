import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { API_METHODS, apiChannel, type Api, type IpcResult } from '@shared/ipc'
import type { CacheManager } from './cache/cache'
import type { Repo } from './db/repo'
import { AUDIO_EXTENSIONS, importLocalFiles } from './local/importer'
import type { PlaybackService } from './player/playback'
import type { MediaProvider } from './providers/types'
import { UserFacingError } from './util/errors'
import { probeAudio } from './util/ffprobe'
import { sanitizeText } from './util/sanitize'

export interface Services {
  repo: Repo
  provider: MediaProvider
  playback: PlaybackService
  cache: CacheManager
  notifyTracks: (ids: string[]) => void
  window: () => BrowserWindow | null
}

const trackId = z.string().regex(/^(yt:[\w-]{11}|file:[0-9a-f]{16})$/)
const trackIds = z.array(trackId).max(1000)
const uid = z.string().min(1).max(64)
const num = z.number().finite()
const playlistId = z.number().int().positive()
const playlistName = z.string().transform((s) => sanitizeText(s, 80)).pipe(z.string().min(1, 'Give the playlist a name.'))

/** Handlers are typed against the shared Api, so a missing or mismatched method fails to compile. */
function buildHandlers(s: Services): Api {
  const { repo, provider, playback, cache } = s
  const requireTracks = (ids: string[]): void => {
    if (repo.getTracks(ids).length !== new Set(ids).size) throw new UserFacingError('Some of those tracks are no longer in your library.')
  }
  return {
    async search(query, creativeCommons) {
      const q = z.string().max(300).parse(query)
      const infos = await provider.search(q, { creativeCommons: z.boolean().parse(creativeCommons), limit: 25 })
      infos.forEach((i) => repo.upsertTrack(i))
      return repo.getTracks(infos.map((i) => i.id))
    },
    async resolveUrl(url) {
      const info = await provider.lookup(z.string().max(2000).parse(url))
      repo.upsertTrack(info)
      return repo.getTrack(info.id)!
    },
    playNow: (ids, start) => playback.playNow(trackIds.parse(ids), z.number().int().min(0).parse(start)),
    enqueue: async (ids, where) => playback.enqueue(trackIds.parse(ids), z.enum(['next', 'end']).parse(where)),
    playQueueItem: (id) => playback.playQueueItem(uid.parse(id)),
    togglePause: () => playback.togglePause(),
    next: () => playback.next(),
    previous: () => playback.previous(),
    seek: (sec) => playback.seek(num.parse(sec)),
    seekBy: (d) => playback.seekBy(num.parse(d)),
    setVolume: (v) => playback.setVolume(num.parse(v)),
    toggleMute: () => playback.toggleMute(),
    setRepeat: async (m) => playback.setRepeat(z.enum(['off', 'all', 'one']).parse(m)),
    removeFromQueue: (id) => playback.removeFromQueue(uid.parse(id)),
    moveInQueue: async (id, to) => playback.moveInQueue(uid.parse(id), z.number().int().parse(to)),
    clearQueue: () => playback.clearQueue(),
    getSnapshot: async () => playback.snapshot(),

    tracks: async (ids) => repo.getTracks(trackIds.parse(ids)),
    library: async (f) => repo.library(z.enum(['all', 'local', 'offline']).parse(f)),
    favorites: async () => repo.favorites(),
    recent: async (n) => repo.recent(z.number().int().min(1).max(100).parse(n)),
    history: async (n) => repo.history(z.number().int().min(1).max(1000).parse(n)),
    clearHistory: async () => repo.clearHistory(),
    async toggleFavorite(id) {
      const result = repo.toggleFavorite(trackId.parse(id))
      s.notifyTracks([id])
      return result
    },
    async importLocalFiles() {
      const win = s.window()
      const opts = {
        title: 'Add music files', properties: ['openFile' as const, 'multiSelections' as const],
        filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }]
      }
      const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (picked.canceled || picked.filePaths.length === 0) return []
      const { tracks, skipped } = await importLocalFiles(picked.filePaths, probeAudio)
      tracks.forEach((t) => repo.upsertTrack(t))
      if (skipped.length) {
        const list = skipped.slice(0, 3).join(', ') + (skipped.length > 3 ? ` and ${skipped.length - 3} more` : '')
        throw new UserFacingError(`Skipped ${skipped.length} file${skipped.length === 1 ? '' : 's'} that aren’t playable audio: ${list}`)
      }
      return repo.getTracks(tracks.map((t) => t.id))
    },

    playlists: async () => repo.playlists(),
    createPlaylist: async (name) => repo.createPlaylist(playlistName.parse(name)),
    renamePlaylist: async (id, name) => repo.renamePlaylist(playlistId.parse(id), playlistName.parse(name)),
    deletePlaylist: async (id) => repo.deletePlaylist(playlistId.parse(id)),
    playlistTracks: async (id) => repo.playlistTracks(playlistId.parse(id)),
    async addToPlaylist(id, ids) {
      const parsed = trackIds.parse(ids)
      requireTracks(parsed)
      repo.addToPlaylist(playlistId.parse(id), parsed)
    },
    removeFromPlaylist: async (id, entry) => repo.removeFromPlaylist(playlistId.parse(id), z.number().int().parse(entry)),

    cacheStats: async () => repo.cacheStats(),
    deleteCached: async (id) => cache.delete(trackId.parse(id)),
    clearCache: async () => cache.deleteAll()
  }
}

function message(err: unknown): string {
  if (err instanceof UserFacingError) return err.message
  if (err instanceof z.ZodError) return err.issues[0]?.message ?? 'That input isn’t valid.'
  console.error(err)
  return 'Something went wrong.'
}

export function registerIpc(services: Services, trusted: () => number | null): void {
  const handlers = buildHandlers(services) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
  for (const name of API_METHODS) {
    ipcMain.handle(apiChannel(name), async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<IpcResult<unknown>> => {
      // Only our own window may call in.
      if (event.sender.id !== trusted()) return { ok: false, error: 'Not allowed.' }
      try {
        return { ok: true, data: await handlers[name](...args) }
      } catch (err) {
        return { ok: false, error: message(err) }
      }
    })
  }
}
