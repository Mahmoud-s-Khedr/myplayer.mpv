import { FileAudio, Heart, HardDriveDownload, ListEnd, Loader2, Play } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Track } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatBytes, formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { act, useStore } from '@/store'
import { Cover } from './Cover'
import { Equalizer } from './Equalizer'
import { TrackMenu } from './TrackMenu'

function Badge({ track }: { track: Track }) {
  if (track.cache === 'ready') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1 text-xs text-disk" aria-label="Saved for offline listening">
            <HardDriveDownload className="size-3.5" aria-hidden />
            <span className="tnum hidden xl:inline">{formatBytes(track.cacheBytes)}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>Saved on this computer. Plays offline.</TooltipContent>
      </Tooltip>
    )
  }
  if (track.cache === 'downloading') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-disk" aria-label="Saving for offline listening">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          </span>
        </TooltipTrigger>
        <TooltipContent>Saving for offline listening…</TooltipContent>
      </Tooltip>
    )
  }
  if (track.source === 'local') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-muted-foreground" aria-label="Local file">
            <FileAudio className="size-3.5" aria-hidden />
          </span>
        </TooltipTrigger>
        <TooltipContent>File on this computer</TooltipContent>
      </Tooltip>
    )
  }
  if (track.downloadPolicy === 'allowed') {
    const left = Math.max(0, 2 - track.qualifiedPlays)
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="rounded border border-disk/40 px-1 text-[10px] leading-4 font-semibold text-disk">CC</span>
        </TooltipTrigger>
        <TooltipContent>
          Creative Commons. {left > 0 ? `Saved offline after ${left} more ${left === 1 ? 'play' : 'plays'}.` : 'Will be saved offline.'}
        </TooltipContent>
      </Tooltip>
    )
  }
  return null
}

interface Props {
  track: Track
  index: number
  onPlay: () => void
  extraMenu?: ReactNode
  /** Right-aligned detail instead of the duration, e.g. when it was played. */
  detail?: string
  /** Set false to stop this row from showing the now-playing state (e.g. repeated rows in history). */
  markCurrent?: boolean
}

export function TrackRow({ track, index, onPlay, extraMenu, detail, markCurrent = true }: Props) {
  const isCurrent = useStore((s) => markCurrent && s.queue.items[s.queue.index]?.track.id === track.id)
  const playing = useStore((s) => s.player.status === 'playing')

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter') {
      e.preventDefault()
      onPlay()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const sib = e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling
      if (sib instanceof HTMLElement) sib.focus()
    }
  }

  return (
    <div
      role="row"
      tabIndex={0}
      aria-label={`${track.title} by ${track.channel}${isCurrent ? ', now playing' : ''}`}
      onKeyDown={onKey}
      onDoubleClick={onPlay}
      className={cn(
        'group grid grid-cols-[2rem_4.5rem_minmax(0,1fr)_auto_auto] items-center gap-x-3 rounded-lg px-2 py-1.5 outline-offset-[-2px] hover:bg-accent/60 focus-visible:bg-accent/60',
        isCurrent && 'bg-accent/40'
      )}
    >
      <div className="grid place-items-center text-xs text-muted-foreground tnum">
        {isCurrent ? (
          <Equalizer playing={playing} />
        ) : (
          <>
            <span className="group-hover:hidden group-focus-within:hidden">{index + 1}</span>
            <button
              type="button"
              onClick={onPlay}
              aria-label={`Play ${track.title}`}
              className="hidden size-7 place-items-center rounded-full text-foreground hover:text-primary group-hover:grid group-focus-within:grid"
            >
              <Play className="size-4 fill-current" />
            </button>
          </>
        )}
      </div>
      <Cover track={track} className="aspect-video w-[4.5rem]" />
      <div className="min-w-0">
        <div className={cn('truncate font-medium', isCurrent && 'text-primary')}>{track.title}</div>
        <div className="truncate text-xs text-muted-foreground">{track.channel}</div>
      </div>
      <div className="flex items-center gap-2 pr-1">
        <Badge track={track} />
        <span className="tnum min-w-14 text-right text-xs whitespace-nowrap text-muted-foreground">
          {detail ?? (track.durationSec ? formatTime(track.durationSec) : 'Live')}
        </span>
      </div>
      <div className="flex items-center">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={track.favorite ? `Remove ${track.title} from favorites` : `Add ${track.title} to favorites`}
          aria-pressed={track.favorite}
          onClick={() => void act(window.player.toggleFavorite(track.id))}
          className={cn(track.favorite ? 'text-primary' : 'text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100')}
        >
          <Heart className={cn(track.favorite && 'fill-current')} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Add ${track.title} to queue`}
          onClick={() => void act(window.player.enqueue([track.id], 'end'))}
          className="text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
        >
          <ListEnd />
        </Button>
        <TrackMenu track={track} extra={extraMenu} />
      </div>
    </div>
  )
}
