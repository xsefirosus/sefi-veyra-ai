import { describe, expect, it } from 'vitest'
import { createSttAdapter, type SttAdapter } from '../src/shared/stt/stt-adapter'
import { WhisperLiveKitSttAdapter, type WsTransport } from '../src/main/stt/whisper-livekit'

/**
 * MockSttAdapter: a self-contained SttAdapter implementation used to prove the
 * interface contract. Compile: the `implements SttAdapter` clause plus the
 * explicit `const adapter: SttAdapter = ...` assignment below fail to compile
 * if the interface drifts. Emit behavior: partial/final/error callbacks fire
 * with (text, seq) / Error and send() records PCM.
 */
class MockSttAdapter implements SttAdapter {
  private partialCb: ((text: string, seq: number) => void) | null = null
  private finalCb: ((text: string, seq: number) => void) | null = null
  private errorCb: ((err: Error) => void) | null = null
  private pcmChunks: Int16Array[] = []
  connected = false
  closed = false

  async connect(): Promise<void> {
    this.connected = true
  }

  send(pcm: Int16Array): void {
    this.pcmChunks.push(pcm)
  }

  onPartial(cb: (text: string, seq: number) => void): void {
    this.partialCb = cb
  }

  onFinal(cb: (text: string, seq: number) => void): void {
    this.finalCb = cb
  }

  onError(cb: (err: Error) => void): void {
    this.errorCb = cb
  }

  async close(): Promise<void> {
    this.closed = true
  }

  // Test-only emitters (not part of SttAdapter).
  emitPartial(text: string, seq: number): void {
    this.partialCb?.(text, seq)
  }

  emitFinal(text: string, seq: number): void {
    this.finalCb?.(text, seq)
  }

  emitError(err: Error): void {
    this.errorCb?.(err)
  }

  receivedChunkCount(): number {
    return this.pcmChunks.length
  }
}

describe('stt-adapter contract', () => {
  it('MockSttAdapter satisfies the SttAdapter interface', () => {
    // Compile-time structural check: this assignment only compiles while
    // MockSttAdapter has every member of SttAdapter with a compatible type.
    const adapter: SttAdapter = new MockSttAdapter()
    expect(adapter).toBeInstanceOf(MockSttAdapter)
  })

  it('connect() and close() settle and flip their flags', async () => {
    const mock = new MockSttAdapter()
    await mock.connect()
    expect(mock.connected).toBe(true)
    await mock.close()
    expect(mock.closed).toBe(true)
  })

  it('send() records every PCM chunk', () => {
    const mock = new MockSttAdapter()
    mock.send(new Int16Array([1, 2, 3]))
    mock.send(new Int16Array([4, 5]))
    expect(mock.receivedChunkCount()).toBe(2)
  })

  it('onPartial fires with text and seq (live revisions share the seq)', () => {
    const mock = new MockSttAdapter()
    const seen: Array<[string, number]> = []
    mock.onPartial((text, seq) => seen.push([text, seq]))
    mock.emitPartial('testing one two', 0)
    mock.emitPartial('testing one two three', 0)
    expect(seen).toEqual([
      ['testing one two', 0],
      ['testing one two three', 0]
    ])
  })

  it('onFinal fires with the committed text and its seq', () => {
    const mock = new MockSttAdapter()
    const seen: Array<[string, number]> = []
    mock.onFinal((text, seq) => seen.push([text, seq]))
    mock.emitFinal('testing one two three', 0)
    expect(seen).toEqual([['testing one two three', 0]])
  })

  it('onError fires with the error instance', () => {
    const mock = new MockSttAdapter()
    const seen: Error[] = []
    mock.onError((err) => seen.push(err))
    const boom = new Error('ws disconnected')
    mock.emitError(boom)
    expect(seen).toEqual([boom])
  })

  it('createSttAdapter throws for cloud-deepgram', () => {
    expect(() => createSttAdapter('cloud-deepgram')).toThrow(/not implemented in this pass/)
  })

  it('createSttAdapter throws for cloud-assemblyai', () => {
    expect(() => createSttAdapter('cloud-assemblyai')).toThrow(/not implemented in this pass/)
  })
})

describe('createSttAdapter injectable options (step 6)', () => {
  it('defaults to mic / tiny / default url when no opts given', () => {
    const adapter = createSttAdapter('local-whisperlivekit')
    const anyAdapter = adapter as unknown as Record<string, unknown>
    expect(anyAdapter['source']).toBe('mic')
    expect(anyAdapter['model']).toBe('tiny')
    // url is undefined when not customised -- real adapter will use default ws://127.0.0.1:8000/asr
    expect(anyAdapter['url']).toBeUndefined()
  })

  it('forwards source loopback to the facade (and thus to the constructed adapter)', () => {
    const adapter = createSttAdapter('local-whisperlivekit', { source: 'loopback' })
    expect((adapter as unknown as Record<string, unknown>)['source']).toBe('loopback')
  })

  it('forwards custom url to the facade', () => {
    const url = 'ws://127.0.0.1:8001/asr'
    const adapter = createSttAdapter('local-whisperlivekit', { url })
    expect((adapter as unknown as Record<string, unknown>)['url']).toBe(url)
  })

  it('forwards model base/small to the facade', () => {
    const base = createSttAdapter('local-whisperlivekit', { model: 'base' })
    const small = createSttAdapter('local-whisperlivekit', { model: 'small' })
    expect((base as unknown as Record<string, unknown>)['model']).toBe('base')
    expect((small as unknown as Record<string, unknown>)['model']).toBe('small')
  })

  it('forwards all three together {source, url, model}', () => {
    const adapter = createSttAdapter('local-whisperlivekit', {
      source: 'loopback',
      url: 'ws://127.0.0.1:8001/asr',
      model: 'small'
    })
    const anyAdapter = adapter as unknown as Record<string, unknown>
    expect(anyAdapter['source']).toBe('loopback')
    expect(anyAdapter['url']).toBe('ws://127.0.0.1:8001/asr')
    expect(anyAdapter['model']).toBe('small')
  })

  it('two adapters with different opts remain independent (no singleton)', () => {
    const mic = createSttAdapter('local-whisperlivekit', {
      source: 'mic',
      url: 'ws://127.0.0.1:8000/asr',
      model: 'tiny'
    })
    const loopback = createSttAdapter('local-whisperlivekit', {
      source: 'loopback',
      url: 'ws://127.0.0.1:8001/asr',
      model: 'base'
    })
    expect(mic).not.toBe(loopback)
    expect((mic as unknown as Record<string, unknown>)['source']).toBe('mic')
    expect((loopback as unknown as Record<string, unknown>)['source']).toBe('loopback')
    expect((mic as unknown as Record<string, unknown>)['url']).toBe('ws://127.0.0.1:8000/asr')
    expect((loopback as unknown as Record<string, unknown>)['url']).toBe('ws://127.0.0.1:8001/asr')
    expect((mic as unknown as Record<string, unknown>)['model']).toBe('tiny')
    expect((loopback as unknown as Record<string, unknown>)['model']).toBe('base')
  })

  it('throws on invalid source / url / model', () => {
    expect(() =>
      createSttAdapter('local-whisperlivekit', { source: 'bad' as unknown as 'mic' })
    ).toThrow(/unsupported source/)
    expect(() => createSttAdapter('local-whisperlivekit', { url: 'http://example.com' })).toThrow(
      /invalid url/
    )
    expect(() =>
      createSttAdapter('local-whisperlivekit', { model: 'huge' as unknown as 'tiny' })
    ).toThrow(/unsupported model/)
  })

  it('WhisperLiveKitSttAdapter directly stores source/url/model (step-6 seam)', () => {
    class NoopTransport implements WsTransport {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      onMessage(): void {}
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      async connect(): Promise<void> {}
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      send(): void {}
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      async close(): Promise<void> {}
    }
    const a = new WhisperLiveKitSttAdapter({
      source: 'loopback',
      url: 'ws://127.0.0.1:8001/asr',
      model: 'base',
      transport: new NoopTransport()
    })
    expect(a.source).toBe('loopback')
    expect(a.url).toBe('ws://127.0.0.1:8001/asr')
    expect(a.model).toBe('base')
    const b = new WhisperLiveKitSttAdapter({ transport: new NoopTransport() })
    expect(b.source).toBe('mic')
    expect(b.model).toBe('tiny')
    expect(b.url).toBe('ws://127.0.0.1:8000/asr')
  })
})
