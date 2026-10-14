import { cn } from '@/lib/utils'

export function Equalizer({ playing }: { playing: boolean }) {
  return (
    <span className={cn('flex h-3.5 items-end gap-[2px]', !playing && 'eq-paused')} aria-hidden>
      <i className="eq-bar" />
      <i className="eq-bar" />
      <i className="eq-bar" />
    </span>
  )
}
