/**
 * Plan step 16(d): pin-to-bottom auto-scroll for the transcript list.
 *
 * New lines scroll into view automatically, but only while the reader is at
 * the bottom; scrolling up to reread history must not be yanked back down on
 * the next partial. TranscriptPanel tracks pinned state via onScroll using
 * this predicate.
 */

/** Distance from bottom that still counts as "pinned" (px). */
export const PIN_THRESHOLD_PX = 32

export function isNearBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold: number = PIN_THRESHOLD_PX
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold
}

/** Jump a scroll container to its bottom (no-op when the element is gone). */
export function scrollToBottom(el: HTMLElement | null): void {
  if (el) el.scrollTop = el.scrollHeight
}
