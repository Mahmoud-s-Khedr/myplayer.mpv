import { ListEnd, ListMusic, ListPlus, Play } from 'lucide-react'
import type { Track } from '@shared/types'
import { Button } from '@/components/ui/button'
import { plural } from '@/lib/format'
import { act, useStore, type SearchState } from '@/store'
import { Cover } from './Cover'
import { playTracks } from './TrackList'
import { createPlaylistWith } from './TrackMenu'

/** Play, queue or keep every track of a playlist or a channel's uploads. */
export function CollectionActions({ tracks, name, size = 'sm' }: { tracks: Track[]; name: string; size?: 'sm' | 'default' }) {
  const toast = useStore((s) => s.toast)
  const count = tracks.length
  const enqueueAll = (): void =>
    void act(window.player.enqueue(tracks.map((t) => t.id), 'end').then(() => toast({ kind: 'info', message: `Added ${plural(count, 'track')} to the queue.` })))
  return (
    <>
      <Button size={size} disabled={count === 0} onClick={() => playTracks(tracks, 0)}>
        <Play className="fill-current" /> Play all
      </Button>
      <Button size={size} variant="outline" disabled={count === 0} onClick={enqueueAll}>
        <ListEnd /> Add to queue
      </Button>
      <Button size={size} variant="outline" disabled={count === 0} onClick={() => void createPlaylistWith(tracks.map((t) => t.id), name.slice(0, 80))}>
        <ListPlus /> Save as playlist
      </Button>
    </>
  )
}

/** Sits above the results when a pasted link was a whole YouTube playlist. */
export function CollectionHeader({ link, tracks }: { link: NonNullable<SearchState['link']>; tracks: Track[] }) {
  const count = tracks.length
  return (
    <section aria-label="Playlist" className="mb-4 flex items-center gap-4 rounded-xl border bg-card p-4">
      <Cover track={tracks[0] ?? null} className="size-24 rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ListMusic className="size-4" aria-hidden /> YouTube playlist
        </p>
        <h2 className="font-display mt-0.5 truncate text-2xl font-semibold tracking-tight">{link.title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{link.truncated ? `First ${plural(count, 'video')}` : plural(count, 'video')}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CollectionActions tracks={tracks} name={link.title} />
        </div>
      </div>
    </section>
  )
}
