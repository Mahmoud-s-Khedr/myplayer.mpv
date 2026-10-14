import { Music } from 'lucide-react'
import { useState } from 'react'
import type { Track } from '@shared/types'
import { cn } from '@/lib/utils'

/** Saved tracks keep their cover art on disk, so it still shows offline. */
export function thumbSrc(t: Pick<Track, 'id' | 'localThumb' | 'thumbnail'>): string | null {
  return t.localThumb ? `thumb://t/${encodeURIComponent(t.id)}` : t.thumbnail
}

export function Cover({ track, className }: { track: Pick<Track, 'id' | 'localThumb' | 'thumbnail'> | null; className?: string }) {
  const src = track ? thumbSrc(track) : null
  const [failed, setFailed] = useState<string | null>(null)
  const broken = !src || failed === src
  return (
    <div className={cn('relative shrink-0 overflow-hidden rounded-md bg-secondary', className)}>
      {broken ? (
        <div className="grid size-full place-items-center text-muted-foreground">
          <Music className="size-1/3" aria-hidden />
        </div>
      ) : (
        <img src={src} alt="" draggable={false} loading="lazy" onError={() => setFailed(src)} className="size-full object-cover" />
      )}
    </div>
  )
}
