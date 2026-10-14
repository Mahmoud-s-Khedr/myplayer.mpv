import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/database'
import { Repo } from '../src/main/db/repo'
import type { TrackInfo } from '../src/shared/types'

const info = (id: string, over: Partial<TrackInfo> = {}): TrackInfo => ({
  id: `yt:${id}`, source: 'youtube', sourceId: id, title: `Title ${id}`, channel: 'Chan', channelId: null, durationSec: 200,
  thumbnail: 'https://i.ytimg.com/vi/x/mq.jpg', url: `https://www.youtube.com/watch?v=${id}`, localPath: null,
  license: null, downloadPolicy: 'unknown', policyReason: null, ...over
})

let clock = 1000
let repo: Repo
beforeEach(() => {
  clock = 1000
  repo = new Repo(openDatabase(':memory:'), () => (clock += 10))
})

describe('tracks', () => {
  it('upserts and reads back metadata', () => {
    repo.upsertTrack(info('aaaaaaaaaaa'))
    expect(repo.getTrack('yt:aaaaaaaaaaa')).toMatchObject({ title: 'Title aaaaaaaaaaa', favorite: false, cache: 'none', qualifiedPlays: 0 })
  })

  it('keeps an already-decided download policy when a search result (policy unknown) is upserted again', () => {
    repo.upsertTrack(info('aaaaaaaaaaa', { downloadPolicy: 'allowed', license: 'CC BY', policyReason: 'ok' }))
    repo.upsertTrack(info('aaaaaaaaaaa', { title: 'Renamed' }))
    expect(repo.getTrack('yt:aaaaaaaaaaa')).toMatchObject({ title: 'Renamed', downloadPolicy: 'allowed', license: 'CC BY' })
  })

  it('preserves the order of requested ids and skips unknown ones', () => {
    repo.upsertTrack(info('aaaaaaaaaaa'))
    repo.upsertTrack(info('bbbbbbbbbbb'))
    expect(repo.getTracks(['yt:bbbbbbbbbbb', 'yt:nope', 'yt:aaaaaaaaaaa']).map((t) => t.sourceId)).toEqual(['bbbbbbbbbbb', 'aaaaaaaaaaa'])
  })

  it('toggles favorites and lists them newest first', () => {
    repo.upsertTrack(info('aaaaaaaaaaa'))
    repo.upsertTrack(info('bbbbbbbbbbb'))
    expect(repo.toggleFavorite('yt:aaaaaaaaaaa')).toBe(true)
    expect(repo.toggleFavorite('yt:bbbbbbbbbbb')).toBe(true)
    expect(repo.favorites().map((t) => t.sourceId)).toEqual(['bbbbbbbbbbb', 'aaaaaaaaaaa'])
    expect(repo.toggleFavorite('yt:aaaaaaaaaaa')).toBe(false)
    expect(repo.favorites()).toHaveLength(1)
    expect(() => repo.toggleFavorite('yt:missing')).toThrow()
  })
})

describe('channel ids', () => {
  const uc = 'UCSJ4gkVC6NrvII8umztf0Ow'
  it('keeps the channel id when a later sighting does not know it', () => {
    repo.upsertTrack(info('aaaaaaaaaaa', { channelId: uc }))
    repo.upsertTrack(info('aaaaaaaaaaa'))
    expect(repo.getTrack('yt:aaaaaaaaaaa')!.channelId).toBe(uc)
  })
  it('upserts many tracks at once', () => {
    repo.upsertTracks([info('aaaaaaaaaaa', { channelId: uc }), info('bbbbbbbbbbb')])
    expect(repo.getTracks(['yt:aaaaaaaaaaa', 'yt:bbbbbbbbbbb']).map((t) => t.channelId)).toEqual([uc, null])
  })
})

describe('library', () => {
  it('only includes tracks the user has interacted with', () => {
    repo.upsertTrack(info('aaaaaaaaaaa'))
    repo.upsertTrack(info('bbbbbbbbbbb'))
    repo.upsertTrack(info('ccccccccccc'))
    expect(repo.library('all')).toHaveLength(0) // search results alone are not library
    repo.startSession('yt:aaaaaaaaaaa')
    repo.toggleFavorite('yt:bbbbbbbbbbb')
    expect(repo.library('all').map((t) => t.sourceId).sort()).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb'])
  })

  it('filters offline and local tracks', () => {
    repo.upsertTrack(info('aaaaaaaaaaa'))
    repo.upsertTrack({ ...info('l'), id: 'file:0123456789abcdef', source: 'local', sourceId: '0123456789abcdef', localPath: '/m/a.mp3' })
    repo.setCacheEntry({ trackId: 'yt:aaaaaaaaaaa', file: '/c/a.m4a', bytes: 1234, thumbFile: null })
    expect(repo.library('offline').map((t) => t.cache)).toEqual(['ready'])
    expect(repo.library('local').map((t) => t.source)).toEqual(['local'])
    expect(repo.getTrack('yt:aaaaaaaaaaa')).toMatchObject({ cache: 'ready', cacheBytes: 1234 })
  })
})

describe('listening sessions', () => {
  beforeEach(() => repo.upsertTrack(info('aaaaaaaaaaa')))

  it('counts a qualified play once per session', () => {
    const play = repo.startSession('yt:aaaaaaaaaaa')
    expect(repo.qualifySession(play, 'yt:aaaaaaaaaaa', 31000)).toBe(1)
    expect(repo.qualifySession(play, 'yt:aaaaaaaaaaa', 40000)).toBe(1) // same session again
    const second = repo.startSession('yt:aaaaaaaaaaa')
    expect(repo.qualifySession(second, 'yt:aaaaaaaaaaa', 31000)).toBe(2)
  })

  it('does not count sessions that never qualified', () => {
    repo.startSession('yt:aaaaaaaaaaa')
    repo.startSession('yt:aaaaaaaaaaa')
    expect(repo.getTrack('yt:aaaaaaaaaaa')!.qualifiedPlays).toBe(0)
  })

  it('records history newest first and hides sessions shorter than 5 seconds', () => {
    repo.upsertTrack(info('bbbbbbbbbbb'))
    const a = repo.startSession('yt:aaaaaaaaaaa')
    repo.updateSession(a, 12000)
    const skipped = repo.startSession('yt:bbbbbbbbbbb')
    repo.updateSession(skipped, 1200)
    const b = repo.startSession('yt:bbbbbbbbbbb')
    repo.qualifySession(b, 'yt:bbbbbbbbbbb', 35000)
    const h = repo.history(10)
    expect(h.map((e) => [e.track.sourceId, e.qualified])).toEqual([['bbbbbbbbbbb', true], ['aaaaaaaaaaa', false]])
  })

  it('lists recent tracks by last played and clears history', () => {
    repo.upsertTrack(info('bbbbbbbbbbb'))
    repo.startSession('yt:aaaaaaaaaaa')
    repo.startSession('yt:bbbbbbbbbbb')
    expect(repo.recent(5).map((t) => t.sourceId)).toEqual(['bbbbbbbbbbb', 'aaaaaaaaaaa'])
    repo.clearHistory()
    expect(repo.recent(5)).toHaveLength(0)
    expect(repo.history(5)).toHaveLength(0)
  })
})

describe('playlists', () => {
  beforeEach(() => {
    for (const id of ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']) repo.upsertTrack(info(id))
  })

  it('creates, renames, lists with counts and deletes', () => {
    const p = repo.createPlaylist('Focus')
    repo.addToPlaylist(p.id, ['yt:aaaaaaaaaaa', 'yt:bbbbbbbbbbb'])
    repo.renamePlaylist(p.id, 'Deep focus')
    expect(repo.playlists()).toMatchObject([{ name: 'Deep focus', count: 2 }])
    repo.deletePlaylist(p.id)
    expect(repo.playlists()).toHaveLength(0)
  })

  it('keeps order, skips duplicates and removes entries', () => {
    const p = repo.createPlaylist('Mix')
    expect(repo.addToPlaylist(p.id, ['yt:ccccccccccc', 'yt:aaaaaaaaaaa'])).toBe(2)
    expect(repo.addToPlaylist(p.id, ['yt:aaaaaaaaaaa', 'yt:bbbbbbbbbbb'])).toBe(1)
    const entries = repo.playlistTracks(p.id)
    expect(entries.map((e) => e.track.sourceId)).toEqual(['ccccccccccc', 'aaaaaaaaaaa', 'bbbbbbbbbbb'])
    repo.removeFromPlaylist(p.id, entries[1].entryId)
    expect(repo.playlistTracks(p.id).map((e) => e.track.sourceId)).toEqual(['ccccccccccc', 'bbbbbbbbbbb'])
  })

  it('puts playlist members in the library', () => {
    const p = repo.createPlaylist('Mix')
    repo.addToPlaylist(p.id, ['yt:aaaaaaaaaaa'])
    expect(repo.library('all').map((t) => t.sourceId)).toEqual(['aaaaaaaaaaa'])
  })
})

describe('cache entries and key/value', () => {
  it('stores, lists, reports downloading state and deletes cache entries', () => {
    repo.upsertTrack(info('aaaaaaaaaaa'))
    repo.downloading.add('yt:aaaaaaaaaaa')
    expect(repo.getTrack('yt:aaaaaaaaaaa')!.cache).toBe('downloading')
    repo.setCacheEntry({ trackId: 'yt:aaaaaaaaaaa', file: '/c/a.m4a', bytes: 100, thumbFile: '/c/a.jpg' })
    expect(repo.getTrack('yt:aaaaaaaaaaa')).toMatchObject({ cache: 'ready', localThumb: true })
    expect(repo.cacheStats()).toEqual({ count: 1, bytes: 100 })
    repo.deleteCacheEntry('yt:aaaaaaaaaaa')
    expect(repo.cacheStats()).toEqual({ count: 0, bytes: 0 })
  })

  it('round-trips JSON and tolerates corrupt values', () => {
    repo.setJson('queue', { a: [1, 2] })
    expect(repo.getJson('queue')).toEqual({ a: [1, 2] })
    expect(repo.getJson('missing')).toBeNull()
  })
})
