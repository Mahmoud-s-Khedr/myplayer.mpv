import { describe, expect, it } from 'vitest'
import {
  advance, clearQueue, currentEntry, emptyQueue, enqueue, jumpTo, moveEntry, removeEntry, replaceQueue, retreat
} from '../src/main/player/queue'

let n = 0
const uid = () => `u${++n}`
const ids = (q: { entries: { trackId: string }[] }) => q.entries.map((e) => e.trackId).join('')
const make = (s: string, index = 0) => replaceQueue(emptyQueue(), [...s], index, uid)

describe('queue', () => {
  it('replaces the queue and clamps the start index', () => {
    expect(make('abc', 1).index).toBe(1)
    expect(make('abc', 99).index).toBe(2)
    expect(replaceQueue(make('abc'), [], 0).index).toBe(-1)
  })

  it('enqueues at the end and after the current track', () => {
    const q = make('abc', 1)
    expect(ids(enqueue(q, ['x'], 'end', uid))).toBe('abcx')
    expect(ids(enqueue(q, ['x', 'y'], 'next', uid))).toBe('abxyc')
  })

  it('makes the first enqueued track current in an empty queue', () => {
    const q = enqueue(emptyQueue(), ['a'], 'end', uid)
    expect(q.index).toBe(0)
    expect(currentEntry(q)?.trackId).toBe('a')
  })

  it('allows the same track twice with distinct uids', () => {
    const q = enqueue(make('a'), ['a'], 'end', uid)
    expect(new Set(q.entries.map((e) => e.uid)).size).toBe(2)
  })

  it('removes entries and keeps the current track stable', () => {
    const q = make('abcd', 2)
    const before = removeEntry(q, q.entries[0].uid)
    expect(before.wasCurrent).toBe(false)
    expect(before.state.index).toBe(1)
    expect(currentEntry(before.state)?.trackId).toBe('c')
    const after = removeEntry(q, q.entries[3].uid)
    expect(currentEntry(after.state)?.trackId).toBe('c')
  })

  it('points at the successor when the current entry is removed', () => {
    const q = make('abc', 1)
    const r = removeEntry(q, q.entries[1].uid)
    expect(r.wasCurrent).toBe(true)
    expect(currentEntry(r.state)?.trackId).toBe('c')
  })

  it('clamps the index when the last, current entry is removed and empties cleanly', () => {
    const q = make('ab', 1)
    expect(removeEntry(q, q.entries[1].uid).state.index).toBe(0)
    const one = make('a')
    expect(removeEntry(one, one.entries[0].uid).state.index).toBe(-1)
  })

  it('moves entries while following the playing track', () => {
    const q = make('abcd', 1)
    const moved = moveEntry(q, q.entries[3].uid, 0)
    expect(ids(moved)).toBe('dabc')
    expect(currentEntry(moved)?.trackId).toBe('b')
    const movedCurrent = moveEntry(q, q.entries[1].uid, 3)
    expect(ids(movedCurrent)).toBe('acdb')
    expect(currentEntry(movedCurrent)?.trackId).toBe('b')
  })

  it('jumps to an entry by uid and ignores unknown uids', () => {
    const q = make('abc')
    expect(jumpTo(q, q.entries[2].uid).index).toBe(2)
    expect(jumpTo(q, 'nope')).toBe(q)
  })

  describe('advance', () => {
    it('moves forward and stops at the end with repeat off', () => {
      let q = make('ab')
      let r = advance(q, true)
      expect([r.state.index, r.action]).toEqual([1, 'play'])
      q = r.state
      r = advance(q, true)
      expect([r.state.index, r.action]).toEqual([1, 'stop'])
    })

    it('wraps with repeat all', () => {
      const q = { ...make('ab', 1), repeat: 'all' as const }
      expect(advance(q, true).state.index).toBe(0)
    })

    it('replays the same track with repeat one only when it ended by itself', () => {
      const q = { ...make('ab'), repeat: 'one' as const }
      expect(advance(q, true).state.index).toBe(0)
      expect(advance(q, false).state.index).toBe(1)
    })

    it('stops on an empty queue', () => {
      expect(advance(emptyQueue(), false).action).toBe('stop')
    })
  })

  describe('retreat', () => {
    it('restarts the track when more than 3s in', () => {
      expect(retreat(make('ab', 1), 10)).toMatchObject({ action: 'restart', state: { index: 1 } })
    })
    it('goes back when near the start', () => {
      expect(retreat(make('ab', 1), 1)).toMatchObject({ action: 'play', state: { index: 0 } })
    })
    it('restarts at the first track, or wraps with repeat all', () => {
      expect(retreat(make('ab', 0), 1).action).toBe('restart')
      expect(retreat({ ...make('ab', 0), repeat: 'all' }, 1)).toMatchObject({ action: 'play', state: { index: 1 } })
    })
  })

  it('clears the queue but keeps the repeat mode', () => {
    const q = clearQueue({ ...make('abc'), repeat: 'all' })
    expect(q).toMatchObject({ entries: [], index: -1, repeat: 'all' })
  })
})
