<p align="center"><img src="assets/logo/logo-dark.svg" alt="MyPlayer" width="420"></p>

# MyPlayer

A local-first desktop music player for Linux. Search YouTube, play audio through mpv, keep a listening
library in SQLite, and get automatic offline copies of tracks you replay, when the source allows it.

Built with Electron, React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Zustand, better-sqlite3, mpv and yt-dlp.
No backend server: everything runs on your machine.

## Set up (Fedora)

```bash
sudo dnf install mpv yt-dlp ffmpeg-free       # ffmpeg-free provides ffprobe; see note below
git clone <this repo> && cd myplayer.mpv
npm install                                   # also rebuilds better-sqlite3 for Electron
npm run dev                                   # development, with hot reload
```

Run the built app, without packaging:

```bash
npm run build && npm start
```

Build installable packages (AppImage, deb and RPM, written to `dist/`; CI does this on every push, see `.github/workflows/build.yml`):

```bash
npm run package
sudo dnf install ./dist/myplayer-0.1.0.x86_64.rpm   # pulls in mpv, yt-dlp and ffmpeg-free
```

Notes:

- Requires Node.js 22 or newer.
- yt-dlp needs a JavaScript runtime for some YouTube extractions. If search or playback starts failing
  with "sign in" or signature errors, update yt-dlp (`sudo dnf upgrade yt-dlp`) and make sure `nodejs` or `deno` is installed.
- `ffprobe` is used to read local-file tags and to verify finished downloads. Without it the app still works:
  local files get their file name as the title, and downloads are checked by size only.
- Data lives in `~/.local/share/myplayer/` (`library.db`, `cache/audio`, `cache/thumbs`). Set
  `MYPLAYER_DATA_DIR` to use another folder.

## Using it

| Do this | Result |
| --- | --- |
| Type in Search and press Enter | Searches YouTube: titles, thumbnails, channels, durations |
| Paste a video link | Opens that single video (a watch link that also has `&list=` opens just the video) |
| Paste a playlist link | Loads up to 200 videos. Play all, add them to the queue, or save them as a playlist |
| Paste a channel link, or click a channel name on any track (or ⋯ → Go to channel) | Opens the channel: a Videos tab with its latest uploads and a Playlists tab. Open a playlist in place, then play, queue or save it |
| Double-click a row, or press Enter on it | Plays it; the list becomes the queue |
| ⋯ menu on a row | Play next, add to queue, add to playlist, favorite, remove offline copy |
| Library → Add files | Adds MP3, FLAC, Ogg, Opus, M4A, WAV and similar files from disk |
| Library → Saved offline | Shows offline copies, their size, and lets you remove them |

### Keyboard

`Space` play/pause · `←` `→` seek 5s (`Shift` 30s) · `N` / `P` next / previous · `+` `-` volume · `M` mute ·
`R` repeat · `F` favorite · `Q` queue panel · `/` or `Ctrl+K` search · `1`–`4` switch view · `↑` `↓` move through a list ·
`Enter` play · `Alt+↑↓` reorder in the queue · `Delete` remove from the queue · `?` list all.

## How offline caching works

A track is saved for offline listening only when **all** of these hold:

1. It has had **two qualified plays**. A play qualifies after 30 seconds of real listening (half the track for
   tracks shorter than a minute). Seeking, pausing and scrubbing add no time, and each listening session counts once.
2. Its source says saving is allowed. For YouTube that means a **Creative Commons** license, a public video,
   not a live stream, and no DRM. Everything else is streaming-only, and the UI says so. Turn on
   “Creative Commons only” in Search to find tracks that can be saved.
3. It isn't already saved or downloading.

Then, in the background and at low CPU priority, yt-dlp downloads the **audio stream only** into a temporary folder.
The file is checked with ffprobe (it must contain audio of about the expected length) and then moved into place with an
atomic rename. A damaged, truncated or deleted copy is detected, dropped, and the track streams again.
A saved copy is always preferred over the network, so it plays with no connection, and cover art and metadata
are kept in SQLite and on disk for offline use.

## Architecture

```
src/main/
  index.ts          app start-up, single-instance lock, thumb:// protocol
  ipc.ts            the only renderer entry point; every call is validated with zod
  providers/        MediaProvider interface + YouTube/yt-dlp implementation (swap it out here)
  player/
    mpv.ts          owns the single mpv process, talks JSON IPC over a Unix socket
    playback.ts     queue, source selection (local > offline copy > stream), history, cache triggers
    queue.ts        pure queue operations          playTracker.ts   pure listening-time rules
  cache/
    eligibility.ts  pure "should this be saved?" rules      cache.ts   background download + verify + publish
  db/               SQLite schema, migrations and repository
  local/            local-file import
src/preload/        contextBridge: typed API only, no Node access in the renderer
src/shared/         types and the IPC contract shared by both sides
src/renderer/       React UI (Zustand store, shadcn/ui components)
tests/              Vitest suites (see below)
```

Security: the renderer is sandboxed with context isolation and a strict CSP; the main process accepts IPC only from
its own window. Tracks are referenced by id, so the UI can never make the app play an arbitrary path or URL. All external
programs run through `execFile` with argument arrays (no shell), URLs are parsed and restricted to YouTube videos, playlists and channels (yt-dlp only ever receives a URL rebuilt from the validated parts),
and titles and thumbnails from the network are sanitized before they are stored or shown.

## Tests

```bash
npm test          # 106 tests
npm run typecheck
```

Tests run through Electron's Node (`ELECTRON_RUN_AS_NODE`), so `better-sqlite3` needs only one build. They cover cache
eligibility, play counting, queue behaviour, SQLite operations, URL validation and metadata sanitizing, the cache
manager (atomic publish, duplicates, corruption, cancel, delete), local import, and **real mpv** with silent output:
play, pause, seek, end of file, errors, a single process, the offline-copy flow, damaged-copy fallback, cancelling a
slow load, and queue restore after restart.

Debugging: `MYPLAYER_DEBUG=1 npm run dev` logs mpv events. `MYPLAYER_YTDLP=/path/to/yt-dlp` picks another yt-dlp binary.

## Remaining limitations

- **Linux only.** Paths, the mpv socket and packaging target Fedora/Linux (X11 and Wayland). Windows and macOS are untested.
- **No media-key or desktop-widget integration (MPRIS).** Keyboard shortcuts work only while the app window is focused.
- **Offline saving is limited to Creative Commons YouTube videos.** Other YouTube tracks always need a connection;
  this is deliberate and not worked around. The same goes for age-restricted, members-only, private or DRM content.
- **Cover art for tracks that aren't saved needs a connection.** Titles, channels and durations stay available offline.
- No shuffle, no crossfade or gapless playback between streamed tracks, no playlist reordering (add and remove only),
  no cache size limit or automatic eviction (remove copies from Library → Saved offline).
- yt-dlp can break when YouTube changes; update it with your package manager. The app does not update it.
- Search returns the first 25 results and does not page further. Playlists and channel tabs load the first 200 entries.
- Tracks added before channel browsing existed have no channel link until you see them in a search or playlist again.
- Private playlists and anything that needs a sign-in (Liked videos, Watch later) can't be opened.
- AppImage builds need FUSE on the target machine; the RPM is the recommended install on Fedora.
