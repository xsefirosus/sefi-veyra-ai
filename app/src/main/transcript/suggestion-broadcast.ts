/**
 * Main-process suggestion broadcast (phase 3 step 15): adapter deltas ->
 * webContents.send('suggestion-event', delta) to BOTH windows. Pure and
 * window-agnostic (structural BroadcastWindow slice) so tests exercise the
 * "both windows" contract with fake windows; main holds the real window
 * references and wires the LlmAdapter stream to it (step 17).
 *
 * Mirrors src/main/transcript/transcript-broadcast.ts's exact pattern.
 */
import { SUGGESTION_EVENT_CHANNEL } from '../../shared/types'
import type { SuggestionDelta } from '../../shared/llm/llm-adapter'
import type { BroadcastWindow } from './transcript-broadcast'

/** Send one suggestion delta to every live window; null/destroyed are skipped. */
export function broadcastSuggestionEvent(
  windows: readonly (BroadcastWindow | null)[],
  event: SuggestionDelta
): void {
  for (const win of windows) {
    if (win !== null && !win.isDestroyed()) {
      win.webContents.send(SUGGESTION_EVENT_CHANNEL, event)
    }
  }
}
