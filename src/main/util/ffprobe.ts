import { ExecError, run } from './exec'

export interface Probe {
  durationSec: number | null
  hasAudio: boolean
  title: string | null
  artist: string | null
}

/**
 * Inspect an audio file with ffprobe. Returns null when ffprobe isn't installed (callers degrade gracefully)
 * and throws when the file can't be parsed as media at all.
 */
export async function probeAudio(file: string): Promise<Probe | null> {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '--', file], { timeoutMs: 15_000 })
    const j = JSON.parse(stdout) as {
      format?: { duration?: string; tags?: Record<string, string> }
      streams?: { codec_type?: string }[]
    }
    const tags = Object.fromEntries(Object.entries(j.format?.tags ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
    const d = Number(j.format?.duration)
    return {
      durationSec: Number.isFinite(d) && d > 0 ? d : null,
      hasAudio: (j.streams ?? []).some((s) => s.codec_type === 'audio'),
      title: tags['title'] ?? null,
      artist: tags['artist'] ?? tags['album_artist'] ?? null
    }
  } catch (err) {
    if (err instanceof ExecError && err.message.includes('not installed')) return null
    throw new Error('Not a readable audio file')
  }
}
