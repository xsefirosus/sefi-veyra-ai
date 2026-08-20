import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  ENERGY_THRESHOLD,
  computeRms,
  energyCapturedFor,
  writeLoopbackCheck,
  type LoopbackCheckResult
} from '../src/main/capture/loopback-energy'

/**
 * Seams under test (pre-agreed, plan step 19):
 *   1. computeRms -- the RMS math behind scripts/check-loopback.ps1's
 *      "assert captured RMS > 0.001": a full-scale sine measures A/sqrt(2),
 *      silence measures ~0, empty input measures 0.
 *   2. energyCapturedFor -- the plan verdict (RMS > 0.001, finite).
 *   3. writeLoopbackCheck -- the state/loopback-check.json verdict shape
 *      {energyCaptured, rms, samples, durationMs[, error]}.
 * Scope: src/main/capture/loopback-energy.ts only. The end-to-end capture
 * itself (tone -> getDisplayMedia -> RMS) is scripts/check-loopback.ps1, run
 * outside vitest.
 */

/** Full-scale sine at amplitude A over n samples at 16 kHz. */
function sineWave(A: number, n: number, freqHz = 440, sampleRate = 16000): Int16Array {
  const samples = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    samples[i] = Math.round(A * 32768 * Math.sin((2 * Math.PI * freqHz * i) / sampleRate))
  }
  return samples
}

describe('computeRms (full-scale-normalized)', () => {
  it('a sine at amplitude A measures ~A/sqrt(2)', () => {
    const A = 0.25
    const rms = computeRms(sineWave(A, 48000))
    const expected = A / Math.sqrt(2)
    expect(rms).toBeGreaterThan(expected * 0.98)
    expect(rms).toBeLessThan(expected * 1.02)
  })

  it('silence measures 0 and empty input measures 0', () => {
    expect(computeRms(new Int16Array(48000))).toBe(0)
    expect(computeRms(new Int16Array(0))).toBe(0)
  })

  it('a quiet-but-real signal is still far above the 0.001 threshold', () => {
    // 1% amplitude (~ -40 dBFS): RMS ~ 0.007, an order of magnitude over 0.001.
    const rms = computeRms(sineWave(0.01, 48000))
    expect(rms).toBeGreaterThan(ENERGY_THRESHOLD * 5)
  })
})

describe('energyCapturedFor (plan verdict: RMS > 0.001)', () => {
  it('classifies around the threshold and rejects non-finite', () => {
    expect(energyCapturedFor(0)).toBe(false)
    expect(energyCapturedFor(0.0009)).toBe(false)
    expect(energyCapturedFor(0.0011)).toBe(true)
    expect(energyCapturedFor(0.177)).toBe(true)
    expect(energyCapturedFor(NaN)).toBe(false)
    expect(energyCapturedFor(Infinity)).toBe(false)
  })
})

describe('writeLoopbackCheck (state/loopback-check.json shape)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'veyra-loopback-energy-'))
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes the real measured RMS and the energyCaptured verdict', () => {
    const path = join(dir, 'loopback-check.json')
    const result: LoopbackCheckResult = {
      energyCaptured: true,
      rms: 0.177,
      samples: 48000,
      durationMs: 3000
    }
    writeLoopbackCheck(path, result)
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as LoopbackCheckResult
    expect(parsed).toEqual(result)
  })

  it('records energyCaptured false with the error field on a failed capture', () => {
    const path = join(dir, 'loopback-check-error.json')
    writeLoopbackCheck(path, {
      energyCaptured: false,
      rms: 0,
      samples: 0,
      durationMs: 0,
      error: 'timeout'
    })
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as LoopbackCheckResult
    expect(parsed.energyCaptured).toBe(false)
    expect(parsed.rms).toBe(0)
    expect(parsed.error).toBe('timeout')
  })
})