import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CacheManager } from '../src/main/cache/cache'
import { openDatabase } from '../src/main/db/database'
import { Repo } from '../src/main/db/repo'
import { FakeProvider, makeTempDir, makeTone, trackInfo, waitFor } from './helpers/fixtures'

let root: string
let tone: string
let repo: Repo
let provider: FakeProvider
let cache: CacheManager
let messages: { kind: string; message: string }[]

beforeAll(() => {
  root = makeTempDir()
  tone = makeTone(join(root, 'tone.wav'), 4)
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

beforeEach(() => {
  const dir = join(root, `cache-${Math.random().toString(36).slice(2)}`)
  repo = new Repo(openDatabase(':memory:'))
  provider = new FakeProvider()
  provider.files.set('aaaaaaaaaaa', tone)
  messages = []
  repo.upsertTrack(trackInfo('aaaaaaaaaaa', { durationSec: 4 }))
  cache = new CacheManager({
    dir, repo, provider, onChange: () => undefined,
    onMessage: (kind, message) => messages.push({ kind, message }),
    fetchThumb: async () => Buffer.from('jpegdata')
  })
  cache.init()
})

const qualify = (id: string, times: number) => {
  for (let i = 0; i < times; i++) repo.qualifySession(repo.startSession(id), id, 31000)
}
const audioFiles = () => readdirSync(join((cache as unknown as { o: { dir: string } }).o.dir, 'audio'))
const tmpEntries = () => readdirSync(join((cache as unknown as { o: { dir: string } }).o.dir, 'tmp'))

describe('CacheManager', () => {
  it('does not download after the first qualified play', () => {
    qualify('yt:aaaaaaaaaaa', 1)
    cache.consider('yt:aaaaaaaaaaa')
    expect(provider.downloadCalls).toEqual([])
  })

  it('downloads in the background after the second qualified play and publishes atomically', async () => {
    qualify('yt:aaaaaaaaaaa', 2)
    cache.consider('yt:aaaaaaaaaaa')
    expect(repo.getTrack('yt:aaaaaaaaaaa')!.cache).toBe('downloading')
    expect(audioFiles()).toEqual([]) // nothing visible in the cache folder while downloading
    await waitFor(() => repo.getTrack('yt:aaaaaaaaaaa')!.cache === 'ready')
    expect(audioFiles()).toEqual(['aaaaaaaaaaa.m4a'])
    expect(tmpEntries()).toEqual([])
    expect(repo.getTrack('yt:aaaaaaaaaaa')).toMatchObject({ cache: 'ready', localThumb: true })
    expect(cache.validFile('yt:aaaaaaaaaaa')).toMatch(/aaaaaaaaaaa\.m4a$/)
    expect(messages.at(-1)?.kind).toBe('info')
  })

  it('never starts two downloads for the same track', async () => {
    qualify('yt:aaaaaaaaaaa', 3)
    cache.consider('yt:aaaaaaaaaaa')
    cache.consider('yt:aaaaaaaaaaa')
    cache.consider('yt:aaaaaaaaaaa')
    await waitFor(() => repo.getTrack('yt:aaaaaaaaaaa')!.cache === 'ready')
    cache.consider('yt:aaaaaaaaaaa') // already cached
    expect(provider.downloadCalls).toHaveLength(1)
  })

  it('never downloads content the source forbids, however often it is played', () => {
    repo.upsertTrack(trackInfo('bbbbbbbbbbb', { downloadPolicy: 'denied', policyReason: 'Streams only.' }))
    qualify('yt:bbbbbbbbbbb', 10)
    cache.consider('yt:bbbbbbbbbbb')
    expect(provider.downloadCalls).toEqual([])
  })

  it('rejects a corrupted download and leaves nothing behind', async () => {
    provider.downloadMode = 'garbage'
    qualify('yt:aaaaaaaaaaa', 2)
    cache.consider('yt:aaaaaaaaaaa')
    await waitFor(() => messages.length > 0)
    expect(messages[0].kind).toBe('error')
    await waitFor(() => repo.getTrack('yt:aaaaaaaaaaa')!.cache === 'none')
    expect(audioFiles()).toEqual([])
    expect(tmpEntries()).toEqual([])
    expect(repo.getCacheEntry('yt:aaaaaaaaaaa')).toBeNull()
  })

  it('rejects a download that is much shorter than the track', async () => {
    repo.upsertTrack(trackInfo('aaaaaaaaaaa', { durationSec: 120 }))
    qualify('yt:aaaaaaaaaaa', 2)
    cache.consider('yt:aaaaaaaaaaa')
    await waitFor(() => messages.length > 0)
    expect(messages[0].message).toMatch(/cut short/)
    expect(audioFiles()).toEqual([])
  })

  it('cancels a running download and cleans up', async () => {
    provider.downloadMode = 'hang'
    qualify('yt:aaaaaaaaaaa', 2)
    cache.consider('yt:aaaaaaaaaaa')
    await waitFor(() => provider.downloadCalls.length === 1)
    cache.cancel('yt:aaaaaaaaaaa')
    await waitFor(() => repo.getTrack('yt:aaaaaaaaaaa')!.cache === 'none')
    expect(tmpEntries()).toEqual([])
    expect(messages).toEqual([]) // a cancel is not an error
    // and it can be started again afterwards
    provider.downloadMode = 'copy'
    cache.consider('yt:aaaaaaaaaaa')
    await waitFor(() => repo.getTrack('yt:aaaaaaaaaaa')!.cache === 'ready')
  })

  it('treats a missing cached file as not cached and forgets it', async () => {
    qualify('yt:aaaaaaaaaaa', 2)
    cache.consider('yt:aaaaaaaaaaa')
    await waitFor(() => repo.getTrack('yt:aaaaaaaaaaa')!.cache === 'ready')
    rmSync(cache.validFile('yt:aaaaaaaaaaa')!)
    expect(cache.validFile('yt:aaaaaaaaaaa')).toBeNull()
    expect(repo.getTrack('yt:aaaaaaaaaaa')!.cache).toBe('none')
    expect(repo.getTrack('yt:aaaaaaaaaaa')!.title).toBe('Track aaaaaaaaaaa') // metadata survives
  })

  it('detects a truncated or modified cached file', async () => {
    qualify('yt:aaaaaaaaaaa', 2)
    cache.consider('yt:aaaaaaaaaaa')
    await waitFor(() => repo.getTrack('yt:aaaaaaaaaaa')!.cache === 'ready')
    writeFileSync(cache.validFile('yt:aaaaaaaaaaa')!, 'short')
    expect(cache.validFile('yt:aaaaaaaaaaa')).toBeNull()
    expect(audioFiles()).toEqual([])
  })

  it('deletes cached content on request but keeps the track', async () => {
    qualify('yt:aaaaaaaaaaa', 2)
    cache.consider('yt:aaaaaaaaaaa')
    await waitFor(() => repo.getTrack('yt:aaaaaaaaaaa')!.cache === 'ready')
    cache.delete('yt:aaaaaaaaaaa')
    expect(audioFiles()).toEqual([])
    expect(repo.getTrack('yt:aaaaaaaaaaa')).toMatchObject({ cache: 'none', favorite: false })
    expect(repo.cacheStats().count).toBe(0)
  })

  it('init() clears interrupted downloads, orphan files and entries without files', async () => {
    qualify('yt:aaaaaaaaaaa', 2)
    cache.consider('yt:aaaaaaaaaaa')
    await waitFor(() => repo.getTrack('yt:aaaaaaaaaaa')!.cache === 'ready')
    const dir = (cache as unknown as { o: { dir: string } }).o.dir
    writeFileSync(join(dir, 'audio', 'orphan.m4a'), 'x')
    writeFileSync(join(dir, 'tmp', 'half.part'), 'x')
    rmSync(join(dir, 'audio', 'aaaaaaaaaaa.m4a'))
    cache.init()
    expect(readdirSync(join(dir, 'audio'))).toEqual([])
    expect(readdirSync(join(dir, 'tmp'))).toEqual([])
    expect(existsSync(join(dir, 'tmp'))).toBe(true)
    expect(repo.getTrack('yt:aaaaaaaaaaa')!.cache).toBe('none')
  })
})
