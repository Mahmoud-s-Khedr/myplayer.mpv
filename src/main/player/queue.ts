import { randomUUID } from 'node:crypto'
import type { RepeatMode } from '@shared/types'

export interface QueueEntry { uid: string; trackId: string }
export interface QueueState { entries: QueueEntry[]; index: number; repeat: RepeatMode }

export const emptyQueue = (): QueueState => ({ entries: [], index: -1, repeat: 'off' })

type Uid = () => string
const entriesFor = (ids: string[], uid: Uid): QueueEntry[] => ids.map((trackId) => ({ uid: uid(), trackId }))

export const currentEntry = (q: QueueState): QueueEntry | null => q.entries[q.index] ?? null

/** Replace the whole queue and point at `startIndex`. */
export function replaceQueue(q: QueueState, ids: string[], startIndex: number, uid: Uid = randomUUID): QueueState {
  if (ids.length === 0) return { ...q, entries: [], index: -1 }
  return { ...q, entries: entriesFor(ids, uid), index: Math.min(Math.max(startIndex, 0), ids.length - 1) }
}

/** Add tracks after the current one ('next') or at the end. The first track added to an empty queue becomes current. */
export function enqueue(q: QueueState, ids: string[], where: 'next' | 'end', uid: Uid = randomUUID): QueueState {
  if (ids.length === 0) return q
  const added = entriesFor(ids, uid)
  const at = where === 'next' && q.index >= 0 ? q.index + 1 : q.entries.length
  const entries = [...q.entries.slice(0, at), ...added, ...q.entries.slice(at)]
  return { ...q, entries, index: q.index === -1 ? 0 : q.index }
}

/** Remove one entry. `wasCurrent` tells the caller the playing item vanished and index now points at its successor. */
export function removeEntry(q: QueueState, uid: string): { state: QueueState; wasCurrent: boolean } {
  const at = q.entries.findIndex((e) => e.uid === uid)
  if (at === -1) return { state: q, wasCurrent: false }
  const entries = q.entries.filter((_, i) => i !== at)
  const wasCurrent = at === q.index
  let index = q.index
  if (at < q.index) index--
  if (entries.length === 0) index = -1
  else if (index >= entries.length) index = entries.length - 1
  return { state: { ...q, entries, index }, wasCurrent }
}

/** Move an entry to `toIndex` (its position after the move). The current item keeps playing. */
export function moveEntry(q: QueueState, uid: string, toIndex: number): QueueState {
  const from = q.entries.findIndex((e) => e.uid === uid)
  if (from === -1) return q
  const to = Math.min(Math.max(toIndex, 0), q.entries.length - 1)
  if (from === to) return q
  const entries = [...q.entries]
  const [moved] = entries.splice(from, 1)
  entries.splice(to, 0, moved)
  const currentUid = q.entries[q.index]?.uid
  return { ...q, entries, index: currentUid ? entries.findIndex((e) => e.uid === currentUid) : -1 }
}

export function jumpTo(q: QueueState, uid: string): QueueState {
  const index = q.entries.findIndex((e) => e.uid === uid)
  return index === -1 ? q : { ...q, index }
}

/**
 * Advance. `auto` is true when a track ended by itself (repeat-one replays it); a manual skip always moves on.
 * Returns `stop` when the queue is finished.
 */
export function advance(q: QueueState, auto: boolean): { state: QueueState; action: 'play' | 'stop' } {
  if (q.entries.length === 0) return { state: q, action: 'stop' }
  if (auto && q.repeat === 'one') return { state: q, action: 'play' }
  if (q.index + 1 < q.entries.length) return { state: { ...q, index: q.index + 1 }, action: 'play' }
  if (q.repeat !== 'off') return { state: { ...q, index: 0 }, action: 'play' }
  return { state: q, action: 'stop' }
}

/** Previous: restart the current track when it's more than 3s in, otherwise go back one. */
export function retreat(q: QueueState, positionSec: number): { state: QueueState; action: 'play' | 'restart' } {
  if (positionSec > 3) return { state: q, action: 'restart' }
  if (q.index > 0) return { state: { ...q, index: q.index - 1 }, action: 'play' }
  if (q.repeat === 'all' && q.entries.length > 0) return { state: { ...q, index: q.entries.length - 1 }, action: 'play' }
  return { state: q, action: 'restart' }
}

export const clearQueue = (q: QueueState): QueueState => ({ ...q, entries: [], index: -1 })
