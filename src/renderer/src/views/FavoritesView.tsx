import { Heart } from 'lucide-react'
import { PlayAllButton, TrackList } from '@/components/TrackList'
import { EmptyState, ViewShell } from '@/components/ViewShell'
import { useLoad } from '@/hooks/useTracks'
import { plural } from '@/lib/format'

export function FavoritesView() {
  const list = useLoad(() => window.player.favorites(), [])
  const tracks = list.data ?? []
  return (
    <ViewShell title="Favorites" subtitle={list.data ? plural(tracks.length, 'track') : undefined} actions={<PlayAllButton tracks={tracks} />}>
      {list.error && <p role="alert" className="text-sm text-destructive">{list.error}</p>}
      {!list.loading && tracks.length === 0 && !list.error ? (
        <EmptyState icon={<Heart />} title="No favorites yet">
          Select the heart on any track to keep it here.
        </EmptyState>
      ) : (
        <TrackList tracks={tracks} />
      )}
    </ViewShell>
  )
}
