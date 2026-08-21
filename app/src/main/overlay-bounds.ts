/**
 * Plan step 16(a): overlay position/size persistence (plan-veyra-audit-01.md).
 *
 * The overlay was frame: false + resizable: false and never positioned, so it
 * could not be moved or resized and always opened centered. Now: resizable
 * with a drag region (CSS in the renderer), bounds persisted to
 * userData/veyra-overlay-bounds.json, restored on launch, validated on read,
 * with a bottom-center default when nothing valid is persisted (the placement
 * state/demo-p2.md tells users to expect).
 *
 * This module is Electron-free so the logic is unit-testable
 * (tests/overlay-bounds.test.ts); windows.ts supplies BrowserWindow/screen/fs.
 */

export interface OverlayBounds {
  x: number
  y: number
  width: number
  height: number
}

export type Rect = OverlayBounds

export const MIN_OVERLAY_WIDTH = 320
export const MIN_OVERLAY_HEIGHT = 80

/** Default overlay size -- the original 640x120 frame. */
export const DEFAULT_OVERLAY_WIDTH = 640
export const DEFAULT_OVERLAY_HEIGHT = 120
/** Gap kept between the default position and the bottom of the work area. */
export const BOTTOM_MARGIN_PX = 24
/** A persisted rect must overlap some display's workArea by at least this much per axis. */
export const MIN_VISIBLE_PX = 24

/**
 * Trust boundary: the JSON comes back off disk (user- or tamper-editable), so
 * shape-check before use. Corrupt/garbage/degenerate -> null, never a throw.
 */
export function parseOverlayBounds(raw: unknown): OverlayBounds | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>
  const x = v['x']
  const y = v['y']
  const width = v['width']
  const height = v['height']
  if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return null
  }
  const bounds: OverlayBounds = {
    x: Math.round(x as number),
    y: Math.round(y as number),
    width: Math.round(width as number),
    height: Math.round(height as number)
  }
  if (bounds.width < MIN_OVERLAY_WIDTH || bounds.height < MIN_OVERLAY_HEIGHT) return null
  return bounds
}

/** True when at least MIN_VISIBLE_PX of the rect is visible in some work area. */
export function isOnAnyDisplay(bounds: OverlayBounds, workAreas: Rect[]): boolean {
  return workAreas.some((wa) => {
    const overlapX = Math.min(bounds.x + bounds.width, wa.x + wa.width) - Math.max(bounds.x, wa.x)
    const overlapY = Math.min(bounds.y + bounds.height, wa.y + wa.height) - Math.max(bounds.y, wa.y)
    return overlapX >= MIN_VISIBLE_PX && overlapY >= MIN_VISIBLE_PX
  })
}

/** Bottom-center of the given work area -- where demo-p2.md tells users to look. */
export function defaultOverlayBounds(workArea: Rect): OverlayBounds {
  const width = Math.min(DEFAULT_OVERLAY_WIDTH, workArea.width)
  const height = Math.min(DEFAULT_OVERLAY_HEIGHT, workArea.height)
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + workArea.height - height - BOTTOM_MARGIN_PX),
    width,
    height
  }
}

/**
 * Persisted raw -> usable bounds: parsed and still visible keeps its place;
 * anything else (first run, corrupt file, unplugged monitor) gets the
 * bottom-center default for the primary display.
 */
export function resolveOverlayBounds(
  raw: unknown,
  workAreas: Rect[],
  primaryWorkArea: Rect
): OverlayBounds {
  const parsed = parseOverlayBounds(raw)
  if (parsed && isOnAnyDisplay(parsed, workAreas)) return parsed
  return defaultOverlayBounds(primaryWorkArea)
}

/** The surface watchOverlayBounds needs from a BrowserWindow (no Electron import). */
export interface OverlayWindowLike {
  on(event: string, listener: () => void): unknown
  getBounds(): OverlayBounds
}

export interface WatchOverlayBoundsOptions {
  delayMs?: number
  schedule?: (fn: () => void, ms: number) => unknown
  cancel?: (timer: unknown) => void
}

/**
 * Persist move/resize (debounced -- these fire continuously while dragging)
 * and flush synchronously on close so a quick move+quit is not lost.
 * Returns a detach that cancels any pending write.
 */
export function watchOverlayBounds(
  win: OverlayWindowLike,
  save: (b: OverlayBounds) => void,
  opts: WatchOverlayBoundsOptions = {}
): () => void {
  const delayMs = opts.delayMs ?? 500
  const schedule = opts.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const cancel = opts.cancel ?? ((t: unknown) => clearTimeout(t as NodeJS.Timeout))
  let timer: unknown = null

  const persistNow = (): void => {
    try {
      save(win.getBounds())
    } catch (err) {
      // Bounds persistence must never take the window down; warn and carry on.
      console.warn('[overlay] saving bounds failed:', err instanceof Error ? err.message : err)
    }
  }
  const debounced = (): void => {
    if (timer !== null) cancel(timer)
    timer = schedule(() => {
      timer = null
      persistNow()
    }, delayMs)
  }

  win.on('resize', debounced)
  win.on('move', debounced)
  win.on('close', () => {
    if (timer !== null) {
      cancel(timer)
      timer = null
    }
    persistNow()
  })

  return () => {
    if (timer !== null) {
      cancel(timer)
      timer = null
    }
  }
}
