import type { ReactNode } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'

export function ViewShell({ title, subtitle, actions, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <ScrollArea className="h-full min-w-0">
      <div className="mx-auto max-w-4xl px-8 pt-8 pb-10">
        <header className="mb-6 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display truncate text-3xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
        {children}
      </div>
    </ScrollArea>
  )
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <div className="text-muted-foreground [&_svg]:size-8">{icon}</div>
      <h2 className="font-display text-lg font-medium">{title}</h2>
      {children && <p className="max-w-sm text-sm text-muted-foreground">{children}</p>}
      {action}
    </div>
  )
}
