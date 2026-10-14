import { ListMusic, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { PlayAllButton, TrackList } from '@/components/TrackList'
import { EmptyState, ViewShell } from '@/components/ViewShell'
import { useLoad } from '@/hooks/useTracks'
import { plural } from '@/lib/format'
import { act, useStore } from '@/store'

export function PlaylistView({ id }: { id: number }) {
  const list = useLoad(() => window.player.playlistTracks(id), [id])
  const playlist = useStore((s) => s.playlists.find((p) => p.id === id))
  const openDialog = useStore((s) => s.openDialog)
  const refresh = useStore((s) => s.refreshPlaylists)
  const setView = useStore((s) => s.setView)
  const entries = list.data ?? []
  const tracks = entries.map((e) => e.track)

  if (!playlist) return <ViewShell title="Playlist not found"><EmptyState icon={<ListMusic />} title="This playlist was deleted" /></ViewShell>

  const rename = (): void =>
    openDialog({
      kind: 'prompt', title: 'Rename playlist', label: 'Name', initial: playlist.name, action: 'Save',
      onSubmit: async (name) => {
        await window.player.renamePlaylist(id, name)
        await refresh()
      }
    })

  const remove = (): void =>
    openDialog({
      kind: 'confirm', title: `Delete “${playlist.name}”?`, action: 'Delete playlist',
      body: 'The tracks stay in your library. Only the playlist is removed.',
      onConfirm: async () => {
        await window.player.deletePlaylist(id)
        setView({ kind: 'library' })
        await refresh()
      }
    })

  return (
    <ViewShell
      title={playlist.name}
      subtitle={plural(entries.length, 'track')}
      actions={
        <>
          <Button variant="ghost" size="icon-sm" aria-label="Rename playlist" onClick={rename}><Pencil /></Button>
          <Button variant="ghost" size="icon-sm" aria-label="Delete playlist" onClick={remove}><Trash2 /></Button>
          <PlayAllButton tracks={tracks} />
        </>
      }
    >
      {list.error && <p role="alert" className="text-sm text-destructive">{list.error}</p>}
      {!list.loading && entries.length === 0 && !list.error ? (
        <EmptyState icon={<ListMusic />} title="This playlist is empty">
          Use the ⋯ menu on any track and choose “Add to playlist”.
        </EmptyState>
      ) : (
        <TrackList
          tracks={tracks}
          rowKey={(_, i) => entries[i].entryId}
          extraMenu={(_, i) => (
            <DropdownMenuItem
              onSelect={() =>
                void act(window.player.removeFromPlaylist(id, entries[i].entryId).then(async () => {
                  useStore.setState((s) => ({ revision: s.revision + 1 }))
                  await refresh()
                }))
              }
            >
              <X /> Remove from playlist
            </DropdownMenuItem>
          )}
        />
      )}
    </ViewShell>
  )
}
