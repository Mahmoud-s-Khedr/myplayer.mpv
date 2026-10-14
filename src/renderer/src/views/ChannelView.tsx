import { AlertCircle, ArrowLeft, ListMusic, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { ChannelPlaylist, ChannelTab, Track } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Cover } from '@/components/Cover'
import { CollectionActions } from '@/components/CollectionHeader'
import { TrackList } from '@/components/TrackList'
import { EmptyState, ViewShell } from '@/components/ViewShell'
import { plural } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'

interface Remote<T> {
  status: 'idle' | 'loading' | 'done' | 'error'
  data: T | null
  error: string | null
}

/**
 * Load something slow from the network (a channel tab, a playlist). Unlike `useLoad` it does not reload when
 * track state changes, because that would re-run yt-dlp on every favorite. Pass `null` to not load yet.
 */
function useRemote<T extends { tracks: Track[] }>(load: (() => Promise<T>) | null, key: string): Remote<T> & { retry: () => void } {
  const revision = useStore((s) => s.revision)
  const [state, setState] = useState<Remote<T>>({ status: 'idle', data: null, error: null })
  const [tick, setTick] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load
  const enabled = load !== null

  useEffect(() => {
    const fn = loadRef.current
    if (!fn) return
    let live = true
    setState({ status: 'loading', data: null, error: null })
    fn()
      .then((data) => live && setState({ status: 'done', data, error: null }))
      .catch((e: unknown) => live && setState({ status: 'error', data: null, error: e instanceof Error ? e.message : 'Couldn’t load this.' }))
    return () => {
      live = false
    }
  }, [key, enabled, tick])

  // Keep favorites and offline badges current without going back to YouTube.
  useEffect(() => {
    const ids = state.data?.tracks.map((t) => t.id) ?? []
    if (ids.length === 0) return
    let live = true
    void window.player
      .tracks(ids)
      .then((fresh) => {
        if (!live) return
        setState((s) => (s.data ? { ...s, data: { ...s.data, tracks: s.data.tracks.map((t) => fresh.find((f) => f.id === t.id) ?? t) } } : s))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision])

  return { ...state, retry: () => setTick((t) => t + 1) }
}

function Status<T>({ remote, retry, what, children }: { remote: Remote<T>; retry: () => void; what: string; children: (data: T) => ReactNode }) {
  if (remote.status === 'error') {
    return (
      <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
        <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Couldn’t open {what}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{remote.error}</p>
        </div>
        <Button variant="outline" size="sm" onClick={retry}>
          Try again
        </Button>
      </div>
    )
  }
  if (remote.status !== 'done' || !remote.data) {
    return (
      <p role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading {what}…
      </p>
    )
  }
  return <>{children(remote.data)}</>
}

const TABS: { id: ChannelTab; label: string }[] = [
  { id: 'videos', label: 'Videos' },
  { id: 'playlists', label: 'Playlists' }
]

function Tabs({ tab, onChange }: { tab: ChannelTab; onChange: (t: ChannelTab) => void }) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = TABS[(TABS.findIndex((t) => t.id === tab) + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id
    onChange(next)
    requestAnimationFrame(() => document.getElementById(`channel-tab-${next}`)?.focus())
  }
  return (
    <div role="tablist" aria-label="Channel sections" onKeyDown={onKey} className="mb-4 flex gap-1 border-b">
      {TABS.map((t) => (
        <button
          key={t.id}
          id={`channel-tab-${t.id}`}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          aria-controls="channel-panel"
          tabIndex={tab === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          className={cn(
            '-mb-px rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground',
            tab === t.id && 'border-primary font-medium text-foreground'
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function PlaylistGrid({ playlists, onOpen }: { playlists: ChannelPlaylist[]; onOpen: (p: ChannelPlaylist) => void }) {
  if (playlists.length === 0) {
    return (
      <EmptyState icon={<ListMusic />} title="No public playlists">
        This channel hasn’t made any playlists. Its uploads are on the Videos tab.
      </EmptyState>
    )
  }
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-4 gap-y-6">
      {playlists.map((p) => (
        <li key={p.id}>
          <button type="button" onClick={() => onOpen(p)} className="group block w-full rounded-lg text-left">
            <Cover
              track={{ id: p.id, localThumb: false, thumbnail: p.thumbnail }}
              className="aspect-square w-full rounded-lg transition-shadow group-hover:ring-2 group-hover:ring-primary/60 group-focus-visible:ring-2 group-focus-visible:ring-primary"
            />
            <span className="mt-2 line-clamp-2 text-sm font-medium group-hover:text-primary">{p.title}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Browse a channel: its latest uploads, and its playlists (each opens in place). */
export function ChannelView({ channelRef }: { channelRef: string }) {
  const closeChannel = useStore((s) => s.closeChannel)
  const [tab, setTab] = useState<ChannelTab>('videos')
  const [seenPlaylists, setSeenPlaylists] = useState(false)
  const [open, setOpen] = useState<ChannelPlaylist | null>(null)

  const videos = useRemote(() => window.player.browseChannel(channelRef, 'videos'), `v:${channelRef}`)
  const lists = useRemote(seenPlaylists ? () => window.player.browseChannel(channelRef, 'playlists') : null, `p:${channelRef}`)
  const opened = useRemote(open ? () => window.player.resolveUrl(`https://www.youtube.com/playlist?list=${open.id}`) : null, `o:${open?.id ?? ''}`)

  const channelName = videos.data?.title ?? lists.data?.title ?? 'Channel'
  const changeTab = (t: ChannelTab): void => {
    setTab(t)
    if (t === 'playlists') setSeenPlaylists(true)
  }

  if (open) {
    const tracks = opened.data?.tracks ?? []
    return (
      <ViewShell
        back={
          <Button variant="ghost" size="sm" onClick={() => setOpen(null)}>
            <ArrowLeft /> Playlists
          </Button>
        }
        title={open.title}
        subtitle={`Playlist from ${channelName}${opened.data ? `, ${opened.data.truncated ? 'first ' : ''}${plural(tracks.length, 'video')}` : ''}`}
        actions={<CollectionActions tracks={tracks} name={open.title} />}
      >
        <Status remote={opened} retry={opened.retry} what="this playlist">
          {(data) => <TrackList tracks={data.tracks} />}
        </Status>
      </ViewShell>
    )
  }

  const vids = videos.data?.tracks ?? []
  return (
    <ViewShell
      back={
        <Button variant="ghost" size="sm" onClick={closeChannel}>
          <ArrowLeft /> Back
        </Button>
      }
      title={channelName}
      subtitle={tab === 'videos' ? (videos.data ? (videos.data.truncated ? `First ${plural(vids.length, 'upload')}` : `Latest ${plural(vids.length, 'upload')}`) : 'Channel') : 'Channel playlists'}
      actions={tab === 'videos' ? <CollectionActions tracks={vids} name={channelName} /> : undefined}
    >
      <Tabs tab={tab} onChange={changeTab} />
      <div role="tabpanel" id="channel-panel" aria-labelledby={`channel-tab-${tab}`}>
        {tab === 'videos' ? (
          <Status remote={videos} retry={videos.retry} what="this channel">
            {(data) => <TrackList tracks={data.tracks} />}
          </Status>
        ) : (
          <Status remote={lists} retry={lists.retry} what="the playlists">
            {(data) => <PlaylistGrid playlists={data.playlists} onOpen={setOpen} />}
          </Status>
        )}
      </div>
    </ViewShell>
  )
}
