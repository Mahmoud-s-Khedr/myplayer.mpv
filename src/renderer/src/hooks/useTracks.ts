import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '@/store'

/**
 * Load data from the main process and reload it whenever track state changes (favorites, offline copies,
 * play counts). Old data stays on screen while reloading, so lists don't flash.
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const revision = useStore((s) => s.revision)
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const loadRef = useRef(load)
  loadRef.current = load
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let live = true
    loadRef.current()
      .then((d) => live && (setData(d), setError(null)))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Couldn’t load this list.'))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, tick, ...deps])

  return { data, error, loading, reload }
}
