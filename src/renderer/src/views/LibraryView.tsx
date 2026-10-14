import { FilePlus2, HardDriveDownload, Library, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { LibraryFilter } from '@shared/types'
import { Button } from '@/components/ui/button'
import { PlayAllButton, TrackList } from '@/components/TrackList'
import { EmptyState, ViewShell } from '@/components/ViewShell'
import { useLoad } from '@/hooks/useTracks'
import { formatBytes, plural } from '@/lib/format'
import { cn } from '@/lib/utils'
import { act, useStore } from '@/store'

const FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'offline', label: 'Saved offline' },
  { id: 'local', label: 'Your files' }
]

export function LibraryView() {
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const list = useLoad(() => window.player.library(filter), [filter])
  const stats = useLoad(() => window.player.cacheStats(), [])
  const openDialog = useStore((s) => s.openDialog)
  const tracks = list.data ?? []

  const addFiles = async (): Promise<void> => {
    const added = await act(window.player.importLocalFiles())
    if (added?.length) {
      setFilter('local')
      useStore.getState().toast({ kind: 'info', message: `Added ${plural(added.length, 'file')}.` })
    }
  }

  const clearOffline = (): void =>
    openDialog({
      kind: 'confirm', title: 'Remove all offline copies?', action: 'Remove copies',
      body: `This frees ${formatBytes(stats.data?.bytes ?? 0)}. Your library, favorites and playlists stay, and tracks will stream again.`,
      onConfirm: async () => {
        await window.player.clearCache()
      }
    })

  return (
    <ViewShell
      title="Library"
      subtitle={list.data ? plural(tracks.length, 'track') : undefined}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => void addFiles()}>
            <FilePlus2 /> Add files
          </Button>
          <PlayAllButton tracks={tracks} />
        </>
      }
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div role="tablist" aria-label="Filter library" className="flex gap-1 rounded-lg bg-card p-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn('rounded-md px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground', filter === f.id && 'bg-accent text-foreground')}
            >
              {f.label}
            </button>
          ))}
        </div>
        {filter === 'offline' && stats.data && stats.data.count > 0 && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="tnum">
              {plural(stats.data.count, 'track')} · {formatBytes(stats.data.bytes)}
            </span>
            <Button variant="ghost" size="sm" onClick={clearOffline}>
              <Trash2 /> Remove all
            </Button>
          </div>
        )}
      </div>

      {list.error && <p role="alert" className="text-sm text-destructive">{list.error}</p>}

      {!list.loading && tracks.length === 0 && !list.error && (
        filter === 'offline' ? (
          <EmptyState icon={<HardDriveDownload />} title="Nothing saved offline yet">
            Creative Commons tracks are saved automatically after you play them twice. Others stream only, because YouTube doesn’t allow saving them.
          </EmptyState>
        ) : filter === 'local' ? (
          <EmptyState icon={<FilePlus2 />} title="No files added" action={<Button size="sm" onClick={() => void addFiles()}><FilePlus2 /> Add files</Button>}>
            Add MP3, FLAC, Ogg, M4A or WAV files from your computer.
          </EmptyState>
        ) : (
          <EmptyState icon={<Library />} title="Your library is empty">
            Tracks you play, favorite or add to a playlist appear here, along with any files you add.
          </EmptyState>
        )
      )}

      <TrackList
        tracks={tracks}
      />
    </ViewShell>
  )
}
