import type { ChannelPlaylist, ChannelTab, TrackInfo } from '@shared/types'

export interface ResolvedStream {
  /** Fresh metadata, including the download policy decided from the source's own license data. */
  info: TrackInfo
  streamUrl: string
  headers: Record<string, string>
}

/** What a pasted link turned out to be, with its tracks in source order. */
export interface LinkInfo {
  kind: 'track' | 'playlist' | 'channel'
  title: string
  tracks: TrackInfo[]
  /** True when the source has more tracks than we loaded. */
  truncated: boolean
  /** For channels: the reference `browseChannel` accepts. */
  channelRef: string | null
}

export interface ChannelInfo {
  title: string
  tab: ChannelTab
  tracks: TrackInfo[]
  playlists: ChannelPlaylist[]
  truncated: boolean
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
  /** Look up a pasted URL: a single track, a playlist or a channel. Throws a user-readable error for anything else. */
  lookupLink(url: string, signal?: AbortSignal): Promise<LinkInfo>
  /** One tab of a channel. `ref` comes from `LinkInfo.channelRef` or a track's channel id. */
  browseChannel(ref: string, tab: ChannelTab, signal?: AbortSignal): Promise<ChannelInfo>
  resolve(sourceId: string, signal?: AbortSignal): Promise<ResolvedStream>
  /** Download the audio stream only, into `dir`. */
  download(sourceId: string, dir: string, onProgress: (fraction: number) => void): DownloadHandle
}
