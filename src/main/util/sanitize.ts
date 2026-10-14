// Control characters, bidi overrides/isolates and zero-width characters: none belong in a title.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g

/** Make untrusted metadata safe to store and render: plain text, one line, bounded length. */
export function sanitizeText(value: unknown, max = 200): string {
  if (typeof value !== 'string') return ''
  const clean = value.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean
}

export function sanitizeDuration(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 60 * 60 * 24 ? Math.round(value) : null
}

const THUMB_HOSTS = ['ytimg.com', 'ggpht.com', 'googleusercontent.com']

/** Thumbnails are fetched by the renderer and the main process, so only known image CDNs are allowed. */
export function sanitizeThumbnailUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return null
    const ok = THUMB_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))
    return ok ? url.toString() : null
  } catch {
    return null
  }
}
