import { createHash } from 'node:crypto'
import { realpathSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import type { TrackInfo } from '@shared/types'
import type { Probe } from '../util/ffprobe'
import { sanitizeDuration, sanitizeText } from '../util/sanitize'

export const AUDIO_EXTENSIONS = ['mp3', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'wav', 'wma', 'webm', 'mka', 'ape', 'aiff']

export const localTrackId = (realPath: string): string => `file:${createHash('sha1').update(realPath).digest('hex').slice(0, 16)}`

/** Build track info for audio files picked through the file dialog. Files that aren't readable audio are skipped. */
export async function importLocalFiles(
  paths: string[],
  probe: (file: string) => Promise<Probe | null>
): Promise<{ tracks: TrackInfo[]; skipped: string[] }> {
  const tracks: TrackInfo[] = []
  const skipped: string[] = []
  for (const p of paths) {
    try {
      const real = realpathSync(p)
      const ext = extname(real).slice(1).toLowerCase()
      if (!statSync(real).isFile() || !AUDIO_EXTENSIONS.includes(ext)) throw new Error('unsupported')
      const meta = await probe(real)
      if (meta && !meta.hasAudio) throw new Error('no audio')
      const id = localTrackId(real)
      tracks.push({
        id, source: 'local', sourceId: id.slice(5),
        title: sanitizeText(meta?.title, 200) || sanitizeText(basename(real, extname(real)).replace(/_/g, ' '), 200) || 'Untitled',
        channel: sanitizeText(meta?.artist, 120) || 'Local file',
        channelId: null,
        durationSec: sanitizeDuration(meta?.durationSec), thumbnail: null, url: null, localPath: real,
        license: null, downloadPolicy: 'denied', policyReason: 'Already stored on this computer.'
      })
    } catch {
      skipped.push(basename(p))
    }
  }
  return { tracks, skipped }
}
