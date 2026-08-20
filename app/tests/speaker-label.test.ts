import { describe, expect, it } from 'vitest'
import { labelForSource } from '../src/shared/stt/speaker-label'

/**
 * Seams under test (pre-agreed, plan step 20):
 *   1. labelForSource -- the pure source -> speaker mapping: 'mic' -> 'me',
 *      'loopback' -> 'other', any other value -> 'other' (conservative: an
 *      unrecognized source is never labeled the operator).
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
