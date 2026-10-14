import { describe, expect, it } from 'vitest'
import { explainYtdlpError, parseYouTubeUrl, toTrackInfo, youtubeDownloadPolicy } from '../src/main/providers/youtube'
import { sanitizeText, sanitizeThumbnailUrl } from '../src/main/util/sanitize'

describe('parseYouTubeUrl', () => {
  const id = 'dQw4w9WgXcQ'
  it.each([
    [`https://www.youtube.com/watch?v=${id}`],
    [`https://youtube.com/watch?v=${id}&list=PLabc&t=10`],
    [`https://music.youtube.com/watch?v=${id}`],
    [`https://m.youtube.com/watch?v=${id}`],
    [`https://youtu.be/${id}?si=abc`],
    [`https://www.youtube.com/shorts/${id}`],
    [`  https://www.youtube.com/embed/${id}  `]
  ])('accepts %s', (url) => expect(parseYouTubeUrl(url)).toBe(id))

  it.each([
    ['not a url'],
    ['https://example.com/watch?v=dQw4w9WgXcQ'],
    ['https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ'],
    ['https://www.youtube.com/playlist?list=PLabc'],
    ['https://www.youtube.com/watch?v=short'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ;rm -rf'],
    ['file:///etc/passwd'],
    ['javascript:alert(1)'],
    ['https://www.youtube.com/@channel']
  ])('rejects %s', (url) => expect(parseYouTubeUrl(url)).toBeNull())
})

describe('youtubeDownloadPolicy', () => {
  const cc = { license: 'Creative Commons Attribution license (reuse allowed)', availability: 'public' }
  it('allows Creative Commons videos', () => expect(youtubeDownloadPolicy(cc).policy).toBe('allowed'))
  it('denies standard YouTube license videos', () => {
    const r = youtubeDownloadPolicy({ license: null, availability: 'public' })
    expect(r.policy).toBe('denied')
    expect(r.reason).toMatch(/Creative Commons/)
  })
  it('denies live streams, non-public videos and DRM even if licensed', () => {
    expect(youtubeDownloadPolicy({ ...cc, is_live: true }).policy).toBe('denied')
    expect(youtubeDownloadPolicy({ ...cc, live_status: 'is_upcoming' }).policy).toBe('denied')
    expect(youtubeDownloadPolicy({ ...cc, availability: 'needs_auth' }).policy).toBe('denied')
    expect(youtubeDownloadPolicy({ ...cc, formats: [{ has_drm: true }] }).policy).toBe('denied')
  })
})

describe('toTrackInfo', () => {
  it('sanitizes metadata and builds ids', () => {
    const t = toTrackInfo({ id: 'dQw4w9WgXcQ', title: '  Nice‮ song\n\u0000', channel: 'Chan\tnel', duration: 213.4 }, false)!
    expect(t).toMatchObject({ id: 'yt:dQw4w9WgXcQ', title: 'Nice song', channel: 'Chan nel', durationSec: 213, downloadPolicy: 'unknown' })
  })
  it('drops entries without a valid video id (channels, playlists)', () => {
    expect(toTrackInfo({ id: 'UCSJ4gkVC6NrvII8umztf0Ow', title: 'channel' }, false)).toBeNull()
    expect(toTrackInfo({ title: 'x' }, false)).toBeNull()
  })
  it('has no duration for live streams', () => {
    expect(toTrackInfo({ id: 'rFZHOHl-L8A', title: 'radio', is_live: true, duration: 5 }, true)!.durationSec).toBeNull()
  })
})

describe('sanitizers', () => {
  it('truncates long text', () => expect(sanitizeText('a'.repeat(500), 50)).toHaveLength(50))
  it('only accepts https thumbnails from known image hosts', () => {
    expect(sanitizeThumbnailUrl('https://i.ytimg.com/vi/x/mq.jpg')).not.toBeNull()
    expect(sanitizeThumbnailUrl('http://i.ytimg.com/vi/x/mq.jpg')).toBeNull()
    expect(sanitizeThumbnailUrl('https://evil.example/pixel.gif')).toBeNull()
    expect(sanitizeThumbnailUrl('https://i.ytimg.com.evil.example/x.jpg')).toBeNull()
  })
})

describe('explainYtdlpError', () => {
  it('maps common failures to readable messages', () => {
    expect(explainYtdlpError('ERROR: [youtube] x: Unable to download webpage: getaddrinfo failed')).toMatch(/Can’t reach YouTube/)
    expect(explainYtdlpError('ERROR: Private video. Sign in')).toMatch(/private/)
    expect(explainYtdlpError('ERROR: Video unavailable')).toMatch(/unavailable/)
  })
})
