import { execFileSync } from 'node:child_process'
import { rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { importLocalFiles, localTrackId } from '../src/main/local/importer'
import { probeAudio } from '../src/main/util/ffprobe'
import { makeTempDir } from './helpers/fixtures'

let dir: string
beforeAll(() => {
  dir = makeTempDir()
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=2', '-metadata', 'title=Evening  Tone‮', '-metadata', 'artist=Test Artist', join(dir, 'tone.mp3')])
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=1', join(dir, 'My_Plain_File.flac')])
  writeFileSync(join(dir, 'notes.txt'), 'not audio')
  writeFileSync(join(dir, 'broken.mp3'), Buffer.alloc(5000, 3))
  symlinkSync(join(dir, 'tone.mp3'), join(dir, 'alias.mp3'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('importLocalFiles', () => {
  it('reads tags, sanitizes them and falls back to the file name', async () => {
    const { tracks, skipped } = await importLocalFiles([join(dir, 'tone.mp3'), join(dir, 'My_Plain_File.flac')], probeAudio)
    expect(skipped).toEqual([])
    expect(tracks[0]).toMatchObject({ source: 'local', title: 'Evening Tone', channel: 'Test Artist', downloadPolicy: 'denied' })
    expect(tracks[0].durationSec).toBe(2)
    expect(tracks[0].id).toMatch(/^file:[0-9a-f]{16}$/)
    expect(tracks[1]).toMatchObject({ title: 'My Plain File', channel: 'Local file' })
  })

  it('skips non-audio and unreadable files instead of failing the whole import', async () => {
    const { tracks, skipped } = await importLocalFiles([join(dir, 'notes.txt'), join(dir, 'broken.mp3'), join(dir, 'missing.mp3'), join(dir, 'tone.mp3')], probeAudio)
    expect(tracks).toHaveLength(1)
    expect(skipped.sort()).toEqual(['broken.mp3', 'missing.mp3', 'notes.txt'])
  })

  it('gives a file the same id however it is reached, so it is never added twice', async () => {
    const a = await importLocalFiles([join(dir, 'tone.mp3')], probeAudio)
    const b = await importLocalFiles([join(dir, 'alias.mp3')], probeAudio)
    expect(a.tracks[0].id).toBe(b.tracks[0].id)
    expect(a.tracks[0].id).toBe(localTrackId(a.tracks[0].localPath!))
  })
})
