import { Heart, ListMusic, Loader2, Pause, Play, Repeat, Repeat1, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useState } from 'react'
import type { PlaySource, RepeatMode } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { act, currentTrack, useStore } from '@/store'
import { Cover } from './Cover'

const SOURCE_LABEL: Record<PlaySource, { label: string; tip: string; tone: string }> = {
  network: { label: 'Streaming', tip: 'Playing over the internet', tone: 'text-lamp' },
  cache: { label: 'Offline copy', tip: 'Playing the copy saved on this computer', tone: 'text-disk' },
  local: { label: 'Your file', tip: 'Playing a file from this computer', tone: 'text-muted-foreground' }
}

const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' }
const REPEAT_LABEL: Record<RepeatMode, string> = { off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' }

export function PlayerBar() {
  const player = useStore((s) => s.player)
  const queue = useStore((s) => s.queue)
  const queueOpen = useStore((s) => s.queueOpen)
  const toggleQueue = useStore((s) => s.toggleQueue)
  const track = useStore(currentTrack)
  const [drag, setDrag] = useState<number | null>(null)

  const duration = player.durationSec || track?.durationSec || 0
  const live = !!track && player.status !== 'idle' && !duration
  const position = Math.min(drag ?? player.positionSec, duration || Infinity)
  const loading = player.status === 'loading'
  const playing = player.status === 'playing'
  const canSeek = !!track && duration > 0 && player.status !== 'loading' && player.status !== 'error'
  const source = player.source ? SOURCE_LABEL[player.source] : null
  const VolumeIcon = player.muted || player.volume === 0 ? VolumeX : player.volume < 50 ? Volume1 : Volume2

  return (
    <footer className="relative border-t bg-card">
      <Slider
        aria-label="Seek"
        aria-valuetext={`${formatTime(position)} of ${formatTime(duration)}`}
        value={[position]}
        min={0}
        max={duration || 1}
        step={0.5}
        disabled={!canSeek}
        onValueChange={(v) => setDrag(v[0])}
        onValueCommit={(v) => {
          void act(window.player.seek(v[0]))
          setDrag(null)
        }}
        className="absolute inset-x-0 -top-2 h-4 cursor-pointer"
      />
      <div className="grid h-[88px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Cover track={track} className="size-14" />
          <div className="min-w-0">
            {track ? (
              <>
                <div className="font-display truncate text-[15px] font-semibold" title={track.title}>{track.title}</div>
                {player.error ? (
                  <div role="alert" className="truncate text-xs text-destructive" title={player.error}>{player.error}</div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{track.channel}</span>
                    {loading ? (
                      <span className="shrink-0">Loading…</span>
                    ) : source ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className={cn('shrink-0 font-medium', source.tone)}>{source.label}</span>
                        </TooltipTrigger>
                        <TooltipContent>{source.tip}</TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">Nothing playing</div>
            )}
          </div>
          {track && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={track.favorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={track.favorite}
              onClick={() => void act(window.player.toggleFavorite(track.id))}
              className={cn('shrink-0', track.favorite ? 'text-primary' : 'text-muted-foreground')}
            >
              <Heart className={cn(track.favorite && 'fill-current')} />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="tnum w-12 text-right text-sm text-muted-foreground" aria-hidden>{track ? formatTime(position) : ''}</span>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Previous track" disabled={!track} onClick={() => void act(window.player.previous())}>
                  <SkipBack className="fill-current" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Previous (P)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-lg"
                  aria-label={playing ? 'Pause' : 'Play'}
                  disabled={!track}
                  onClick={() => void act(window.player.togglePause())}
                  className="size-11 rounded-full shadow-[0_0_18px_rgb(255_178_63/0.25)]"
                >
                  {loading ? <Loader2 className="animate-spin" /> : playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{playing ? 'Pause' : 'Play'} (Space)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Next track" disabled={!track} onClick={() => void act(window.player.next())}>
                  <SkipForward className="fill-current" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Next (N)</TooltipContent>
            </Tooltip>
          </div>
          <span className="tnum w-12 text-sm text-muted-foreground" aria-hidden>{live ? 'Live' : track ? formatTime(duration) : ''}</span>
        </div>

        <div className="flex items-center justify-end gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={REPEAT_LABEL[queue.repeat]}
                aria-pressed={queue.repeat !== 'off'}
                onClick={() => void act(window.player.setRepeat(NEXT_REPEAT[queue.repeat]))}
                className={cn(queue.repeat === 'off' ? 'text-muted-foreground' : 'text-primary')}
              >
                {queue.repeat === 'one' ? <Repeat1 /> : <Repeat />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{REPEAT_LABEL[queue.repeat]} (R)</TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="icon-sm" aria-label={player.muted ? 'Unmute' : 'Mute'} onClick={() => void act(window.player.toggleMute())} className="text-muted-foreground">
            <VolumeIcon />
          </Button>
          <Slider
            aria-label="Volume"
            value={[player.muted ? 0 : player.volume]}
            max={100}
            step={1}
            onValueChange={(v) => void act(window.player.setVolume(v[0]))}
            className="mr-2 h-4 w-24 cursor-pointer"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Queue"
                aria-pressed={queueOpen}
                onClick={toggleQueue}
                className={cn('gap-1.5', queueOpen ? 'bg-accent text-foreground' : 'text-muted-foreground')}
              >
                <ListMusic />
                <span className="tnum text-xs">{queue.items.length}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Queue (Q)</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </footer>
  )
}
