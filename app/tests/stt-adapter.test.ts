import { describe, expect, it } from 'vitest'
import { createSttAdapter, type SttAdapter } from '../src/shared/stt/stt-adapter'

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
