import { describe, expect, it } from 'vitest'
import { PlayTracker, qualifyThresholdSec } from '../src/main/player/playTracker'

/** Simulate steady playback: position reported every 250ms. */
function playFor(t: PlayTracker, from: number, seconds: number, startMs = 0): { pos: number; now: number; qualifiedAt: number | null } {
  let pos = from
  let now = startMs
  let qualifiedAt: number | null = null
  for (let i = 0; i < seconds * 4; i++) {
    pos += 0.25
    now += 250
    if (t.tick(pos, now, true) && qualifiedAt === null) qualifiedAt = pos - from
  }
  return { pos, now, qualifiedAt }
}

describe('qualifyThresholdSec', () => {
  it('is 30s for normal tracks, half of short tracks, and 30s when the duration is unknown', () => {
    expect(qualifyThresholdSec(240)).toBe(30)
    expect(qualifyThresholdSec(40)).toBe(20)
    expect(qualifyThresholdSec(null)).toBe(30)
  })
})

describe('PlayTracker', () => {
  it('qualifies once after 30 seconds of listening', () => {
    const t = new PlayTracker(240)
    const r = playFor(t, 0, 29)
    expect(t.qualified).toBe(false)
    const r2 = playFor(t, r.pos, 5, r.now)
    expect(t.qualified).toBe(true)
    expect(r2.qualifiedAt).not.toBeNull()
    // keep listening: it must not report a second qualification
    const r3 = playFor(t, r2.pos, 60, r2.now)
    expect(r3.qualifiedAt).toBeNull()
  })

  it('does not count a seek to the end as listening', () => {
    const t = new PlayTracker(240)
    const r = playFor(t, 0, 5)
    expect(t.tick(200, r.now + 100, true)).toBe(false)
    expect(t.listenedMs).toBeLessThan(6000)
    expect(t.qualified).toBe(false)
  })

  it('does not count seeking backwards or replaying the same section twice as new qualification', () => {
    const t = new PlayTracker(240)
    const a = playFor(t, 0, 20)
    t.tick(0, a.now + 100, true) // seek back
    const b = playFor(t, 0, 5, a.now + 100)
    expect(t.listenedMs).toBeGreaterThan(24000)
    expect(b.qualifiedAt).toBeNull()
  })

  it('does not count paused time', () => {
    const t = new PlayTracker(240)
    const a = playFor(t, 0, 10)
    t.tick(a.pos, a.now + 60000, false)
    const b = playFor(t, a.pos, 10, a.now + 60000)
    expect(t.listenedMs).toBeGreaterThanOrEqual(19000)
    expect(t.listenedMs).toBeLessThan(21000)
    expect(b.qualifiedAt).toBeNull()
  })

  it('qualifies a short track at half its length', () => {
    const t = new PlayTracker(20)
    const r = playFor(t, 0, 11)
    expect(t.qualified).toBe(true)
    expect(r.qualifiedAt).toBeCloseTo(10, 0)
  })

  it('picks up a duration that arrives late', () => {
    const t = new PlayTracker(null)
    t.setDuration(20)
    playFor(t, 0, 11)
    expect(t.qualified).toBe(true)
  })
})
