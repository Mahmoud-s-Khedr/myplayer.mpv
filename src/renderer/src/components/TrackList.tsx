import { Play } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Track } from '@shared/types'
import { Button } from '@/components/ui/button'
import { act } from '@/store'
import { TrackRow } from './TrackRow'

export function playTracks(tracks: Track[], index: number): void {
  void act(window.player.playNow(tracks.map((t) => t.id), index))
}

interface Props {
  tracks: Track[]
  extraMenu?: (track: Track, index: number) => ReactNode
  detail?: (track: Track, index: number) => string | undefined
  /** Stable React key per row; defaults to the track id. */
  rowKey?: (track: Track, index: number) => string | number
  markCurrent?: (track: Track, index: number) => boolean
}

export function TrackList({ tracks, extraMenu, detail, rowKey, markCurrent }: Props) {
  return (
    <div role="table" aria-label="Tracks" className="flex flex-col gap-0.5">
      {tracks.map((t, i) => (
        <TrackRow
          key={rowKey ? rowKey(t, i) : t.id}
          track={t}
          index={i}
          onPlay={() => playTracks(tracks, i)}
          extraMenu={extraMenu?.(t, i)}
          detail={detail?.(t, i)}
          markCurrent={markCurrent ? markCurrent(t, i) : true}
        />
      ))}
    </div>
  )
}

export function PlayAllButton({ tracks }: { tracks: Track[] }) {
  return (
    <Button size="sm" disabled={tracks.length === 0} onClick={() => playTracks(tracks, 0)}>
      <Play className="fill-current" /> Play all
    </Button>
  )
}
