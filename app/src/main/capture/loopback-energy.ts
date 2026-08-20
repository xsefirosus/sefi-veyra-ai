/**
 * Loopback-capture energy measurement (plan step 19): the pure math behind
 * scripts/check-loopback.ps1's assertion. The check plays a 440 Hz tone WAV
 * (System.Media.SoundPlayer) while the app captures WASAPI loopback
 * (getDisplayMedia audio -> AudioWorklet -> 'pcm-loopback' -> int16 in main);
 * main accumulates the int16 samples and this module turns them into the
 * state/loopback-check.json verdict {energyCaptured, rms, ...}.
 *
 * RMS is normalized to full scale (sample / 32768), so a captured tone at
 * amplitude 0.25 measures ~0.177 and the plan's > 0.001 threshold is
 * comfortably above silence (muted endpoint, no render device) while staying
 * far below any real signal.
 */
import { writeFileSync } from 'fs'

/** Plan step 19: "assert captured RMS > 0.001". */
export const ENERGY_THRESHOLD = 0.001

export interface LoopbackCheckResult {
  energyCaptured: boolean
  /** Full-scale-normalized RMS of the captured loopback samples. */
  rms: number
  samples: number
  durationMs: number
  /** Set only when the check was aborted (timeout / capture failure). */
  error?: string
}

/** Full-scale-normalized RMS of an int16 PCM buffer; 0 for empty input. */
export function computeRms(samples: Int16Array): number {
  if (samples.length === 0) return 0
  let sumSq = 0
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] / 32768
    sumSq += s * s
  }
  return Math.sqrt(sumSq / samples.length)
}

/** Plan verdict: loopback energy was captured iff RMS > threshold (0.001). */
export function energyCapturedFor(rms: number, threshold: number = ENERGY_THRESHOLD): boolean {
  return Number.isFinite(rms) && rms > threshold
}

/** Write the check verdict JSON (state/loopback-check.json). */
export function writeLoopbackCheck(file: string, result: LoopbackCheckResult): void {
  writeFileSync(file, JSON.stringify(result, null, 2) + '\n')
}