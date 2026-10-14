import { app, BrowserWindow, net, protocol } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { eventChannel, type Events } from '@shared/ipc'
import { CacheManager } from './cache/cache'
import { openDatabase } from './db/database'
import { Repo } from './db/repo'
import { registerIpc } from './ipc'
import { Mpv } from './player/mpv'
import { PlaybackService } from './player/playback'
import { YouTubeProvider } from './providers/youtube'
import { createWindow } from './window'

// Everything the app stores lives in one folder: database, offline audio and thumbnails.
const dataDir = process.env['MYPLAYER_DATA_DIR'] ?? join(process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share'), 'myplayer')
mkdirSync(dataDir, { recursive: true })
app.setPath('userData', dataDir)

// Saved thumbnails are served to the renderer as thumb://t/<track id> so cover art works offline.
protocol.registerSchemesAsPrivileged([{ scheme: 'thumb', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let win: BrowserWindow | null = null
  let quitting = false

  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  void app.whenReady().then(() => {
    const send = <K extends keyof Events>(event: K, payload: Events[K]): void => {
      if (win && !win.isDestroyed()) win.webContents.send(eventChannel(event), payload)
    }

    const repo = new Repo(openDatabase(join(dataDir, 'library.db')))
    const provider = new YouTubeProvider()
    const runtimeDir = process.env['XDG_RUNTIME_DIR'] ?? dataDir
    const mpv = new Mpv({ socketPath: join(runtimeDir, 'myplayer-mpv.sock'), pidFile: join(dataDir, 'mpv.pid') })
    const notifyTracks = (ids: string[]): void => send('tracks:changed', { ids })

    const cache = new CacheManager({
      dir: join(dataDir, 'cache'), repo, provider, onChange: notifyTracks,
      onMessage: (kind, message) => send('toast', { kind, message })
    })
    cache.init()

    const playback = new PlaybackService(mpv, repo, provider, cache, {
      state: (s) => send('player:state', s),
      queue: (q) => send('queue:changed', q),
      tracksChanged: notifyTracks,
      toast: (t) => send('toast', t)
    })
    playback.init()

    protocol.handle('thumb', (request) => {
      const id = decodeURIComponent(new URL(request.url).pathname.slice(1))
      const file = repo.getCacheEntry(id)?.thumbFile
      const root = resolve(cache.thumbsDir) + sep
      if (!file || !resolve(file).startsWith(root) || !existsSync(file)) return new Response(null, { status: 404 })
      return net.fetch(pathToFileURL(file).toString())
    })

    win = createWindow()
    registerIpc({ repo, provider, playback, cache, notifyTracks, window: () => win }, () => win?.webContents.id ?? null)

    app.on('before-quit', (event) => {
      if (quitting) return
      event.preventDefault()
      quitting = true
      cache.shutdown()
      void playback.shutdown().finally(() => app.quit())
    })
  })

  app.on('window-all-closed', () => app.quit())
}
