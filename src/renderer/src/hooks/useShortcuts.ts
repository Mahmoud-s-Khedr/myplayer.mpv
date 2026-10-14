import { useEffect } from 'react'
import { SEARCH_INPUT_ID } from '@/views/SearchView'
import { act, currentTrack, useStore } from '@/store'

const isTyping = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

/** App-wide keyboard control. Ignored while typing, in menus and dialogs, and on sliders (which handle their own keys). */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useStore.getState()
      const p = window.player

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        s.setView({ kind: 'search' })
        setTimeout(() => document.getElementById(SEARCH_INPUT_ID)?.focus(), 0)
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTyping(e.target) || s.dialog || s.shortcutsOpen) return
      const target = e.target as HTMLElement
      if (target.closest?.('[role=slider],[role=menu],[role=tab]')) return

      const key = e.key
      const handled = ((): boolean => {
        switch (key) {
          case ' ':
            // On a button, Space should press it.
            if (target.tagName === 'BUTTON') return false
            void act(p.togglePause())
            return true
          case 'ArrowLeft':
          case 'ArrowRight':
            void act(p.seekBy((key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 30 : 5)))
            return true
          case 'n': case 'N': void act(p.next()); return true
          case 'p': case 'P': void act(p.previous()); return true
          case '+': case '=': void act(p.setVolume(s.player.volume + 5)); return true
          case '-': case '_': void act(p.setVolume(s.player.volume - 5)); return true
          case 'm': case 'M': void act(p.toggleMute()); return true
          case 'r': case 'R': {
            const next = { off: 'all', all: 'one', one: 'off' } as const
            void act(p.setRepeat(next[s.queue.repeat]))
            return true
          }
          case 'f': case 'F': {
            const t = currentTrack(s)
            if (t) void act(p.toggleFavorite(t.id))
            return true
          }
          case 'q': case 'Q': s.toggleQueue(); return true
          case '/':
            s.setView({ kind: 'search' })
            setTimeout(() => document.getElementById(SEARCH_INPUT_ID)?.focus(), 0)
            return true
          case '1': s.setView({ kind: 'search' }); return true
          case '2': s.setView({ kind: 'library' }); return true
          case '3': s.setView({ kind: 'favorites' }); return true
          case '4': s.setView({ kind: 'history' }); return true
          case '?': s.setShortcutsOpen(true); return true
          default: return false
        }
      })()
      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
