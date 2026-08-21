import { describe, expect, it } from 'vitest'
import { labelForSource, resolveSpeakerLabel } from '../src/shared/stt/speaker-label'

/**
 * Seams under test (pre-agreed, plan steps 20 + audit step 10):
 *   1. labelForSource -- the pure source -> speaker mapping: 'mic' -> 'me',
 *      'loopback' -> 'other', any other value -> 'other' (conservative: an
 *      unrecognized source is never labeled the operator).
 *   2. resolveSpeakerLabel -- diarization-aware resolver: prefers wlk
 *      `lines[].speaker` when present, resolves to me/other using capture
 *      source as tiebreaker (mic dominant -> me), keeps labelForSource as
 *      fallback when diarization absent, unknown stays conservative (other).
 * Scope: src/shared/stt/speaker-label.ts only. Main applies it at the capture
 * sites (src/main/index.ts) when constructing events before broadcast; that
 * Electron-bound wiring is exercised end-to-end by step 21 (e2e harness).
 */

describe('labelForSource (plan step 20)', () => {
  it("maps the mic capture track to 'me'", () => {
    expect(labelForSource('mic')).toBe('me')
  })

  it("maps the loopback capture track to 'other'", () => {
    expect(labelForSource('loopback')).toBe('other')
  })

  it('maps any unknown source to other (conservative default)', () => {
    expect(labelForSource('unknown')).toBe('other')
    expect(labelForSource('line-in')).toBe('other')
    expect(labelForSource('')).toBe('other')
    expect(labelForSource('MIC')).toBe('other') // exact match only, case-sensitive
  })

  it('returns only the two label values for every input class', () => {
    const labels = ['mic', 'loopback', 'unknown', '', 'bluetooth', 'MIC'].map(labelForSource)
    expect(labels.every((l) => l === 'me' || l === 'other')).toBe(true)
  })
})

describe('resolveSpeakerLabel (audit step 10)', () => {
  it('diarization present wins: valid speakerId resolves via source tiebreaker', () => {
    // Real fixture: lines[0].speaker === 1 on a final. Mic dominant -> me, loopback -> other.
    expect(resolveSpeakerLabel(1, 'mic')).toBe('me')
    expect(resolveSpeakerLabel(0, 'mic')).toBe('me')
    expect(resolveSpeakerLabel(1, 'loopback')).toBe('other')
    expect(resolveSpeakerLabel(2, 'loopback')).toBe('other')
    // Unknown source with valid diarization stays conservative
    expect(resolveSpeakerLabel(1, 'unknown')).toBe('other')
  })

  it('diarization wins over source for mic bleed: wlk unknown sentinel overrides mic', () => {
    // -2 is wlk's sentinel for no speaker (observed in fixture for empty lines).
    // Mic would normally be 'me', but diarization says unknown -> conservative 'other'.
    expect(resolveSpeakerLabel(-2, 'mic')).toBe('other')
    expect(resolveSpeakerLabel(-2, 'loopback')).toBe('other')
  })

  it('absent diarization falls back to labelForSource', () => {
    expect(resolveSpeakerLabel(undefined, 'mic')).toBe('me')
    expect(resolveSpeakerLabel(undefined, 'loopback')).toBe('other')
    expect(resolveSpeakerLabel(null, 'mic')).toBe('me')
    expect(resolveSpeakerLabel(null, 'loopback')).toBe('other')
    // Non-numeric is treated as absent
    expect(resolveSpeakerLabel('1' as unknown as number, 'mic')).toBe('me')
    expect(resolveSpeakerLabel({} as unknown as number, 'loopback')).toBe('other')
  })

  it('unknown stays conservative (other) for negative sentinels; non-finite falls back', () => {
    expect(resolveSpeakerLabel(-1, 'mic')).toBe('other')
    expect(resolveSpeakerLabel(-99, 'mic')).toBe('other')
    expect(resolveSpeakerLabel(NaN, 'mic')).toBe('me') // NaN is non-finite -> absent -> fallback mic=me
    expect(resolveSpeakerLabel(Infinity, 'mic')).toBe('me') // same: absent -> fallback
    // But -2 sentinel is always other regardless of source
    expect(resolveSpeakerLabel(-2, 'unknown')).toBe('other')
  })

  it('returns only me|other for every diarization class', () => {
    const cases: Array<[unknown, string]> = [
      [1, 'mic'],
      [1, 'loopback'],
      [-2, 'mic'],
      [undefined, 'mic'],
      [undefined, 'loopback'],
      [null, 'mic'],
      [-1, 'mic'],
      [0, 'mic']
    ]
    const labels = cases.map(([id, src]) => resolveSpeakerLabel(id, src))
    expect(labels.every((l) => l === 'me' || l === 'other')).toBe(true)
  })
})
