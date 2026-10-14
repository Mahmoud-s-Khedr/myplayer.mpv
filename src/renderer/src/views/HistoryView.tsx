import { History as HistoryIcon, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TrackList } from '@/components/TrackList'
import { EmptyState, ViewShell } from '@/components/ViewShell'
import { useLoad } from '@/hooks/useTracks'
import { formatWhen } from '@/lib/format'
import { useStore } from '@/store'

export function HistoryView() {
  const list = useLoad(() => window.player.history(300), [])
  const openDialog = useStore((s) => s.openDialog)
  const entries = list.data ?? []
  const tracks = entries.map((e) => e.track)

  const clear = (): void =>
    openDialog({
      kind: 'confirm', title: 'Clear listening history?', action: 'Clear history',
      body: 'This removes the list of what you played and when. Favorites, playlists and offline copies stay.',
      onConfirm: async () => {
        await window.player.clearHistory()
        useStore.setState((s) => ({ revision: s.revision + 1 }))
      }
    })

  return (
    <ViewShell
      title="History"
      subtitle="Everything you listened to, newest first"
      actions={
        <Button variant="outline" size="sm" disabled={entries.length === 0} onClick={clear}>
          <Trash2 /> Clear history
        </Button>
      }
    >
      {list.error && <p role="alert" className="text-sm text-destructive">{list.error}</p>}
      {!list.loading && entries.length === 0 && !list.error ? (
        <EmptyState icon={<HistoryIcon />} title="Nothing played yet">
          Tracks you listen to for more than a few seconds show up here.
        </EmptyState>
      ) : (
        <TrackList
          tracks={tracks}
          rowKey={(_, i) => entries[i].id} detail={(_, i) => formatWhen(entries[i].startedAt)}
          markCurrent={(t, i) => entries.findIndex((e) => e.track.id === t.id) === i}
        />
      )}
    </ViewShell>
  )
}
