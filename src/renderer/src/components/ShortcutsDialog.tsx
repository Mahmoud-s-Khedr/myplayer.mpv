import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useStore } from '@/store'

export const SHORTCUTS: [keys: string, action: string][] = [
  ['Space', 'Play or pause'],
  ['← →', 'Seek 5 seconds'],
  ['Shift + ← →', 'Seek 30 seconds'],
  ['N / P', 'Next / previous track'],
  ['+ / −', 'Volume up / down'],
  ['M', 'Mute'],
  ['R', 'Cycle repeat mode'],
  ['F', 'Favorite the current track'],
  ['Q', 'Show or hide the queue'],
  ['/ or Ctrl + K', 'Search'],
  ['1 – 4', 'Search, Library, Favorites, History'],
  ['↑ ↓ then Enter', 'Move through a list and play'],
  ['Alt + ↑ ↓ in queue', 'Reorder the selected queue item'],
  ['Delete in queue', 'Remove the selected queue item'],
  ['?', 'Show these shortcuts']
]

export function ShortcutsDialog() {
  const open = useStore((s) => s.shortcutsOpen)
  const setOpen = useStore((s) => s.setShortcutsOpen)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts work anywhere except while typing in a text box.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={keys} className="contents">
              <dt>
                <kbd className="rounded border bg-secondary px-1.5 py-0.5 text-xs">{keys}</kbd>
              </dt>
              <dd className="text-muted-foreground">{action}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
