/**
 * Pure audio format helpers (plan step 17). Shared by BOTH processes:
 *   - renderer (src/renderer/src/capture/mic-capture.ts): downsamples the
 *     worklet's Float32Array frames from the AudioContext rate to 16 kHz before
 *     IPC;
 *   - main (src/main/capture/audio-input.ts): converts the Float32Array chunk
 *     to Int16Array at the adapter seam (adapter.send takes int16).
 * No DOM, no Node: this module is imported by the renderer bundle, the main
 * bundle, and vitest alike.
 */

/**
 * Float32 [-1, 1] -> Int16Array [-32768, 32767], standard 0x8000 scaling with
 * hard clipping so -1.0 maps to -32768 and +1.0 maps to 32767 (full int16
 * range). Non-finite samples (NaN/Infinity) would silently coerce to 0 when
 * written into an Int16Array; zero them explicitly instead. The trust boundary
 * (main's createPcmSink) rejects non-finite chunks BEFORE this is called.
 */
export function float32ToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const v = input[i]
    const clamped = Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0
    // Scale by 0x8000 (full 16-bit range) then clamp the RESULT: the raw
    // product for +1.0 is 32768, which overflows an Int16Array write and wraps
    // to -32768 -- the clamp keeps the max at 32767.
    out[i] = Math.max(-32768, Math.min(32767, Math.round(clamped * 0x8000)))
  }
  return out
}

/**
 * Linear-interpolation resample. The capture path runs the AudioContext at its
 * native rate (typically 48 kHz / 44.1 kHz) and resamples to 16 kHz here, so
 * the downstream adapter always sees the rate it expects. Output length is
 * round(input.length * toRate / fromRate); for 48k -> 16k that is 1/3 of the
 * input (the plan's "output length ratio"). When the rates are equal the input
 * is copied unchanged. Throws on non-positive rates.
 */
export function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (!(fromRate > 0) || !(toRate > 0)) {
    throw new Error(`audio/format: rates must be positive (got ${fromRate} -> ${toRate})`)
  }
  if (input.length === 0) return new Float32Array(0)
  if (fromRate === toRate) return input.slice()
  const ratio = toRate / fromRate
  const out = new Float32Array(Math.max(1, Math.round(input.length * ratio)))
  for (let i = 0; i < out.length; i++) {
    // Position of output sample i in the input domain, then linear interpolation
    // between the two bracketing input samples.
    const pos = i / ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = pos - i0
    out[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return out
}
