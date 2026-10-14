import { History, Heart, Keyboard, Library, ListMusic, Plus, Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useStore, type View } from '@/store'
import { createPlaylistWith } from './TrackMenu'

function NavItem({ view, icon, children, count }: { view: View; icon: ReactNode; children: ReactNode; count?: number }) {
  const current = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const active = current.kind === view.kind && (view.kind !== 'playlist' || (current.kind === 'playlist' && current.id === view.id))
  return (
    <button
      type="button"
      onClick={() => setView(view)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground [&_svg]:size-[18px] [&_svg]:shrink-0',
        active && 'bg-accent text-foreground'
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined && <span className="tnum text-xs text-muted-foreground">{count}</span>}
    </button>
  )
}

export function Sidebar() {
  const playlists = useStore((s) => s.playlists)
  const setShortcutsOpen = useStore((s) => s.setShortcutsOpen)
  return (
    <nav aria-label="Main" className="flex w-56 shrink-0 flex-col border-r bg-card/60">
      <div className="font-display px-5 pt-5 pb-4 text-xl font-semibold tracking-tight">MyPlayer</div>
      <div className="flex flex-col gap-0.5 px-2">
        <NavItem view={{ kind: 'search' }} icon={<Search />}>Search</NavItem>
        <NavItem view={{ kind: 'library' }} icon={<Library />}>Library</NavItem>
        <NavItem view={{ kind: 'favorites' }} icon={<Heart />}>Favorites</NavItem>
        <NavItem view={{ kind: 'history' }} icon={<History />}>History</NavItem>
      </div>
      <div className="mt-5 flex items-center justify-between px-5 pb-1">
        <h2 className="text-sm font-medium text-muted-foreground">Playlists</h2>
        <Button variant="ghost" size="icon-xs" aria-label="New playlist" onClick={() => void createPlaylistWith([])}>
          <Plus />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 px-2 pb-2">
          {playlists.length === 0 && (
            <button type="button" onClick={() => void createPlaylistWith([])} className="rounded-lg px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground">
              Create your first playlist
            </button>
          )}
          {playlists.map((p) => (
            <NavItem key={p.id} view={{ kind: 'playlist', id: p.id }} icon={<ListMusic />} count={p.count}>
              {p.name}
            </NavItem>
          ))}
        </div>
      </ScrollArea>
      <div className="border-t p-2">
        <button
          type="button"
          onClick={() => setShortcutsOpen(true)}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground [&_svg]:size-[18px]"
        >
          <Keyboard /> Keyboard shortcuts
        </button>
      </div>
    </nav>
  )
}
