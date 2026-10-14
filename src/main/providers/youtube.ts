import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ChannelPlaylist, ChannelTab, DownloadPolicy, TrackInfo } from '@shared/types'
import { ExecError, run, spawnBackground } from '../util/exec'
import { sanitizeDuration, sanitizeText, sanitizeThumbnailUrl } from '../util/sanitize'
import { UserFacingError } from '../util/errors'
import type { ChannelInfo, DownloadHandle, LinkInfo, MediaProvider, ResolvedStream } from './types'

const VIDEO_ID = /^[\w-]{11}$/
// YouTube's search filter for "Creative Commons" licensed videos.
const CC_FILTER = 'EgIwAQ%253D%253D'

export const youtubeTrackId = (videoId: string): string => `yt:${videoId}`
export const watchUrl = (videoId: string): string => `https://www.youtube.com/watch?v=${videoId}`

/** Returns the video id for a single-video YouTube URL, or null for anything else. */
export function parseYouTubeUrl(input: string): string | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '')
  let id: string | null = null
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const [, kind, second] = url.pathname.split('/')
    if (kind === 'watch') id = url.searchParams.get('v')
    else if (kind === 'shorts' || kind === 'embed' || kind === 'live' || kind === 'v') id = second ?? null
  }
  return id && VIDEO_ID.test(id) ? id : null
}

/** Canonical URLs handed to yt-dlp are rebuilt from validated parts rather than copied from the input. */
export type CollectionTarget = { kind: 'playlist'; url: string } | { kind: 'channel'; url: string; ref: string }

const PLAYLIST_ID = /^[\w-]{10,64}$/
const CHANNEL_ID = /^UC[\w-]{22}$/
const HANDLE = /^@[\p{L}\p{N}_.\-]{2,60}$/u
const LEGACY_NAME = /^[\p{L}\p{N}_.\- ]{1,100}$/u
const CHANNEL_TABS = new Set(['videos', 'featured'])
const COLLECTION_LIMIT = 200

/** Returns the playlist or channel a YouTube URL points at, or null for anything else. */
export function parseYouTubeCollection(input: string): CollectionTarget | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '') !== 'youtube.com') return null
  let parts: string[]
  try {
    parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return null
  }
  const [first, second] = parts
  if (first === 'playlist' && parts.length === 1) {
    const list = url.searchParams.get('list')
    return list && PLAYLIST_ID.test(list) ? { kind: 'playlist', url: `https://www.youtube.com/playlist?list=${list}` } : null
  }
  const channelUrl = (ref: string, extra: string[]): CollectionTarget | null =>
    extra.length === 0 || (extra.length === 1 && CHANNEL_TABS.has(extra[0])) ? { kind: 'channel', ref, url: `https://www.youtube.com/${ref}/videos` } : null
  if (first && HANDLE.test(first)) return channelUrl(`@${encodeURIComponent(first.slice(1))}`, parts.slice(1))
  if (first === 'channel' && second && CHANNEL_ID.test(second)) return channelUrl(`channel/${second}`, parts.slice(2))
  if ((first === 'c' || first === 'user') && second && LEGACY_NAME.test(second)) return channelUrl(`${first}/${encodeURIComponent(second)}`, parts.slice(2))
  return null
}

/** The URL of one tab of a channel, or null when `ref` isn't a channel reference. */
export function channelTabUrl(ref: string, tab: ChannelTab): string | null {
  const target = parseYouTubeCollection(`https://www.youtube.com/${ref}`)
  return target?.kind === 'channel' ? `https://www.youtube.com/${target.ref}/${tab}` : null
}

interface RawFormat { has_drm?: boolean | string }
export interface RawVideo {
  id?: string
  title?: string
  channel?: string
  channel_id?: string
  uploader?: string
  duration?: number | null
  license?: string | null
  is_live?: boolean
  live_status?: string | null
  availability?: string | null
  url?: string
  http_headers?: Record<string, string>
  formats?: RawFormat[]
  requested_formats?: RawFormat[]
}

/**
 * YouTube only permits reuse of Creative Commons licensed uploads. Everything else is streaming-only.
 * This is the single place that decides whether a YouTube track may ever be saved.
 */
export function youtubeDownloadPolicy(raw: RawVideo): { policy: DownloadPolicy; reason: string } {
  if (raw.is_live || (raw.live_status && raw.live_status !== 'not_live' && raw.live_status !== 'was_live')) {
    return { policy: 'denied', reason: 'Live streams can’t be saved.' }
  }
  if (raw.availability && !['public', 'unlisted'].includes(raw.availability)) {
    return { policy: 'denied', reason: 'This video isn’t publicly available, so it can’t be saved.' }
  }
  const drm = [...(raw.requested_formats ?? []), ...(raw.formats ?? [])].some((f) => f.has_drm === true || f.has_drm === 'maybe')
  if (drm) return { policy: 'denied', reason: 'This video is DRM-protected and can’t be saved.' }
  if (typeof raw.license === 'string' && /creative commons/i.test(raw.license)) {
    return { policy: 'allowed', reason: 'Creative Commons license: reuse is allowed.' }
  }
  return { policy: 'denied', reason: 'YouTube only allows saving Creative Commons videos. This one streams only.' }
}

export function toTrackInfo(raw: RawVideo, decided: boolean): TrackInfo | null {
  const id = raw.id
  if (typeof id !== 'string' || !VIDEO_ID.test(id)) return null
  const title = sanitizeText(raw.title, 200)
  if (!title) return null
  const policy = decided ? youtubeDownloadPolicy(raw) : { policy: 'unknown' as const, reason: '' }
  return {
    id: youtubeTrackId(id),
    source: 'youtube',
    sourceId: id,
    title,
    channel: sanitizeText(raw.channel ?? raw.uploader, 120) || 'Unknown channel',
    channelId: typeof raw.channel_id === 'string' && CHANNEL_ID.test(raw.channel_id) ? raw.channel_id : null,
    durationSec: raw.is_live ? null : sanitizeDuration(raw.duration),
    thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    url: watchUrl(id),
    localPath: null,
    license: decided ? sanitizeText(raw.license, 80) || null : null,
    downloadPolicy: policy.policy,
    policyReason: policy.reason || null
  }
}

export interface RawPlaylistEntry {
  id?: string
  title?: string
  url?: string
  ie_key?: string
  thumbnails?: { url?: string }[] | null
}

export interface RawCollection {
  title?: string
  channel?: string
  channel_id?: string
  uploader?: string
  entries?: (RawVideo & RawPlaylistEntry)[] | null
}

/** Shape yt-dlp's flat playlist dump into tracks. Unplayable placeholders (private, deleted) are dropped. */
export function toCollectionInfo(kind: CollectionTarget['kind'], raw: RawCollection, limit: number): LinkInfo {
  const entries = raw.entries ?? []
  const owner = raw.channel ?? raw.uploader
  // A channel's own upload list leaves per-video channel fields out; a playlist's owner isn't its videos' uploader.
  const own = kind === 'channel' ? { channel: owner, channel_id: raw.channel_id } : {}
  const tracks = entries
    .map((e) => toTrackInfo({ ...e, channel: e.channel ?? e.uploader ?? own.channel, channel_id: e.channel_id ?? own.channel_id }, false))
    .filter((t): t is TrackInfo => t !== null && !/^\[(private|deleted) video\]$/i.test(t.title))
  if (tracks.length === 0) {
    throw new UserFacingError(kind === 'channel' ? 'This channel has no videos to play.' : 'This playlist has no playable videos.')
  }
  const title = kind === 'channel' ? channelTitle(raw) : sanitizeText(raw.title, 80) || 'YouTube playlist'
  return { kind, title, tracks, truncated: entries.length >= limit, channelRef: null }
}

function channelTitle(raw: RawCollection): string {
  return sanitizeText(raw.channel ?? raw.uploader, 80) || sanitizeText(raw.title, 200).replace(/ - (Videos|Playlists)$/, '') || 'YouTube channel'
}

/** A channel's playlists tab lists playlists as url entries; anything else in there is ignored. */
export function toChannelPlaylist(e: RawPlaylistEntry): ChannelPlaylist | null {
  const id = e.id
  if (typeof id !== 'string' || !PLAYLIST_ID.test(id) || VIDEO_ID.test(id)) return null
  if (e.ie_key !== 'YoutubeTab' && !/[?&]list=/.test(e.url ?? '')) return null
  const title = sanitizeText(e.title, 120)
  if (!title) return null
  const thumbnail = (e.thumbnails ?? []).map((t) => sanitizeThumbnailUrl(t?.url)).find((u): u is string => u !== null) ?? null
  return { id, title, thumbnail }
}

export function toChannelInfo(tab: ChannelTab, raw: RawCollection, limit: number): ChannelInfo {
  if (tab === 'videos') {
    const { title, tracks, truncated } = toCollectionInfo('channel', raw, limit)
    return { title, tab, tracks, playlists: [], truncated }
  }
  const entries = raw.entries ?? []
  const playlists = entries.map(toChannelPlaylist).filter((p): p is ChannelPlaylist => p !== null)
  return { title: channelTitle(raw), tab, tracks: [], playlists, truncated: entries.length >= limit }
}

/** Turn yt-dlp's stderr into a sentence a listener can act on. */
export function explainYtdlpError(stderr: string): string {
  const s = stderr.toLowerCase()
  if (/http error (404|400)/.test(s) && /youtube:tab/.test(s)) return 'That playlist or channel doesn’t exist, or it’s private.'
  if (/getaddrinfo|temporary failure|name or service|network is unreachable|timed out|connection (reset|refused)|unable to download (webpage|api|json)|urlopen error/.test(s))
    return 'Can’t reach YouTube. Check your connection. Saved tracks still play offline.'
  if (/private video/.test(s)) return 'This video is private.'
  if (/sign in to confirm your age|age-restricted|age restricted/.test(s)) return 'This video is age-restricted and can’t be played here.'
  if (/not available in your country|blocked it in your country|geo/.test(s)) return 'This video isn’t available in your region.'
  if (/(playlist|channel).{0,40}(private|does not exist|not exist)|channel.{0,40}terminated/.test(s)) return 'That playlist or channel is private or doesn’t exist.'
  if (/video unavailable|has been removed|no longer available|does not exist|terminated/.test(s)) return 'This video is unavailable.'
  if (/members-only|join this channel|premium/.test(s)) return 'This video is restricted to members or subscribers.'
  if (/sign in to confirm you.re not a bot/.test(s)) return 'YouTube asked for a sign-in check. Try again in a few minutes.'
  const last = stderr.trim().split('\n').filter(Boolean).pop() ?? ''
  return last ? `Couldn’t load this track: ${sanitizeText(last.replace(/^ERROR:\s*/, ''), 140)}` : 'Couldn’t load this track.'
}

const YTDLP = process.env['MYPLAYER_YTDLP'] || 'yt-dlp'
const BASE_ARGS = ['--no-warnings', '--no-playlist', '--ignore-config']

export class YouTubeProvider implements MediaProvider {
  readonly id = 'youtube' as const

  async search(query: string, opts: { creativeCommons: boolean; limit: number }, signal?: AbortSignal): Promise<TrackInfo[]> {
    const q = sanitizeText(query, 200)
    if (!q) return []
    const target = opts.creativeCommons
      ? `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=${CC_FILTER}`
      : `ytsearch${opts.limit}:${q}`
    try {
      const { stdout } = await run(
        YTDLP,
        ['--ignore-config', '--no-warnings', '--flat-playlist', '--dump-single-json', '--playlist-end', String(opts.limit), '--', target],
        { signal, timeoutMs: 40_000 }
      )
      const entries: RawVideo[] = JSON.parse(stdout).entries ?? []
      return entries.map((e) => toTrackInfo(e, false)).filter((t): t is TrackInfo => t !== null)
    } catch (err) {
      throw this.wrap(err)
    }
  }

  async lookupLink(input: string, signal?: AbortSignal): Promise<LinkInfo> {
    // A watch URL that also carries a list id is the single video, as it always was.
    const id = parseYouTubeUrl(input)
    if (id) {
      const { info } = await this.resolve(id, signal)
      return { kind: 'track', title: info.title, tracks: [info], truncated: false, channelRef: null }
    }
    const target = parseYouTubeCollection(input)
    if (!target) throw new UserFacingError('That isn’t a link to a YouTube video, playlist or channel.')
    // The channel view loads its own tabs, so there is nothing to fetch here.
    if (target.kind === 'channel') return { kind: 'channel', title: '', tracks: [], truncated: false, channelRef: target.ref }
    return toCollectionInfo(target.kind, await this.dumpFlat(target.url, signal), COLLECTION_LIMIT)
  }

  async browseChannel(ref: string, tab: ChannelTab, signal?: AbortSignal): Promise<ChannelInfo> {
    const url = channelTabUrl(ref, tab)
    if (!url) throw new UserFacingError('That isn’t a channel.')
    return toChannelInfo(tab, await this.dumpFlat(url, signal), COLLECTION_LIMIT)
  }

  private async dumpFlat(url: string, signal?: AbortSignal): Promise<RawCollection> {
    try {
      const { stdout } = await run(
        YTDLP,
        ['--ignore-config', '--no-warnings', '--flat-playlist', '--dump-single-json', '--playlist-end', String(COLLECTION_LIMIT), '--', url],
        { signal, timeoutMs: 60_000 }
      )
      return JSON.parse(stdout) as RawCollection
    } catch (err) {
      throw this.wrap(err)
    }
  }

  async resolve(sourceId: string, signal?: AbortSignal): Promise<ResolvedStream> {
    if (!VIDEO_ID.test(sourceId)) throw new UserFacingError('Invalid video id.')
    try {
      const { stdout } = await run(YTDLP, [...BASE_ARGS, '-f', 'bestaudio/best', '--dump-json', '--', watchUrl(sourceId)], {
        signal,
        timeoutMs: 45_000
      })
      const raw: RawVideo = JSON.parse(stdout)
      const info = toTrackInfo(raw, true)
      if (!info || typeof raw.url !== 'string' || !/^https:\/\//.test(raw.url)) throw new UserFacingError('This video has no playable audio.')
      return { info, streamUrl: raw.url, headers: raw.http_headers ?? {} }
    } catch (err) {
      throw this.wrap(err)
    }
  }

  download(sourceId: string, dir: string, onProgress: (fraction: number) => void): DownloadHandle {
    // Audio-only on purpose: with no fallback format, a video that has no audio stream fails instead of downloading video.
    const child = spawnBackground(YTDLP, [
      ...BASE_ARGS, '-f', 'bestaudio[ext=m4a]/bestaudio', '--newline', '--no-mtime',
      '--progress-template', 'download:%(progress.downloaded_bytes)s/%(progress.total_bytes)s',
      '-o', join(dir, `${sourceId}.%(ext)s`), '--', watchUrl(sourceId)
    ])
    let stderr = ''
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))
    child.stdout?.on('data', (d: Buffer) => {
      for (const m of d.toString().matchAll(/download:(\d+)\/(\d+)/g)) onProgress(Number(m[1]) / Number(m[2]))
    })
    let cancelled = false
    const done = new Promise<string>((resolve, reject) => {
      child.on('error', (e) => reject(new UserFacingError(`Couldn’t start yt-dlp: ${e.message}`)))
      child.on('close', (code) => {
        if (cancelled) return reject(new ExecError('cancelled', '', true))
        if (code !== 0) return reject(new UserFacingError(explainYtdlpError(stderr)))
        // yt-dlp finishes (and renames its .part file) before exiting; find the finished file.
        const file = readdirSync(dir).find((f) => f.startsWith(`${sourceId}.`) && !/\.(part|ytdl|temp)$/.test(f))
        file ? resolve(join(dir, file)) : reject(new UserFacingError('The download produced no file.'))
      })
    })
    return { done, cancel: () => { cancelled = true; child.kill('SIGTERM') } }
  }

  private wrap(err: unknown): Error {
    if (err instanceof UserFacingError) return err
    if (err instanceof ExecError) {
      if (err.aborted) return err
      if (err.message.includes('not installed')) return new UserFacingError('yt-dlp is not installed. Install it with: sudo dnf install yt-dlp')
      return new UserFacingError(explainYtdlpError(err.stderr))
    }
    return new UserFacingError('YouTube returned something unexpected. Try again.')
  }
}
