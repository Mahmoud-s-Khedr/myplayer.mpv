import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExecError } from '../../src/main/util/exec'
import type { DownloadHandle, MediaProvider, ResolvedStream } from '../../src/main/providers/types'
import type { TrackInfo } from '../../src/shared/types'

export const makeTempDir = (): string => mkdtempSync(join(tmpdir(), 'myplayer-test-'))

export function makeTone(file: string, seconds: number): string {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`, file])
  return file
}

export const waitFor = async <T>(fn: () => T | undefined | false | null, ms = 8000): Promise<T> => {
  const end = Date.now() + ms
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() > end) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 25))
  }
}

export const trackInfo = (sourceId: string, over: Partial<TrackInfo> = {}): TrackInfo => ({
  id: `yt:${sourceId}`, source: 'youtube', sourceId, title: `Track ${sourceId}`, channel: 'Chan', durationSec: 3,
  thumbnail: 'https://i.ytimg.com/vi/x/mq.jpg', url: null, localPath: null, license: 'CC', downloadPolicy: 'allowed',
  policyReason: 'ok', ...over
})

/** A provider that serves local files instead of talking to YouTube. */
export class FakeProvider implements MediaProvider {
  readonly id = 'youtube' as const
  files = new Map<string, string>()
  offline = false
  resolveGate: Promise<void> | null = null
  resolveCalls: string[] = []
  downloadCalls: string[] = []
  downloadMode: 'copy' | 'garbage' | 'hang' = 'copy'
  infos = new Map<string, TrackInfo>()

  async search(): Promise<TrackInfo[]> { return [...this.infos.values()] }
  async lookup(): Promise<TrackInfo> { throw new Error('unused') }

  async resolve(sourceId: string, signal?: AbortSignal): Promise<ResolvedStream> {
    this.resolveCalls.push(sourceId)
    if (this.resolveGate) {
      await Promise.race([
        this.resolveGate,
        new Promise((_, rej) => signal?.addEventListener('abort', () => rej(new ExecError('aborted', '', true))))
      ])
    }
    if (this.offline) {
      const { UserFacingError } = await import('../../src/main/util/errors')
      throw new UserFacingError('Can’t reach YouTube. Check your connection. Saved tracks still play offline.')
    }
    const file = this.files.get(sourceId)
    if (!file) throw new Error('no fixture')
    return { info: this.infos.get(sourceId) ?? trackInfo(sourceId), streamUrl: file, headers: {} }
  }

  download(sourceId: string, dir: string): DownloadHandle {
    this.downloadCalls.push(sourceId)
    const out = join(dir, `${sourceId}.m4a`)
    let rejectFn: (e: Error) => void = () => undefined
    const done = new Promise<string>((resolve, reject) => {
      rejectFn = reject
      if (this.downloadMode === 'hang') return
      setTimeout(() => {
        if (this.downloadMode === 'garbage') writeFileSync(out, Buffer.alloc(40_000, 7))
        else copyFileSync(this.files.get(sourceId)!, out)
        resolve(out)
      }, 30)
    })
    return { done, cancel: () => rejectFn(new ExecError('cancelled', '', true)) }
  }
}
