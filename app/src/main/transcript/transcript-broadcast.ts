/**
 * Main-process transcript broadcast (plan step 18): adapter events ->
 * webContents.send('transcript-event', event) to BOTH windows. Pure and
 * window-agnostic (structural BrowserWindow slice) so tests exercise the
 * "both windows" contract with fake windows; index.ts holds the real window
 * references and wires the adapter callbacks to it.
 */
import { TRANSCRIPT_EVENT_CHANNEL } from '../../shared/types'
import type { TranscriptEvent } from '../../shared/types'

/** Structural slice of BrowserWindow used here (testable without Electron). */
export interface BroadcastWindow {
  isDestroyed(): boolean
  webContents: {
    send(channel: string, ...args: unknown[]): void
  }
}

/** Send one transcript event to every live window; null/destroyed are skipped. */
export function broadcastTranscriptEvent(
  windows: readonly (BroadcastWindow | null)[],
  event: TranscriptEvent
): void {
  for (const win of windows) {
    if (win !== null && !win.isDestroyed()) {
      win.webContents.send(TRANSCRIPT_EVENT_CHANNEL, event)
    }
  }
}
