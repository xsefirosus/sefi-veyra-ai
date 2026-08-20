import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createPcmSink,
  feedWavToAdapter,
  parseWavHeader,
  readWavPcm
} from '../src/main/capture/audio-input'
import type { SttAdapter } from '../src/shared/stt/stt-adapter'

/**
 * Seams under test (pre-agreed, plan step 17):
 *   1. WAV parse (readWavPcm / parseWavHeader) -- the VEYRA_TEST_AUDIO file
 *      reader: builds a synthetic 16 kHz mono 16-bit PCM WAV in a temp dir,
 *      asserts exact sample round-trip, and asserts loud rejection of wrong
 *      formats (non-RIFF, non-PCM, 8-bit, stereo, truncated).
 *   2. createPcmSink -- the ipcMain 'pcm' -> adapter.send(int16) seam: the
 *      renderer is a trust boundary, so non-finite / empty / oversized /
 *      wrong-type chunks are rejected, valid Float32Array (and ArrayBuffer)
 *      chunks convert to int16 and reach adapter.send.
 *   3. feedWavToAdapter -- the step 21-22 seam feeds the WAV through the SAME
 *      adapter.send path, chunked (default 1600 samples = 100 ms @ 16 kHz).
 * Scope: src/main/capture/audio-input.ts only.
 */

/** Record everything sent through the adapter seam. */
class RecordingAdapter implements SttAdapter {
  readonly sent: Int16Array[] = []
  private partialCb: ((text: string, seq: number) => void) | null = null
  private finalCb: ((text: string, seq: number) => void) | null = null
  private errorCb: ((err: Error) => void) | null = null
  connect(): Promise<void> {
    return Promise.resolve()
  }
  send(pcm: Int16Array): void {
    this.sent.push(pcm.slice())
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
  close(): Promise<void> {
    return Promise.resolve()
  }
}

/** Build a 16-bit mono PCM WAV buffer (16 kHz; rate only matters for the header). */
function makeWav(samples: number[], sampleRate = 16000): Buffer {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2))
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'latin1')
  header.write('fmt ', 12, 'latin1')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36, 'latin1')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const dir = mkdtempSync(join(tmpdir(), 'veyra-audio-input-'))
const wavPath = join(dir, 'test.wav')
const samples = [0, 1, -1, 32767, -32768, 1234, -4321, 16000]
writeFileSync(wavPath, makeWav(samples))

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('readWavPcm / parseWavHeader', () => {
  it('round-trips the samples of a synthetic 16k mono 16-bit WAV', () => {
    const pcm = readWavPcm(wavPath)
    expect(Array.from(pcm)).toEqual(samples)
  })

  it('reports the header facts (16 kHz, mono, 16-bit, exact data length)', () => {
    const info = parseWavHeader(readFileSync(wavPath))
    expect(info.sampleRate).toBe(16000)
    expect(info.channels).toBe(1)
    expect(info.bitsPerSample).toBe(16)
    expect(info.dataLength).toBe(samples.length * 2)
  })

  it('rejects a non-RIFF/WAVE file', () => {
    writeFileSync(join(dir, 'garbage.wav'), Buffer.alloc(64, 0x41)) // 64 bytes of 'A'
    expect(() => readWavPcm(join(dir, 'garbage.wav'))).toThrow(/RIFF\/WAVE/)
  })

  it('rejects non-PCM, 8-bit, and stereo WAVs loudly', () => {
    // Copy the good WAV and flip fmt fields to simulate each bad variant.
    const good = makeWav([1, 2, 3])
    const badFormat = Buffer.from(good)
    badFormat.writeUInt16LE(3, 20) // IEEE float, not PCM
    expect(() => parseWavHeader(badFormat)).toThrow(/not PCM/)

    const badBits = Buffer.from(good)
    badBits.writeUInt16LE(8, 34)
    expect(() => parseWavHeader(badBits)).toThrow(/not 16-bit/)

    const badChannels = Buffer.from(good)
    badChannels.writeUInt16LE(2, 22)
    expect(() => parseWavHeader(badChannels)).toThrow(/not mono/)
  })

  it('rejects a truncated file (no data chunk)', () => {
    const good = makeWav([1, 2, 3])
    expect(() => parseWavHeader(good.subarray(0, 30))).toThrow(/no fmt chunk|too short/)
  })
})

describe('createPcmSink (ipc pcm -> adapter.send(int16))', () => {
  it('converts a valid Float32Array chunk to int16 and reaches adapter.send', () => {
    const adapter = new RecordingAdapter()
    const sink = createPcmSink(adapter)
    sink(new Float32Array([-1, -0.5, 0, 0.5, 1]))
    expect(adapter.sent).toHaveLength(1)
    expect(Array.from(adapter.sent[0])).toEqual([-32768, -16384, 0, 16384, 32767])
  })

  it('accepts a chunk delivered as its raw ArrayBuffer (Electron IPC variant)', () => {
    const adapter = new RecordingAdapter()
    createPcmSink(adapter)(new Float32Array([0.25, 0.75]).buffer)
    expect(Array.from(adapter.sent[0])).toEqual([8192, 24576])
  })

  it('rejects non-finite samples (trust boundary)', () => {
    const adapter = new RecordingAdapter()
    const sink = createPcmSink(adapter)
    expect(() => sink(new Float32Array([0.5, NaN]))).toThrow(/non-finite/)
    expect(() => sink(new Float32Array([Infinity, 0]))).toThrow(/non-finite/)
    expect(adapter.sent).toHaveLength(0)
  })

  it('rejects empty, oversized, and wrong-type chunks', () => {
    const adapter = new RecordingAdapter()
    const sink = createPcmSink(adapter)
    expect(() => sink(new Float32Array(0))).toThrow(/empty/)
    expect(() => sink('pcm')).toThrow(/not a Float32Array/)
    expect(() => sink(new Float32Array(2_000_000))).toThrow(/exceeds/)
    expect(adapter.sent).toHaveLength(0)
  })
})

describe('feedWavToAdapter (VEYRA_TEST_AUDIO seam, steps 21-22)', () => {
  it('feeds the WAV through adapter.send in 1600-sample chunks (100 ms @ 16 kHz)', async () => {
    const longSamples = Array.from({ length: 5000 }, (_, i) => (i % 2 === 0 ? 1000 : -1000))
    const path = join(dir, 'long.wav')
    writeFileSync(path, makeWav(longSamples))
    const adapter = new RecordingAdapter()
    const result = await feedWavToAdapter(path, adapter, { paceMs: 0 })
    expect(result.samples).toBe(5000)
    expect(result.chunks).toBe(Math.ceil(5000 / 1600)) // 4 chunks (1600*3 + 200)
    expect(adapter.sent).toHaveLength(4)
    // Concatenated sends equal the original samples exactly.
    const joined: number[] = []
    for (const chunk of adapter.sent) joined.push(...Array.from(chunk))
    expect(joined).toEqual(longSamples)
    // Every send is an Int16Array (adapter contract: s16le framing).
    for (const chunk of adapter.sent) expect(chunk).toBeInstanceOf(Int16Array)
  })

  it('chunkSamples option changes the chunking', async () => {
    const adapter = new RecordingAdapter()
    const result = await feedWavToAdapter(wavPath, adapter, { paceMs: 0, chunkSamples: 3 })
    expect(result.chunks).toBe(Math.ceil(samples.length / 3))
    expect(adapter.sent).toHaveLength(result.chunks)
  })

  it('throws on a missing file', async () => {
    const adapter = new RecordingAdapter()
    await expect(feedWavToAdapter(join(dir, 'missing.wav'), adapter)).rejects.toThrow()
  })
})
