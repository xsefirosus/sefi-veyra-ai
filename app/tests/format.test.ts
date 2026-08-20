import { describe, expect, it } from 'vitest'
import { downsample, float32ToInt16 } from '../src/shared/audio/format'

/**
 * Seams under test (pre-agreed, plan step 17):
 *   1. float32ToInt16 -- the adapter-seam conversion (renderer float PCM ->
 *      adapter int16): int16 bounds [-32768, 32767], full-range scaling
 *      (-1 -> -32768, +1 -> 32767), length preservation.
 *   2. downsample -- 48k/44.1k -> 16k linear resample: output length ratio,
 *      interpolation correctness, identity at equal rates, rate validation.
 * Scope: src/shared/audio/format.ts only.
 */

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
    for (let i = 0; i < out.length; i++) {
      // Position i of the output corresponds to ramp position i * 3; a linear
      // ramp's interpolated value equals the ramp value at that position.
      expect(out[i]).toBeCloseTo(ramp[Math.min(i * 3, ramp.length - 1)], 5)
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
