import { AlertCircle, Link2, Loader2, Search } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { EmptyState, ViewShell } from '@/components/ViewShell'
import { CollectionHeader } from '@/components/CollectionHeader'
import { TrackList } from '@/components/TrackList'
import { useLoad } from '@/hooks/useTracks'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'

export const SEARCH_INPUT_ID = 'search-input'

export function SearchView() {
  const search = useStore((s) => s.search)
  const setInput = useStore((s) => s.setSearchInput)
  const setCc = useStore((s) => s.setCreativeCommons)
  const runSearch = useStore((s) => s.runSearch)
  const ref = useRef<HTMLInputElement>(null)
  const recent = useLoad(() => window.player.recent(12), [])

  useEffect(() => ref.current?.focus(), [])

  const showRecent = search.status === 'idle' && recent.data && recent.data.length > 0

  return (
    <ViewShell title="Search">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void runSearch()
        }}
        className="mb-6 flex flex-col gap-3"
      >
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id={SEARCH_INPUT_ID}
            ref={ref}
            value={search.input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search YouTube, or paste a video, playlist or channel link"
            aria-label="Search YouTube or paste a video, playlist or channel link"
            autoComplete="off"
            spellCheck={false}
            className="h-12 rounded-xl bg-card pr-24 pl-10 text-base"
          />
          <Button type="submit" size="sm" disabled={!search.input.trim() || search.status === 'loading'} className="absolute top-1/2 right-2 -translate-y-1/2">
            {search.status === 'loading' ? <Loader2 className="animate-spin" /> : null}
            {search.input.trim() && /^(https?:\/\/|www\.|youtu)/i.test(search.input.trim()) ? 'Open' : 'Search'}
          </Button>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground select-none">
              <input
                type="checkbox"
                checked={search.creativeCommons}
                onChange={(e) => setCc(e.target.checked)}
                className="size-4 accent-[var(--disk)]"
              />
              <span className={cn(search.creativeCommons && 'text-foreground')}>Creative Commons only</span>
            </label>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">
            YouTube allows saving only Creative Commons videos. Those get an offline copy after two plays. Everything else streams.
          </TooltipContent>
        </Tooltip>
      </form>

      {search.status === 'loading' && <Skeleton />}

      {search.status === 'error' && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{search.mode === 'link' ? 'Couldn’t open that link' : 'Search didn’t work'}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{search.error}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void runSearch()}>
            Try again
          </Button>
        </div>
      )}

      {search.status === 'done' &&
        (search.results.length === 0 ? (
          <EmptyState icon={<Search />} title="Nothing found">
            {search.creativeCommons ? 'Try different words, or turn off “Creative Commons only”.' : 'Try different words, or paste a YouTube link.'}
          </EmptyState>
        ) : (
          <>
            {search.link && <CollectionHeader link={search.link} tracks={search.results} />}
            {search.mode === 'link' && !search.link && (
              <p className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                <Link2 className="size-4" aria-hidden /> From your link
              </p>
            )}
            <TrackList tracks={search.results} />
          </>
        ))}

      {search.status === 'idle' &&
        (showRecent ? (
          <section aria-labelledby="recent-heading">
            <h2 id="recent-heading" className="font-display mb-2 text-lg font-medium">
              Recently played
            </h2>
            <TrackList tracks={recent.data!} />
          </section>
        ) : (
          !recent.loading && (
            <EmptyState icon={<Search />} title="Find something to play">
              Search for a song, artist or mix, or paste a link to a video, playlist or channel. You can also add music files from your Library.
            </EmptyState>
          )
        ))}
    </ViewShell>
  )
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Searching">
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-1.5">
          <div className="w-8" />
          <div className="aspect-video w-[4.5rem] animate-pulse rounded-md bg-secondary" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-2/3 animate-pulse rounded bg-secondary" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-secondary" />
          </div>
        </div>
      ))}
    </div>
  )
}
