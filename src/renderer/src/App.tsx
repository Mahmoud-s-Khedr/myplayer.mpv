import { useEffect, useState } from 'react'
import { AppDialogs } from '@/components/AppDialogs'
import { PlayerBar } from '@/components/PlayerBar'
import { QueuePanel } from '@/components/QueuePanel'
import { ShortcutsDialog } from '@/components/ShortcutsDialog'
import { Sidebar } from '@/components/Sidebar'
import { Toasts } from '@/components/Toasts'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useShortcuts } from '@/hooks/useShortcuts'
import { useStore } from '@/store'
import { ChannelView } from '@/views/ChannelView'
import { FavoritesView } from '@/views/FavoritesView'
import { HistoryView } from '@/views/HistoryView'
import { LibraryView } from '@/views/LibraryView'
import { PlaylistView } from '@/views/PlaylistView'
import { SearchView } from '@/views/SearchView'

export default function App() {
  const view = useStore((s) => s.view)
  const queueOpen = useStore((s) => s.queueOpen)
  const init = useStore((s) => s.init)
  const [ready, setReady] = useState(false)
  useShortcuts()

  useEffect(() => {
    let off: (() => void) | undefined
    let cancelled = false
    void init().then((unsubscribe) => {
      if (cancelled) return unsubscribe()
      off = unsubscribe
      setReady(true)
    })
    return () => {
      cancelled = true
      off?.()
    }
  }, [init])

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full flex-col">
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="min-w-0 flex-1">
            {ready && (
              <>
                {view.kind === 'search' && <SearchView />}
                {view.kind === 'library' && <LibraryView />}
                {view.kind === 'favorites' && <FavoritesView />}
                {view.kind === 'history' && <HistoryView />}
                {view.kind === 'playlist' && <PlaylistView key={view.id} id={view.id} />}
                {view.kind === 'channel' && <ChannelView key={view.ref} channelRef={view.ref} />}
              </>
            )}
          </main>
          {queueOpen && <QueuePanel />}
        </div>
        <PlayerBar />
      </div>
      <Toasts />
      <AppDialogs />
      <ShortcutsDialog />
    </TooltipProvider>
  )
}
