/**
 * Plan step 16(a) (plan-veyra-audit-01.md): the overlay was frameless,
 * non-resizable and never positioned, and its position did not survive
 * restarts.
 *
 * Seams under test (agreed before first test):
 *   1. parseOverlayBounds  -> trust-boundary shape check on the JSON read back
 *      from userData (corrupt/garbage/too-small -> null, never a crash).
 *   2. isOnAnyDisplay      -> a saved rect must still be visible (>=
 *      MIN_VISIBLE_PX overlap with some display's workArea) or it is treated
 *      as lost (monitor unplugged) and the default applies.
 *   3. defaultOverlayBounds/resolveOverlayBounds -> bottom-center default per
 *      state/demo-p2.md's expectation.
 *   4. watchOverlayBounds  -> debounced persistence of move/resize, flush on
 *      close; timers injected so no real waits.
 * The Electron glue (BrowserWindow options, screen.getAllDisplays, fs under
 * userData) is wiring in windows.ts -- verified by typecheck/build here and by
 * the step-18 live pass; not re-tested below the seam.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  BOTTOM_MARGIN_PX,
  DEFAULT_OVERLAY_HEIGHT,
  DEFAULT_OVERLAY_WIDTH,
  MIN_OVERLAY_HEIGHT,
  MIN_OVERLAY_WIDTH,
  defaultOverlayBounds,
  isOnAnyDisplay,
  parseOverlayBounds,
  resolveOverlayBounds,
  watchOverlayBounds,
  type OverlayBounds,
  type Rect
} from '../src/main/overlay-bounds'

const WORK_AREA: Rect = { x: 0, y: 0, width: 1920, height: 1040 } // taskbar excluded

describe('step 16a: parseOverlayBounds trust-boundary check', () => {
  it('accepts a well-formed persisted record', () => {
    expect(parseOverlayBounds({ x: 100, y: 200, width: 640, height: 120 })).toEqual({
      x: 100,
      y: 200,
      width: 640,
      height: 120
    })
  })

  it('rounds fractional values instead of rejecting them', () => {
    const b = parseOverlayBounds({ x: 10.4, y: -3.2, width: 640.9, height: 120 })
    expect(b).toEqual({ x: 10, y: -3, width: 641, height: 120 })
  })

  it('rejects garbage: null, primitives, arrays, missing/non-finite fields', () => {
    for (const raw of [
      null,
      'bounds',
      42,
      [],
      {},
      { x: 'left', y: 0, width: 640, height: 120 },
      { x: 0, y: 0, width: Number.NaN, height: 120 },
      { x: 0, y: 0, width: Infinity, height: 120 },
      { x: 0, y: 0, width: 640 }
    ]) {
      expect(parseOverlayBounds(raw)).toBeNull()
    }
  })

  it('rejects degenerate sizes below the resizable minimums', () => {
    expect(parseOverlayBounds({ x: 0, y: 0, width: 1, height: 1 })).toBeNull()
    expect(
      parseOverlayBounds({ x: 0, y: 0, width: MIN_OVERLAY_WIDTH - 1, height: MIN_OVERLAY_HEIGHT })
    ).toBeNull()
    expect(
      parseOverlayBounds({ x: 0, y: 0, width: MIN_OVERLAY_WIDTH, height: MIN_OVERLAY_HEIGHT })
    ).not.toBeNull()
  })
})

describe('step 16a: placement defaults', () => {
  it('default sits at the bottom-center of the work area', () => {
    const b = defaultOverlayBounds(WORK_AREA)
    expect(b.width).toBe(DEFAULT_OVERLAY_WIDTH)
    expect(b.height).toBe(DEFAULT_OVERLAY_HEIGHT)
    expect(b.x).toBe(Math.round((WORK_AREA.width - DEFAULT_OVERLAY_WIDTH) / 2))
    expect(b.y).toBe(WORK_AREA.height - DEFAULT_OVERLAY_HEIGHT - BOTTOM_MARGIN_PX)
    // Fully inside the work area.
    expect(b.x).toBeGreaterThanOrEqual(WORK_AREA.x)
    expect(b.y).toBeGreaterThanOrEqual(WORK_AREA.y)
    expect(b.x + b.width).toBeLessThanOrEqual(WORK_AREA.x + WORK_AREA.width)
    expect(b.y + b.height).toBeLessThanOrEqual(WORK_AREA.y + WORK_AREA.height)
  })

  it('default shrinks to fit a tiny work area', () => {
    const tiny: Rect = { x: 8, y: 8, width: 400, height: 300 }
    const b = defaultOverlayBounds(tiny)
    expect(b.width).toBeLessThanOrEqual(400)
    expect(b.height).toBeLessThanOrEqual(300)
    expect(b.x).toBeGreaterThanOrEqual(tiny.x)
    expect(b.y).toBeGreaterThanOrEqual(tiny.y)
  })

  it('resolve falls back to the default when nothing valid is persisted', () => {
    const fallback = resolveOverlayBounds(null, [WORK_AREA], WORK_AREA)
    expect(fallback).toEqual(defaultOverlayBounds(WORK_AREA))
    expect(resolveOverlayBounds('junk', [WORK_AREA], WORK_AREA)).toEqual(fallback)
  })

  it('resolve keeps a valid persisted position', () => {
    const saved: OverlayBounds = { x: 10, y: 20, width: 500, height: 100 }
    expect(resolveOverlayBounds(saved, [WORK_AREA], WORK_AREA)).toEqual(saved)
  })

  it('resolve treats an off-screen / mostly-lost window as unpersisted', () => {
    // Entirely outside any display.
    const farAway: OverlayBounds = { x: 50_000, y: 50_000, width: 640, height: 120 }
    expect(resolveOverlayBounds(farAway, [WORK_AREA], WORK_AREA)).toEqual(
      defaultOverlayBounds(WORK_AREA)
    )
    // Only a sliver visible (< MIN_VISIBLE_PX on both axes): effectively lost.
    const sliver: OverlayBounds = {
      x: WORK_AREA.x + WORK_AREA.width - 5,
      y: 0,
      width: 640,
      height: 120
    }
    expect(isOnAnyDisplay(sliver, [WORK_AREA])).toBe(false)
    // Comfortably visible: kept.
    expect(isOnAnyDisplay(defaultOverlayBounds(WORK_AREA), [WORK_AREA])).toBe(true)
  })
})

describe('step 16a: watchOverlayBounds debounced persistence', () => {
  function fakeWin(initial: OverlayBounds): {
    on(event: string, listener: () => void): unknown
    getBounds(): OverlayBounds
    setBounds(b: OverlayBounds): void
    fire(event: string): void
  } {
    const state = { bounds: initial }
    const handlers = new Map<string, () => void>()
    return {
      on(event: string, listener: () => void): unknown {
        handlers.set(event, listener)
        return null
      },
      getBounds(): OverlayBounds {
        return state.bounds
      },
      setBounds(b: OverlayBounds): void {
        state.bounds = b
      },
      fire(event: string): void {
        handlers.get(event)?.()
      }
    }
  }

  function injectableTimers(): {
    schedule: (fn: () => void, ms: number) => number
    cancel: (t: number) => void
    runPending: () => void
    pendingCount: () => number
    delays: number[]
  } {
    let seq = 0
    const pending = new Map<number, () => void>()
    const delays: number[] = []
    return {
      schedule(fn: () => void, ms: number): number {
        seq += 1
        delays.push(ms)
        pending.set(seq, fn)
        return seq
      },
      cancel(t: number): void {
        pending.delete(t)
      },
      runPending(): void {
        for (const fn of [...pending.values()]) fn()
        pending.clear()
      },
      pendingCount: () => pending.size,
      delays
    }
  }

  const BOUNDS_A: OverlayBounds = { x: 1, y: 2, width: 640, height: 120 }
  const BOUNDS_B: OverlayBounds = { x: 30, y: 40, width: 640, height: 120 }

  it('collapses a burst of move/resize events into one save with the LATEST bounds', () => {
    const win = fakeWin(BOUNDS_A)
    const timers = injectableTimers()
    const save = vi.fn()
    watchOverlayBounds(win, save, {
      delayMs: 500,
      schedule: timers.schedule,
      cancel: timers.cancel
    })

    win.fire('move')
    win.fire('move')
    win.setBounds(BOUNDS_B)
    win.fire('resize')

    expect(save).not.toHaveBeenCalled()
    expect(timers.pendingCount()).toBe(1) // debounced, not queued per event
    timers.runPending()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(BOUNDS_B)
    // Every event re-arms ONE trailing 500ms timer (previous cancelled).
    expect(timers.delays).toEqual([500, 500, 500])
  })

  it('flushes immediately on close so a quick move+quit is not lost', () => {
    const win = fakeWin(BOUNDS_B)
    const save = vi.fn()
    const timers = injectableTimers()
    watchOverlayBounds(win, save, { schedule: timers.schedule, cancel: timers.cancel })
    win.fire('close')
    expect(save).toHaveBeenCalledWith(BOUNDS_B)
    timers.runPending() // the pending debounce must have been cancelled...
    expect(save).toHaveBeenCalledTimes(1) // ...not double-saved
  })

  it('a throwing save never propagates into the window event loop', () => {
    const win = fakeWin(BOUNDS_A)
    const timers = injectableTimers()
    watchOverlayBounds(
      win,
      () => {
        throw new Error('disk full')
      },
      { schedule: timers.schedule, cancel: timers.cancel }
    )
    win.fire('move')
    expect(() => timers.runPending()).not.toThrow()
  })
})
