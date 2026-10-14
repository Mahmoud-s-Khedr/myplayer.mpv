import type { CacheState, DownloadPolicy, TrackSource } from '@shared/types'

export const CACHE_AFTER_QUALIFIED_PLAYS = 2

export interface EligibilityInput {
  source: TrackSource
  qualifiedPlays: number
  downloadPolicy: DownloadPolicy
  policyReason: string | null
  cache: CacheState
}

export type EligibilityReason =
  | 'ok' | 'local' | 'already-cached' | 'in-progress' | 'not-enough-plays' | 'not-permitted' | 'not-checked'

export interface Eligibility {
  eligible: boolean
  reason: EligibilityReason
  /** Text safe to show next to the track. */
  message: string
}

/**
 * Decides whether a track should be saved for offline use. A track is cached only after its second
 * qualified play AND only when its source says saving is permitted. Denial is final: it is never retried.
 */
export function evaluateCaching(t: EligibilityInput): Eligibility {
  if (t.source === 'local') return { eligible: false, reason: 'local', message: 'Already on this computer.' }
  if (t.cache === 'ready') return { eligible: false, reason: 'already-cached', message: 'Saved for offline use.' }
  if (t.cache === 'downloading') return { eligible: false, reason: 'in-progress', message: 'Saving for offline use…' }
  if (t.downloadPolicy === 'denied') return { eligible: false, reason: 'not-permitted', message: t.policyReason ?? 'The source doesn’t allow saving this track.' }
  if (t.downloadPolicy === 'unknown') return { eligible: false, reason: 'not-checked', message: 'Source rules haven’t been checked yet.' }
  if (t.qualifiedPlays < CACHE_AFTER_QUALIFIED_PLAYS) {
    const left = CACHE_AFTER_QUALIFIED_PLAYS - t.qualifiedPlays
    return { eligible: false, reason: 'not-enough-plays', message: `Saved for offline after ${left} more ${left === 1 ? 'play' : 'plays'}.` }
  }
  return { eligible: true, reason: 'ok', message: 'Saving for offline use…' }
}
