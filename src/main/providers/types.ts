import type { TrackInfo } from '@shared/types'

export interface ResolvedStream {
  /** Fresh metadata, including the download policy decided from the source's own license data. */
  info: TrackInfo
  streamUrl: string
  headers: Record<string, string>
}

export interface DownloadHandle {
  /** Resolves with the downloaded file once the provider is finished writing it. */
  done: Promise<string>
  cancel(): void
}

/**
 * Everything source-specific lives behind this interface so yt-dlp can be replaced
 * (another extractor, an API, a different site) without touching playback or caching.
 */
export interface MediaProvider {
  readonly id: 'youtube'
  search(query: string, opts: { creativeCommons: boolean; limit: number }, signal?: AbortSignal): Promise<TrackInfo[]>
  /** Look up a pasted URL. Throws a user-readable error for anything that isn't a single supported track. */
  lookup(url: string, signal?: AbortSignal): Promise<TrackInfo>
  resolve(sourceId: string, signal?: AbortSignal): Promise<ResolvedStream>
  /** Download the audio stream only, into `dir`. */
  download(sourceId: string, dir: string, onProgress: (fraction: number) => void): DownloadHandle
}
