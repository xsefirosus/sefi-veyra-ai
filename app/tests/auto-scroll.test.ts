/**
 * Plan step 16(d) (plan-veyra-audit-01.md): the transcript list never
 * auto-scrolled, so new lines appeared out of view.
 *
 * Seams under test (agreed before first test):
 *   isNearBottom -> the pin-to-bottom predicate: pinned while the scroll
 *   container is at/near the bottom, unpinned once the user scrolled up beyond
 *   the threshold. The effect/onScroll wiring lives in TranscriptPanel
 *   (build + step-18 live pass); only the math is tested here.
 */
import { describe, expect, it } from 'vitest'
import { PIN_THRESHOLD_PX, isNearBottom } from '../src/renderer/src/transcript/auto-scroll'

describe('step 16d: pin-to-bottom predicate', () => {
  const H = 400 // content height
  const V = 150 // viewport height

  it('is pinned exactly at the bottom', () => {
    expect(isNearBottom(H - V, V, H)).toBe(true)
  })

  it('stays pinned within the threshold', () => {
    expect(isNearBottom(H - V - 5, V, H)).toBe(true)
    expect(isNearBottom(H - V - PIN_THRESHOLD_PX, V, H)).toBe(true)
  })

  it('unpins once the user has scrolled up beyond the threshold', () => {
    expect(isNearBottom(H - V - PIN_THRESHOLD_PX - 1, V, H)).toBe(false)
    expect(isNearBottom(0, V, H)).toBe(false) // hard at the top
  })

  it('treats a container with no overflow as always pinned', () => {
    expect(isNearBottom(0, 300, 200)).toBe(true) // scrollHeight < clientHeight
  })

  it('honours a custom threshold', () => {
    // distance from bottom = 250 - 100 - 100 = 50
    expect(isNearBottom(100, 100, 250, 40)).toBe(false)
    expect(isNearBottom(100, 100, 250, 50)).toBe(true)
    expect(isNearBottom(100, 100, 250, 10)).toBe(false)
  })
})
