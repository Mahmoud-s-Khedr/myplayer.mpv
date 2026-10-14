import { HardDrive, Heart, ListEnd, ListPlus, ListStart, MoreHorizontal, Plus, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Track } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { act, useStore } from '@/store'

export async function createPlaylistWith(trackIds: string[], initialName = ''): Promise<void> {
  useStore.getState().openDialog({
    kind: 'prompt', title: 'New playlist', label: 'Name', initial: initialName, action: 'Create playlist',
    onSubmit: async (name) => {
      const created = await window.player.createPlaylist(name)
      if (trackIds.length) await window.player.addToPlaylist(created.id, trackIds)
      await useStore.getState().refreshPlaylists()
      useStore.getState().toast({ kind: 'info', message: `Created “${created.name}”.` })
    }
  })
}

export function addToPlaylist(playlistId: number, name: string, trackIds: string[]): Promise<unknown> {
  return act(
    window.player.addToPlaylist(playlistId, trackIds).then(async () => {
      await useStore.getState().refreshPlaylists()
      useStore.getState().toast({ kind: 'info', message: `Added to “${name}”.` })
    })
  )
}

export function TrackMenu({ track, extra }: { track: Track; extra?: ReactNode }) {
  const playlists = useStore((s) => s.playlists)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${track.title}`} className="text-muted-foreground hover:text-foreground">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => void act(window.player.enqueue([track.id], 'next'))}>
          <ListStart /> Play next
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void act(window.player.enqueue([track.id], 'end'))}>
          <ListEnd /> Add to queue
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ListPlus /> Add to playlist
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            {playlists.map((p) => (
              <DropdownMenuItem key={p.id} onSelect={() => void addToPlaylist(p.id, p.name, [track.id])}>
                <span className="truncate">{p.name}</span>
              </DropdownMenuItem>
            ))}
            {playlists.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => void createPlaylistWith([track.id])}>
              <Plus /> New playlist…
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {track.channelId && (
          <DropdownMenuItem onSelect={() => useStore.getState().openChannel(`channel/${track.channelId}`)}>
            <UserRound /> Go to channel
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => void act(window.player.toggleFavorite(track.id))}>
          <Heart /> {track.favorite ? 'Remove from favorites' : 'Add to favorites'}
        </DropdownMenuItem>
        {track.cache !== 'none' && (
          <DropdownMenuItem onSelect={() => void act(window.player.deleteCached(track.id))}>
            <HardDrive /> {track.cache === 'ready' ? 'Remove offline copy' : 'Cancel saving'}
          </DropdownMenuItem>
        )}
        {extra && <DropdownMenuSeparator />}
        {extra}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
