import { GripVertical, ListMusic, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatTime, plural } from '@/lib/format'
import { cn } from '@/lib/utils'
import { act, useStore } from '@/store'
import { Cover } from './Cover'
import { Equalizer } from './Equalizer'

export function QueuePanel() {
  const queue = useStore((s) => s.queue)
  const playing = useStore((s) => s.player.status === 'playing')
  const [dragUid, setDragUid] = useState<string | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const dragFrom = queue.items.findIndex((i) => i.uid === dragUid)
  const upcoming = queue.items.slice(Math.max(queue.index, 0) + 1)
  const remaining = upcoming.reduce((sum, i) => sum + (i.track.durationSec ?? 0), 0)

  const drop = (): void => {
    if (dragUid !== null && overIndex !== null) void act(window.player.moveInQueue(dragUid, overIndex))
    setDragUid(null)
    setOverIndex(null)
  }

  const onKey = (e: React.KeyboardEvent<HTMLLIElement>, uid: string, i: number): void => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter') void act(window.player.playQueueItem(uid))
    else if (e.key === 'Delete' || e.key === 'Backspace') void act(window.player.removeFromQueue(uid))
    else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      void act(window.player.moveInQueue(uid, i + (e.key === 'ArrowUp' ? -1 : 1)))
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const sib = e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling
      if (sib instanceof HTMLElement) sib.focus()
    }
  }

  return (
    <aside aria-label="Queue" className="flex w-80 shrink-0 flex-col border-l bg-card/60">
      <header className="flex items-center justify-between px-4 pt-5 pb-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Queue</h2>
          <p className="tnum text-xs text-muted-foreground">
            {queue.items.length === 0 ? 'Empty' : `${plural(upcoming.length, 'track')} up next${remaining ? `, ${formatTime(remaining)}` : ''}`}
          </p>
        </div>
        <Button variant="ghost" size="sm" disabled={queue.items.length === 0} onClick={() => void act(window.player.clearQueue())}>
          Clear
        </Button>
      </header>
      {queue.items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 pb-16 text-center text-muted-foreground">
          <ListMusic className="size-7" aria-hidden />
          <p className="text-sm">Play a track, or choose “Add to queue” on any track, and it lands here.</p>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <ol className="flex flex-col px-2 pb-3" onDragLeave={(e) => e.currentTarget === e.target && setOverIndex(null)}>
            {queue.items.map((item, i) => {
              const current = i === queue.index
              return (
                <li
                  key={item.uid}
                  tabIndex={0}
                  draggable
                  aria-current={current ? 'true' : undefined}
                  onKeyDown={(e) => onKey(e, item.uid, i)}
                  onDragStart={(e) => {
                    setDragUid(item.uid)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={(e) => {
                    if (dragUid === null) return
                    e.preventDefault()
                    setOverIndex(i)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    drop()
                  }}
                  onDragEnd={() => {
                    setDragUid(null)
                    setOverIndex(null)
                  }}
                  onDoubleClick={() => void act(window.player.playQueueItem(item.uid))}
                  className={cn(
                    'group relative flex items-center gap-2 rounded-lg px-1 py-1.5 outline-offset-[-2px] hover:bg-accent/60 focus-visible:bg-accent/60',
                    current && 'bg-accent/40',
                    dragUid === item.uid && 'opacity-40',
                    overIndex === i && dragUid !== item.uid && (dragFrom > i ? 'before:absolute before:inset-x-2 before:-top-px before:h-0.5 before:rounded before:bg-primary' : 'after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded after:bg-primary')
                  )}
                >
                  <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground/50 group-hover:text-muted-foreground" aria-hidden />
                  <button type="button" onClick={() => void act(window.player.playQueueItem(item.uid))} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" aria-label={`Play ${item.track.title}`} tabIndex={-1}>
                    <div className="relative">
                      <Cover track={item.track} className="aspect-video w-14" />
                      {current && (
                        <div className="absolute inset-0 grid place-items-center rounded-md bg-black/55">
                          <Equalizer playing={playing} />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className={cn('truncate text-sm font-medium', current && 'text-primary')}>{item.track.title}</div>
                      <div className="truncate text-xs text-muted-foreground">{item.track.channel}</div>
                    </div>
                  </button>
                  <span className="tnum text-xs text-muted-foreground group-hover:hidden group-focus-within:hidden">{item.track.durationSec ? formatTime(item.track.durationSec) : ''}</span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${item.track.title} from queue`}
                    onClick={() => void act(window.player.removeFromQueue(item.uid))}
                    className="hidden text-muted-foreground group-hover:inline-flex group-focus-within:inline-flex"
                  >
                    <X />
                  </Button>
                </li>
              )
            })}
            <li
              aria-hidden
              className="h-6"
              onDragOver={(e) => {
                if (dragUid === null) return
                e.preventDefault()
                setOverIndex(queue.items.length - 1)
              }}
              onDrop={(e) => {
                e.preventDefault()
                drop()
              }}
            />
          </ol>
        </ScrollArea>
      )}
    </aside>
  )
}
