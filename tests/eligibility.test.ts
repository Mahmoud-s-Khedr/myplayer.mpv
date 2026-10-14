import { describe, expect, it } from 'vitest'
import { evaluateCaching, type EligibilityInput } from '../src/main/cache/eligibility'

const base: EligibilityInput = { source: 'youtube', qualifiedPlays: 2, downloadPolicy: 'allowed', policyReason: null, cache: 'none' }
const check = (over: Partial<EligibilityInput>) => evaluateCaching({ ...base, ...over })

describe('evaluateCaching', () => {
  it('is eligible on the second qualified play when the source permits saving', () => {
    expect(check({})).toMatchObject({ eligible: true, reason: 'ok' })
  })

  it('waits for the second qualified play', () => {
    expect(check({ qualifiedPlays: 0 })).toMatchObject({ eligible: false, reason: 'not-enough-plays' })
    const one = check({ qualifiedPlays: 1 })
    expect(one).toMatchObject({ eligible: false, reason: 'not-enough-plays' })
    expect(one.message).toContain('1 more play')
  })

  it('stays eligible for later plays if an earlier download failed', () => {
    expect(check({ qualifiedPlays: 5 }).eligible).toBe(true)
  })

  it('never caches content the source does not permit, no matter how often it is played', () => {
    const r = check({ qualifiedPlays: 50, downloadPolicy: 'denied', policyReason: 'Streams only.' })
    expect(r).toMatchObject({ eligible: false, reason: 'not-permitted', message: 'Streams only.' })
  })

  it('does not cache before the source rules have been checked', () => {
    expect(check({ downloadPolicy: 'unknown' })).toMatchObject({ eligible: false, reason: 'not-checked' })
  })

  it('avoids duplicate downloads', () => {
    expect(check({ cache: 'downloading' })).toMatchObject({ eligible: false, reason: 'in-progress' })
    expect(check({ cache: 'ready' })).toMatchObject({ eligible: false, reason: 'already-cached' })
  })

  it('never caches local files', () => {
    expect(check({ source: 'local' })).toMatchObject({ eligible: false, reason: 'local' })
  })
})
