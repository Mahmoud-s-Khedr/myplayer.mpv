import { AlertCircle, CheckCircle2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed right-4 bottom-[104px] z-50 flex w-[22rem] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex items-start gap-3 rounded-lg border bg-popover p-3 text-sm shadow-lg',
            t.kind === 'error' ? 'border-destructive/50' : 'border-disk/40'
          )}
        >
          {t.kind === 'error' ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-disk" aria-hidden />}
          <p className="min-w-0 flex-1 break-words">{t.message}</p>
          <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
