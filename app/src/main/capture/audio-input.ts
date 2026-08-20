/**
 * Main-process audio input (plan step 17). Two jobs:
 *
 * 1. `createPcmSink` -- the ipcMain 'pcm' handler target. The renderer sends
 *    Float32Array chunks (16 kHz, already downsampled by mic-capture.ts); the
 *    sink validates the chunk at the trust boundary (the renderer is not
 *    trusted) and converts float32 -> int16 via the shared format module, then
 *    calls adapter.send(int16) -- the SAME adapter.send path the wlk server
 *    consumes (step 16 framing).
 *
 * 2. `readWavPcm` + `feedWavToAdapter` -- the VEYRA_TEST_AUDIO seam (steps
 *    21-22): main reads a WAV path from the env var, parses the header + data
 *    itself (no new deps -- the step-14 test file is 16 kHz mono 16-bit PCM),
 *    and feeds int16 chunks through the SAME adapter.send path instead of
 *    renderer PCM. `feedWavToAdapter` is exported as the clean function step 21
 *    calls directly.
 *
 * The step-14 WAV contract this parser enforces: RIFF/WAVE, fmt chunk with
 * audioFormat 1 (PCM), 16 bits per sample, 1 channel. Anything else throws
 * loudly (a wrong-format file fed silently would corrupt the transcript).
 */

import { readFileSync } from 'fs'
import { float32ToInt16 } from '../../shared/audio/format'
import type { SttAdapter } from '../../shared/stt/stt-adapter'

/** Cap on one IPC PCM chunk (~1M samples = ~62 s at 16 kHz, ~4 MB float). */
export const MAX_CHUNK_SAMPLES = 1_000_000

export interface WavInfo {
  sampleRate: number
  channels: number
  bitsPerSample: number
}

/** Parse the RIFF/WAVE header of a 16-bit mono PCM WAV. One chunk walk. */
export function parseWavHeader(buf: Buffer): WavInfo & { dataLength: number; dataOffset: number } {
  if (buf.length < 44) throw new Error('audio-input: WAV too short to have a header')
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') {
    throw new Error('audio-input: not a RIFF/WAVE file')
  }
  let info: WavInfo | null = null
  let dataLength = 0
  let dataOffset = 0
  let offset = 12
  while (offset + 8 <= buf.length) {
    const id = buf.toString('latin1', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const body = offset + 8
    if (body + size > buf.length) break // truncated chunk; fail below if fmt/data missing
    if (id === 'fmt ') {
      const audioFormat = buf.readUInt16LE(body)
      const channels = buf.readUInt16LE(body + 2)
      const sampleRate = buf.readUInt32LE(body + 4)
      const bitsPerSample = buf.readUInt16LE(body + 14)
      if (audioFormat !== 1) {
        throw new Error(`audio-input: WAV is not PCM (audioFormat=${audioFormat})`)
      }
      info = { sampleRate, channels, bitsPerSample }
    } else if (id === 'data') {
      dataLength = size
      dataOffset = body
    }
    offset = body + size + (size % 2) // chunks are word-aligned (odd size pads 1 byte)
  }
  if (info === null) throw new Error('audio-input: WAV has no fmt chunk')
  if (info.bitsPerSample !== 16) {
    throw new Error(`audio-input: WAV is not 16-bit (bitsPerSample=${info.bitsPerSample})`)
  }
  if (info.channels !== 1) {
    throw new Error(`audio-input: WAV is not mono (channels=${info.channels})`)
  }
  if (dataLength === 0) throw new Error('audio-input: WAV has no data chunk')
  if (dataLength % 2 !== 0) throw new Error('audio-input: WAV data length is not 16-bit aligned')
  return { ...info, dataLength, dataOffset }
}

/** Read a 16 kHz mono 16-bit PCM WAV and return its samples as Int16Array. */
export function readWavPcm(path: string): Int16Array {
  const buf = readFileSync(path)
  const { dataLength, dataOffset } = parseWavHeader(buf)
  const samples = new Int16Array(dataLength / 2)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = buf.readInt16LE(dataOffset + i * 2)
  }
  return samples
}

export interface FeedWavOptions {
  /** Samples per adapter.send() call. Default 1600 = 100 ms at 16 kHz (probe-like pacing). */
  chunkSamples?: number
  /** Sleep between chunks (real-time pacing for latency e2e). 0 = no delay. */
  paceMs?: number
}

/**
 * VEYRA_TEST_AUDIO seam (steps 21-22): feed a WAV file through the SAME
 * adapter.send(int16) path the renderer PCM takes. Assumes the adapter is
 * already connected; lifecycle (connect/close) is the caller's.
 */
export async function feedWavToAdapter(
  path: string,
  adapter: SttAdapter,
  opts: FeedWavOptions = {}
): Promise<{ samples: number; chunks: number }> {
  const pcm = readWavPcm(path)
  const chunkSamples = opts.chunkSamples ?? 1600
  const paceMs = opts.paceMs ?? 100
  let chunks = 0
  for (let off = 0; off < pcm.length; off += chunkSamples) {
    adapter.send(pcm.subarray(off, off + chunkSamples))
    chunks += 1
    if (paceMs > 0 && off + chunkSamples < pcm.length) {
      await new Promise((r) => setTimeout(r, paceMs))
    }
  }
  return { samples: pcm.length, chunks }
}

/** Shape-validate an IPC PCM chunk; returns a finite Float32Array or throws. */
function toFiniteFloat32(chunk: unknown): Float32Array {
  let f32: Float32Array
  if (chunk instanceof Float32Array) {
    f32 = chunk
  } else if (chunk instanceof ArrayBuffer) {
    // Electron IPC may deliver a typed array as its underlying ArrayBuffer.
    f32 = new Float32Array(chunk)
  } else {
    throw new Error('audio-input: PCM chunk is not a Float32Array/ArrayBuffer')
  }
  if (f32.length === 0) throw new Error('audio-input: empty PCM chunk')
  if (f32.length > MAX_CHUNK_SAMPLES) {
    throw new Error(`audio-input: PCM chunk exceeds ${MAX_CHUNK_SAMPLES} samples`)
  }
  for (let i = 0; i < f32.length; i++) {
    if (!Number.isFinite(f32[i])) {
      throw new Error(`audio-input: non-finite sample at index ${i}`)
    }
  }
  return f32
}

/**
 * Build the ipcMain 'pcm' handler body for one adapter: validate the untrusted
 * renderer chunk, convert float32 -> int16 (shared format module), and call
 * adapter.send(int16) -- never swallow a validation error, the caller logs it.
 */
export function createPcmSink(adapter: SttAdapter): (chunk: unknown) => void {
  return (chunk: unknown): void => {
    const f32 = toFiniteFloat32(chunk)
    adapter.send(float32ToInt16(f32))
  }
}
