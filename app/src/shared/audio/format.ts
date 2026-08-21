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
 * Linear-interpolation resample with an anti-aliasing prefilter (audit step
 * 15). The capture path runs the AudioContext at its native rate (typically
 * 48 kHz / 44.1 kHz) and resamples to 16 kHz here, so the downstream adapter
 * always sees the rate it expects. Output length is
 * round(input.length * toRate / fromRate); for 48k -> 16k that is 1/3 of the
 * input (the plan's "output length ratio"). When the rates are equal the input
 * is copied unchanged. Throws on non-positive rates.
 *
 * ## Anti-aliasing (audit step 15)
 * Naive decimation folds every component above the TARGET Nyquist back into
 * the band as aliasing noise -- at 48k -> 16k everything from 8-24 kHz lands
 * on top of speech, degrading STT accuracy on exactly the consonants that
 * carry intelligibility. So when actually downsampling (toRate < fromRate),
 * a linear-phase Hamming-windowed-sinc FIR low-pass runs BEFORE the
 * interpolation/decimation loop. Design constants:
 *   - cutoff = 0.45 * toRate (7.2 kHz for a 16 kHz target): keeps the whole
 *     speech band while leaving margin to Nyquist for the transition band;
 *   - 31 taps, Hamming window: >= ~50 dB stopband sidelobes regardless of
 *     length, narrow enough transition at 31 taps, and short enough that the
 *     per-call edge transient stays a few output samples -- this function is
 *     PURE and stateless by contract (shared renderer+main, called per worklet
 *     frame), so each call's first ~taps/ratio outputs sit in the filter's
 *     edge transient; a stateful design would change every call site.
 * Upsampling (toRate > fromRate) cannot fold, so no filter runs there.
 */
export function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (!(fromRate > 0) || !(toRate > 0)) {
    throw new Error(`audio/format: rates must be positive (got ${fromRate} -> ${toRate})`)
  }
  if (input.length === 0) return new Float32Array(0)
  if (fromRate === toRate) return input.slice()
  const taps = lowPassCoefficients(fromRate, toRate)
  const src = taps === null ? input : firFilter(input, taps)
  const ratio = toRate / fromRate
  const out = new Float32Array(Math.max(1, Math.round(src.length * ratio)))
  for (let i = 0; i < out.length; i++) {
    // Position of output sample i in the (filtered) input domain, then linear
    // interpolation between the two bracketing input samples.
    const pos = i / ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, src.length - 1)
    const frac = pos - i0
    out[i] = src[i0] * (1 - frac) + src[i1] * frac
  }
  return out
}

/**
 * Hamming-windowed sinc low-pass coefficients (odd length, linear phase,
 * normalized to unity DC gain), or null when NO anti-alias filter applies:
 * equal rates never reach here, upsampling cannot fold, and a degenerate
 * normalized cutoff gets no filter rather than a broken one.
 */
function lowPassCoefficients(fromRate: number, toRate: number): Float64Array | null {
  if (toRate >= fromRate) return null
  const taps = 31
  // Normalized cutoff in cycles/sample: 90% of the target Nyquist.
  const fc = 0.45 * (toRate / fromRate)
  if (!(fc > 0) || fc >= 0.5) return null
  const mid = (taps - 1) / 2
  const h = new Float64Array(taps)
  let sum = 0
  for (let i = 0; i < taps; i++) {
    const k = i - mid
    const sinc = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k)
    const hamming = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1))
    h[i] = sinc * hamming
    sum += h[i]
  }
  for (let i = 0; i < taps; i++) h[i] /= sum
  return h
}

/**
 * Centered FIR convolution, edge-clamped indexing (pure, one pass). The clamp
 * holds the boundary samples steady instead of wrapping garbage in; the first
 * and last ~(taps-1)/2 inputs are the only edge-transient region.
 */
function firFilter(input: Float32Array, h: Float64Array): Float32Array {
  const mid = (h.length - 1) / 2
  const out = new Float32Array(input.length)
  for (let i = 0; i < input.length; i++) {
    let acc = 0
    for (let j = 0; j < h.length; j++) {
      let idx = i + j - mid
      if (idx < 0) idx = 0
      else if (idx >= input.length) idx = input.length - 1
      acc += h[j] * input[idx]
    }
    out[i] = acc
  }
  return out
}
