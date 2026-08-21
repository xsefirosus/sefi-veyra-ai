import { describe, expect, it } from 'vitest'
import { downsample, float32ToInt16 } from '../src/shared/audio/format'

/**
 * Seams under test (pre-agreed; step 17 + audit step 15):
 *   1. float32ToInt16 -- the adapter-seam conversion (renderer float PCM ->
 *      adapter int16): int16 bounds [-32768, 32767], full-range scaling
 *      (-1 -> -32768, +1 -> 32767), length preservation.
 *   2. downsample -- 48k/44.1k -> 16k resample: output length ratio,
 *      interpolation correctness, identity at equal rates, rate validation.
 *      Audit step 15 adds the anti-aliasing contract: a tone ABOVE the target
 *      Nyquist must ATTENUATE, not fold back into the band (alias rejection);
 *      an in-band tone must survive (guard against an over-aggressive filter).
 * Scope: src/shared/audio/format.ts only.
 */

/**
 * Test-only Goertzel probe: normalized power of `freq` in `x` -- ~1.0 for a
 * full-scale sine aligned to the window, ~0 for its absence. Lives here (not
 * in production code): spectral analysis is a measurement tool for THIS
 * assertion, not part of the audio pipeline.
 */
function goertzelPower(x: Float32Array, rate: number, freq: number): number {
  const k = Math.round((freq * x.length) / rate)
  const w = (2 * Math.PI * k) / x.length
  const coeff = 2 * Math.cos(w)
  let s1 = 0
  let s2 = 0
  for (let i = 0; i < x.length; i++) {
    const s0 = x[i] + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  const real = s1 - Math.cos(w) * s2
  const imag = Math.sin(w) * s2
  const halfN = x.length / 2
  return (real * real + imag * imag) / (halfN * halfN)
}

describe('float32ToInt16', () => {
  it('scales the full float32 range onto int16 bounds', () => {
    const out = float32ToInt16(new Float32Array([-1, -0.5, 0, 0.5, 1]))
    expect(Array.from(out)).toEqual([-32768, -16384, 0, 16384, 32767])
  })

  it('clips out-of-range samples to int16 bounds', () => {
    const out = float32ToInt16(new Float32Array([-2, 2, 1.0001, -1.0001]))
    expect(Array.from(out)).toEqual([-32768, 32767, 32767, -32768])
  })

  it('preserves length and never exceeds int16 bounds', () => {
    // Deterministic pseudo-random-ish sweep across the full [-1, 1] range.
    const input = new Float32Array(10_000)
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin(i * 0.013) * (i % 2 === 0 ? 1 : -1) // in [-1, 1]
    }
    const out = float32ToInt16(input)
    expect(out.length).toBe(input.length)
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(-32768)
      expect(out[i]).toBeLessThanOrEqual(32767)
    }
  })

  it('zeros non-finite samples instead of silently corrupting them', () => {
    const out = float32ToInt16(new Float32Array([NaN, Infinity, -Infinity, 0]))
    expect(Array.from(out)).toEqual([0, 0, 0, 0])
  })
})

describe('downsample (linear)', () => {
  it('48k -> 16k output length is 1/3 of the input (plan length ratio)', () => {
    const input = new Float32Array(48_000)
    const out = downsample(input, 48_000, 16_000)
    expect(out.length).toBe(Math.round(48_000 / 3)) // 16000, exactly N/3
    expect(out.length).toBe(16_000)
  })

  it('44.1k -> 16k output length matches the rate ratio', () => {
    const input = new Float32Array(44_100)
    const out = downsample(input, 44_100, 16_000)
    expect(out.length).toBe(Math.round((44_100 * 16_000) / 44_100)) // 16000
    expect(out.length).toBe(16_000)
    // General form: length == round(N * to/from).
    const out2 = downsample(new Float32Array(12345), 44_100, 16_000)
    expect(out2.length).toBe(Math.round((12345 * 16_000) / 44_100))
  })

  it('interpolates linearly (a linear ramp resamples to itself)', () => {
    const ramp = new Float32Array(480)
    for (let i = 0; i < ramp.length; i++) ramp[i] = i / 480 // 0 -> ~1
    const out = downsample(ramp, 48_000, 16_000)
    expect(out.length).toBe(160)
    // Audit step 15: a symmetric linear-phase FIR now precedes decimation.
    // A weighted average of a LINEAR signal with symmetric weights equals the
    // value at the window center, so steady-state outputs still resample the
    // ramp exactly -- but where the window hangs off an array end the clamp
    // makes the average asymmetric (the FIR edge transient, a few output
    // samples wide at each end). Steady state keeps 1e-5; edges keep a tight
    // bound instead of exactness.
    const steadyFrom = 6 // half FIR window (15 input samples) ~ 5 output samples
    for (let i = steadyFrom; i < out.length - steadyFrom; i++) {
      expect(out[i]).toBeCloseTo(ramp[Math.min(i * 3, ramp.length - 1)], 5)
    }
    for (let i = 0; i < steadyFrom; i++) {
      expect(Math.abs(out[i] - ramp[i * 3])).toBeLessThan(0.005) // < half a ramp step
    }
    for (let i = out.length - steadyFrom; i < out.length; i++) {
      expect(Math.abs(out[i] - ramp[Math.min(i * 3, ramp.length - 1)])).toBeLessThan(0.005)
    }
  })

  it('leaves a constant signal constant', () => {
    const out = downsample(new Float32Array(9000).fill(0.5), 48_000, 16_000)
    expect(out.length).toBe(3000)
    for (const v of out) expect(v).toBe(0.5)
  })

  it('is the identity when rates are equal', () => {
    const input = new Float32Array([0.1, -0.2, 0.3])
    const out = downsample(input, 16_000, 16_000)
    // Float32Array stores float32-rounded values (0.1 -> 0.10000000149...);
    // compare per-sample with a tolerance instead of exact float64 literals.
    expect(out).toHaveLength(3)
    for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(input[i], 6)
  })

  it('rejects non-positive rates', () => {
    expect(() => downsample(new Float32Array(10), 0, 16_000)).toThrow(/positive/)
    expect(() => downsample(new Float32Array(10), 48_000, -1)).toThrow(/positive/)
  })
})

describe('downsample anti-aliasing (audit step 15)', () => {
  // Steady-state analysis window: skip the first 0.1 s (FIR edge transient at
  // the array boundary), analyze the following 1 s. Window lengths are whole
  // seconds of the TARGET rate so every probed frequency has an integer number
  // of cycles in the Goertzel window (no leakage).
  const SKIP = 16_000 / 10
  const WINDOW = 16_000

  it('attenuates a tone above the target Nyquist instead of folding it into the band', () => {
    const input = new Float32Array(48_000 * 10)
    for (let i = 0; i < input.length; i++) {
      // 12 kHz tone: ABOVE the 8 kHz Nyquist of the 16 kHz target. Naive
      // decimation folds it to |16k - 12k| = 4 kHz at nearly full amplitude.
      input[i] = Math.sin((2 * Math.PI * 12_000 * i) / 48_000)
    }
    const out = downsample(input, 48_000, 16_000)
    const aliasPower = goertzelPower(out.subarray(SKIP, SKIP + WINDOW), 16_000, 4_000)
    // Spec: >= 20 dB rejection of the folded component (power < 1%). The naive
    // resampler folds at power ~1.0, so this fails before the prefilter exists.
    expect(aliasPower).toBeLessThan(0.01)
  })

  it('passes an in-band tone through with most of its energy (no over-filtering)', () => {
    const input = new Float32Array(48_000 * 10)
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin((2 * Math.PI * 1_000 * i) / 48_000)
    }
    const out = downsample(input, 48_000, 16_000)
    const passPower = goertzelPower(out.subarray(SKIP, SKIP + WINDOW), 16_000, 1_000)
    // Guard against a degenerate "filter" that zeroes everything to pass the
    // alias test: a 1 kHz tone (speech band, far below cutoff) must keep most
    // of its energy (<= ~6 dB loss).
    expect(passPower).toBeGreaterThan(0.25)
  })
})
