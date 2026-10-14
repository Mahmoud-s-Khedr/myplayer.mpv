import { create } from 'zustand'
import type { PlayerState, PlaylistSummary, QueueSnapshot, Toast, Track } from '@shared/types'

export type View =
  | { kind: 'search' }
  | { kind: 'library' }
  | { kind: 'favorites' }
  | { kind: 'history' }
  | { kind: 'playlist'; id: number }
  | { kind: 'channel'; ref: string }

export interface SearchState {
  input: string
  creativeCommons: boolean
  status: 'idle' | 'loading' | 'done' | 'error'
  mode: 'search' | 'link'
  results: Track[]
  /** Set when the pasted link was a playlist, so the view can offer to play or save all of it. */
  link: { title: string; truncated: boolean } | null
  error: string | null
}

export type AppDialog =
  | { kind: 'prompt'; title: string; label: string; initial: string; action: string; onSubmit: (value: string) => Promise<void> | void }
  | { kind: 'confirm'; title: string; body: string; action: string; onConfirm: () => Promise<void> | void }

interface ToastItem extends Toast {
  id: number
}

interface Store {
  view: View
  /** Where the back button of a channel goes. */
  returnTo: View | null
  player: PlayerState
  queue: QueueSnapshot
  queueOpen: boolean
  shortcutsOpen: boolean
  playlists: PlaylistSummary[]
  /** Bumps whenever track state changes anywhere, so views know to reload. */
  revision: number
  search: SearchState
  toasts: ToastItem[]
  dialog: AppDialog | null

  openDialog: (d: AppDialog | null) => void
  setView: (v: View) => void
  openChannel: (ref: string) => void
  closeChannel: () => void
  toggleQueue: () => void
  setShortcutsOpen: (open: boolean) => void
  setSearchInput: (input: string) => void
  setCreativeCommons: (on: boolean) => void
  runSearch: () => Promise<void>
  refreshPlaylists: () => Promise<void>
  toast: (t: Toast) => void
  dismissToast: (id: number) => void
  init: () => Promise<() => void>
}

const URL_LIKE = /^(https?:\/\/|www\.|youtu\.be\/|(m\.|music\.)?youtube\.com\/)/i
let searchToken = 0
let toastId = 0

export const useStore = create<Store>((set, get) => ({
  view: { kind: 'search' },
  returnTo: null,
  player: { status: 'idle', positionSec: 0, durationSec: 0, volume: 80, muted: false, source: null, error: null },
  queue: { items: [], index: -1, repeat: 'off' },
  queueOpen: true,
  shortcutsOpen: false,
  playlists: [],
  revision: 0,
  search: { input: '', creativeCommons: false, status: 'idle', mode: 'search', results: [], link: null, error: null },
  toasts: [],
  dialog: null,

  openDialog: (dialog) => set({ dialog }),
  setView: (view) => set({ view }),
  openChannel: (ref) => set((s) => ({ view: { kind: 'channel', ref }, returnTo: s.view.kind === 'channel' ? s.returnTo : s.view })),
  closeChannel: () => set((s) => ({ view: s.returnTo ?? { kind: 'search' }, returnTo: null })),
  toggleQueue: () => set((s) => ({ queueOpen: !s.queueOpen })),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setSearchInput: (input) => set((s) => ({ search: { ...s.search, input } })),
  setCreativeCommons: (creativeCommons) => {
    set((s) => ({ search: { ...s.search, creativeCommons } }))
    if (get().search.mode === 'search' && get().search.input.trim()) void get().runSearch()
  },

  runSearch: async () => {
    const { input, creativeCommons } = get().search
    const text = input.trim()
    if (!text) return
    const token = ++searchToken
    const mode = URL_LIKE.test(text) ? 'link' : 'search'
    set((s) => ({ search: { ...s.search, status: 'loading', mode, error: null } }))
    try {
      let results: Track[]
      let link: SearchState['link'] = null
      if (mode === 'link') {
        const opened = await window.player.resolveUrl(text)
        if (token !== searchToken) return
        if (opened.kind === 'channel' && opened.channelRef) {
          set((s) => ({ search: { ...s.search, status: 'idle' } }))
          get().openChannel(opened.channelRef)
          return
        }
        results = opened.tracks
        if (opened.kind === 'playlist') link = { title: opened.title, truncated: opened.truncated }
      } else {
        results = await window.player.search(text, creativeCommons)
      }
      if (token !== searchToken) return
      set((s) => ({ search: { ...s.search, status: 'done', results, link } }))
    } catch (err) {
      if (token !== searchToken) return
      set((s) => ({ search: { ...s.search, status: 'error', results: [], link: null, error: err instanceof Error ? err.message : 'Search failed.' } }))
    }
  },

  refreshPlaylists: async () => set({ playlists: await window.player.playlists() }),

  toast: (t) => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }))
    setTimeout(() => get().dismissToast(id), t.kind === 'error' ? 8000 : 4500)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  init: async () => {
    const api = window.player
    const offs = [
      api.on('player:state', (player) => set({ player })),
      api.on('queue:changed', (queue) => set({ queue })),
      api.on('toast', (t) => get().toast(t)),
      api.on('tracks:changed', ({ ids }) => {
        set((s) => ({ revision: s.revision + 1 }))
        // Refresh the rows that are on screen in search results.
        const shown = get().search.results.filter((t) => ids.includes(t.id)).map((t) => t.id)
        if (shown.length) {
          void api.tracks(shown).then((fresh) =>
            set((s) => ({ search: { ...s.search, results: s.search.results.map((t) => fresh.find((f) => f.id === t.id) ?? t) } }))
          )
        }
      })
    ]
    const snap = await api.getSnapshot()
    set({ player: snap.player, queue: snap.queue })
    await get().refreshPlaylists()
    return () => offs.forEach((off) => off())
  }
}))

export const currentTrack = (s: Pick<Store, 'queue'>): Track | null => s.queue.items[s.queue.index]?.track ?? null

/** Run an IPC call and surface its error as a toast instead of an unhandled rejection. */
export async function act<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch (err) {
    useStore.getState().toast({ kind: 'error', message: err instanceof Error ? err.message : 'Something went wrong.' })
    return undefined
  }
}
