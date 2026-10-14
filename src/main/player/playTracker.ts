export const QUALIFY_SECONDS = 30
export const QUALIFY_FRACTION = 0.5

/** Seconds of actual listening needed before a play counts: 30s, or half of a shorter track. */
export function qualifyThresholdSec(durationSec: number | null): number {
  return durationSec && durationSec > 0 ? Math.min(QUALIFY_SECONDS, durationSec * QUALIFY_FRACTION) : QUALIFY_SECONDS
}

/**
 * Measures real listening time for one listening session. Seeking forward, seeking back and pausing
 * never add time, so scrubbing to the end of a track cannot count as a play.
 */
export class PlayTracker {
  private lastPos: number | null = null
  private lastAt = 0
  private listenedSec = 0
  private done = false
  private threshold: number

  constructor(durationSec: number | null) {
    this.threshold = qualifyThresholdSec(durationSec)
  }

  get listenedMs(): number {
    return Math.round(this.listenedSec * 1000)
  }

  get qualified(): boolean {
    return this.done
  }

  /** Call whenever the playback position is reported. Returns true exactly once, when the session qualifies. */
  tick(positionSec: number, nowMs: number, playing: boolean): boolean {
    if (!playing) {
      this.lastPos = null
      return false
    }
    if (this.lastPos !== null) {
      const dPos = positionSec - this.lastPos
      const dWall = (nowMs - this.lastAt) / 1000
      // Normal playback advances about as fast as the wall clock. Bigger jumps are seeks.
      if (dPos > 0 && dPos <= dWall * 1.25 + 0.5) this.listenedSec += dPos
    }
    this.lastPos = positionSec
    this.lastAt = nowMs
    if (!this.done && this.listenedSec >= this.threshold) {
      this.done = true
      return true
    }
    return false
  }

  /** The reported duration can arrive after the session starts. */
  setDuration(durationSec: number | null): void {
    this.threshold = qualifyThresholdSec(durationSec)
  }
}
