import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useStore } from '@/store'

/** One host for the app's prompt and confirm dialogs, so menus can open them without unmounting mid-action. */
export function AppDialogs() {
  const dialog = useStore((s) => s.dialog)
  const open = useStore((s) => s.openDialog)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setValue(dialog?.kind === 'prompt' ? dialog.initial : '')
    setError(null)
    setBusy(false)
  }, [dialog])

  const submit = async (): Promise<void> => {
    if (!dialog) return
    setBusy(true)
    setError(null)
    try {
      if (dialog.kind === 'prompt') await dialog.onSubmit(value)
      else await dialog.onConfirm()
      open(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <Dialog open={dialog !== null} onOpenChange={(o) => !o && open(null)}>
      <DialogContent className="sm:max-w-sm">
        {dialog && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
            className="flex flex-col gap-4"
          >
            <DialogHeader>
              <DialogTitle className="font-display">{dialog.title}</DialogTitle>
              {dialog.kind === 'confirm' ? <DialogDescription>{dialog.body}</DialogDescription> : <DialogDescription className="sr-only">{dialog.label}</DialogDescription>}
            </DialogHeader>
            {dialog.kind === 'prompt' && (
              <Input autoFocus aria-label={dialog.label} placeholder={dialog.label} value={value} maxLength={80} onChange={(e) => setValue(e.target.value)} />
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => open(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || (dialog.kind === 'prompt' && !value.trim())} variant={dialog.kind === 'confirm' ? 'destructive' : 'default'}>
                {dialog.action}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
