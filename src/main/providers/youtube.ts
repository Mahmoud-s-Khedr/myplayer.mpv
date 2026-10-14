import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DownloadPolicy, TrackInfo } from '@shared/types'
import { ExecError, run, spawnBackground } from '../util/exec'
import { sanitizeDuration, sanitizeText } from '../util/sanitize'
import { UserFacingError } from '../util/errors'
import type { DownloadHandle, MediaProvider, ResolvedStream } from './types'

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

interface RawFormat { has_drm?: boolean | string }
export interface RawVideo {
  id?: string
  title?: string
  channel?: string
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
    durationSec: raw.is_live ? null : sanitizeDuration(raw.duration),
    thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    url: watchUrl(id),
    localPath: null,
    license: decided ? sanitizeText(raw.license, 80) || null : null,
    downloadPolicy: policy.policy,
    policyReason: policy.reason || null
  }
}

/** Turn yt-dlp's stderr into a sentence a listener can act on. */
export function explainYtdlpError(stderr: string): string {
  const s = stderr.toLowerCase()
  if (/getaddrinfo|temporary failure|name or service|network is unreachable|timed out|connection (reset|refused)|unable to download (webpage|api|json)|urlopen error/.test(s))
    return 'Can’t reach YouTube. Check your connection. Saved tracks still play offline.'
  if (/private video/.test(s)) return 'This video is private.'
  if (/sign in to confirm your age|age-restricted|age restricted/.test(s)) return 'This video is age-restricted and can’t be played here.'
  if (/not available in your country|blocked it in your country|geo/.test(s)) return 'This video isn’t available in your region.'
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

  async lookup(input: string, signal?: AbortSignal): Promise<TrackInfo> {
    const id = parseYouTubeUrl(input)
    if (!id) throw new UserFacingError('That isn’t a link to a single YouTube video.')
    return (await this.resolve(id, signal)).info
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
