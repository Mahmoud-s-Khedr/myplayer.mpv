import { describe, expect, it } from 'vitest'
import { channelTabUrl, explainYtdlpError, parseYouTubeCollection, parseYouTubeUrl, toChannelInfo, toChannelPlaylist, toCollectionInfo, toTrackInfo, youtubeDownloadPolicy } from '../src/main/providers/youtube'
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

describe('parseYouTubeCollection', () => {
  const list = 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'
  const uc = 'UCSJ4gkVC6NrvII8umztf0Ow'
  it.each([
    [`https://www.youtube.com/playlist?list=${list}`, { kind: 'playlist', url: `https://www.youtube.com/playlist?list=${list}` }],
    [`https://music.youtube.com/playlist?list=${list}&si=x`, { kind: 'playlist', url: `https://www.youtube.com/playlist?list=${list}` }],
    ['https://www.youtube.com/@LofiGirl', { kind: 'channel', ref: '@LofiGirl', url: 'https://www.youtube.com/@LofiGirl/videos' }],
    ['https://www.youtube.com/@LofiGirl/videos', { kind: 'channel', ref: '@LofiGirl', url: 'https://www.youtube.com/@LofiGirl/videos' }],
    ['https://www.youtube.com/@LofiGirl/featured', { kind: 'channel', ref: '@LofiGirl', url: 'https://www.youtube.com/@LofiGirl/videos' }],
    ['https://m.youtube.com/@%D9%81%D9%86', { kind: 'channel', ref: '@%D9%81%D9%86', url: 'https://www.youtube.com/@%D9%81%D9%86/videos' }],
    [`https://www.youtube.com/channel/${uc}`, { kind: 'channel', ref: `channel/${uc}`, url: `https://www.youtube.com/channel/${uc}/videos` }],
    ['https://www.youtube.com/c/LofiGirl', { kind: 'channel', ref: 'c/LofiGirl', url: 'https://www.youtube.com/c/LofiGirl/videos' }],
    ['https://www.youtube.com/user/someone', { kind: 'channel', ref: 'user/someone', url: 'https://www.youtube.com/user/someone/videos' }]
  ])('accepts %s', (url, expected) => expect(parseYouTubeCollection(url)).toEqual(expected))

  it.each([
    ['not a url'],
    ['https://www.youtube.com/playlist'],
    ['https://www.youtube.com/playlist?list=a%20b'],
    ['https://www.youtube.com/playlist?list=PLabc;rm'],
    ['https://youtube.com.evil.com/@LofiGirl'],
    ['https://example.com/playlist?list=' + list],
    ['https://www.youtube.com/@LofiGirl/shorts'],
    ['https://www.youtube.com/@LofiGirl/videos/extra'],
    ['https://www.youtube.com/channel/UCshort'],
    ['https://www.youtube.com/@a/../../x'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ'],
    ['file:///etc/passwd']
  ])('rejects %s', (url) => expect(parseYouTubeCollection(url)).toBeNull())
})

describe('toCollectionInfo', () => {
  const v = (id: string, title: string, extra = {}) => ({ id, title, ...extra })
  it('keeps playable videos in order, drops placeholders and non-videos, and ignores the playlist owner', () => {
    const info = toCollectionInfo('playlist', {
      title: 'Road trip',
      channel: 'Someone',
      entries: [v('dQw4w9WgXcQ', 'One'), v('aaaaaaaaaaa', '[Private video]'), v('bbbbbbbbbbb', '[Deleted video]'), v('UCSJ4gkVC6NrvII8umztf0Ow', 'chan'), v('rFZHOHl-L8A', 'Two', { uploader: 'Other' })]
    }, 200)
    expect(info.kind).toBe('playlist')
    expect(info.title).toBe('Road trip')
    expect(info.tracks.map((t) => [t.id, t.channel])).toEqual([['yt:dQw4w9WgXcQ', 'Unknown channel'], ['yt:rFZHOHl-L8A', 'Other']])
    expect(info.truncated).toBe(false)
  })
  it('names a channel after its owner and flags a full page as truncated', () => {
    const entries = [v('dQw4w9WgXcQ', 'One'), v('rFZHOHl-L8A', 'Two')]
    const info = toCollectionInfo('channel', { title: 'Lofi Girl - Videos', uploader: 'Lofi Girl', entries }, 2)
    expect(info.title).toBe('Lofi Girl')
    expect(info.truncated).toBe(true)
  })
  it('falls back to the tab title minus its suffix', () => {
    expect(toCollectionInfo('channel', { title: 'Lofi Girl - Videos', entries: [v('dQw4w9WgXcQ', 'One')] }, 200).title).toBe('Lofi Girl')
  })
  it('refuses empty collections with a readable message', () => {
    expect(() => toCollectionInfo('playlist', { title: 'x', entries: [] }, 200)).toThrow(/no playable videos/)
    expect(() => toCollectionInfo('channel', { entries: null }, 200)).toThrow(/no videos/)
  })
})

describe('channel browsing', () => {
  const uc = 'UCSJ4gkVC6NrvII8umztf0Ow'
  const video = (id: string, title: string, extra = {}) => ({ id, title, ...extra })
  const playlist = (id: string, title: string, extra = {}) => ({
    id, title, url: `https://www.youtube.com/playlist?list=${id}`, ie_key: 'YoutubeTab',
    thumbnails: [{ url: 'https://i.ytimg.com/pl_c/x/studio_square_thumbnail.jpg' }], ...extra
  })

  it('builds tab urls only for valid channel refs', () => {
    expect(channelTabUrl('@LofiGirl', 'playlists')).toBe('https://www.youtube.com/@LofiGirl/playlists')
    expect(channelTabUrl(`channel/${uc}`, 'videos')).toBe(`https://www.youtube.com/channel/${uc}/videos`)
    expect(channelTabUrl('playlist?list=PLabcdefghij', 'videos')).toBeNull()
    expect(channelTabUrl('watch?v=dQw4w9WgXcQ', 'videos')).toBeNull()
    expect(channelTabUrl('@a/shorts', 'videos')).toBeNull()
  })

  it('gives channel uploads the channel and its id', () => {
    const info = toCollectionInfo('channel', { title: 'Lofi Girl - Videos', channel: 'Lofi Girl', channel_id: uc, entries: [video('dQw4w9WgXcQ', 'One')] }, 200)
    expect(info.tracks[0]).toMatchObject({ channel: 'Lofi Girl', channelId: uc })
  })
  it('does not credit a playlist’s owner with videos that lack a channel', () => {
    const info = toCollectionInfo('playlist', { title: 'Mix', channel: 'Curator', channel_id: uc, entries: [video('dQw4w9WgXcQ', 'One')] }, 200)
    expect(info.tracks[0]).toMatchObject({ channel: 'Unknown channel', channelId: null })
    expect(info.channelRef).toBeNull()
  })
  it('ignores invalid channel ids on a video', () => {
    expect(toTrackInfo({ id: 'dQw4w9WgXcQ', title: 'x', channel_id: 'nope' }, false)!.channelId).toBeNull()
  })

  it('lists playlists with a safe thumbnail', () => {
    const info = toChannelInfo('playlists', { title: 'Lofi Girl - Playlists', channel: 'Lofi Girl', entries: [playlist('PLdkGTI2esnoYxx', 'autumn lofi'), playlist('PLaklDK5Yxuss', 'Mix', { thumbnails: [{ url: 'http://evil.example/x.jpg' }, { url: 'https://i.ytimg.com/ok.jpg' }] })] }, 200)
    expect(info.title).toBe('Lofi Girl')
    expect(info.tracks).toEqual([])
    expect(info.playlists).toEqual([
      { id: 'PLdkGTI2esnoYxx', title: 'autumn lofi', thumbnail: 'https://i.ytimg.com/pl_c/x/studio_square_thumbnail.jpg' },
      { id: 'PLaklDK5Yxuss', title: 'Mix', thumbnail: 'https://i.ytimg.com/ok.jpg' }
    ])
  })
  it('skips entries that are not playlists', () => {
    expect(toChannelPlaylist({ id: 'dQw4w9WgXcQ', title: 'a video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })).toBeNull()
    expect(toChannelPlaylist({ id: uc, title: 'a channel', ie_key: 'Youtube' })).toBeNull()
    expect(toChannelPlaylist(playlist('PLdkGTI2esnoYxx', '   '))).toBeNull()
  })
  it('allows a channel without public playlists', () => {
    expect(toChannelInfo('playlists', { title: 'x - Playlists', entries: null }, 200).playlists).toEqual([])
  })
  it('returns uploads for the videos tab', () => {
    const info = toChannelInfo('videos', { channel: 'Lofi Girl', entries: [video('dQw4w9WgXcQ', 'One')] }, 200)
    expect(info).toMatchObject({ title: 'Lofi Girl', tab: 'videos', playlists: [] })
    expect(info.tracks).toHaveLength(1)
  })
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
  it('tells a missing playlist or channel apart from a network failure', () => {
    expect(explainYtdlpError('ERROR: [youtube:tab] @nope/videos: Unable to download API page: HTTP Error 404: Not Found')).toMatch(/doesn’t exist/)
    expect(explainYtdlpError('ERROR: [youtube:tab] PLzzz: Unable to download API page: HTTP Error 400: Bad Request')).toMatch(/doesn’t exist/)
    expect(explainYtdlpError('ERROR: [youtube:tab] x: Unable to download API page: <urlopen error [Errno -3] Temporary failure in name resolution>')).toMatch(/Can’t reach YouTube/)
  })
  it('maps common failures to readable messages', () => {
    expect(explainYtdlpError('ERROR: [youtube] x: Unable to download webpage: getaddrinfo failed')).toMatch(/Can’t reach YouTube/)
    expect(explainYtdlpError('ERROR: Private video. Sign in')).toMatch(/private/)
    expect(explainYtdlpError('ERROR: Video unavailable')).toMatch(/unavailable/)
  })
})
