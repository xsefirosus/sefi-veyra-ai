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

/**
 * Build a TranscriptEvent from an adapter callback's raw args (audit-02).
 *
 * The adapter (whisper-livekit.ts) passes the context-parser's REAL stable
 * segmentId as an optional third callback argument (SttAdapter interface:
 * `cb: (text, seq, segmentId?) => void`). That real id MUST be used verbatim
 * -- it is what makes the duplicate/lost-final-segment fix (in-place revision
 * REPLACES the committed line by segmentId, not by seq) actually apply.
 *
 * A caller that instead fabricates its own `${kind}:${source}:${seq}` id
 * defeats that fix silently (no type error: the SttAdapter callback type
 * declares segmentId optional, so a narrower 2-arg callback literal is a
 * structurally valid listener and simply never binds the third arg): seq
 * advances on every FINAL CALLBACK firing, not per distinct committed
 * segment, so a revision of the same segment (wlk resending an extended
 * lines[] entry) gets a NEW fabricated id each time and the reducer appends
 * a duplicate line instead of replacing -- reproducing the exact bug step 8
 * fixed in the parser/adapter/reducer, just one layer up, on the wiring the
 * real interactive app (and the VEYRA_TEST_AUDIO demo seam) actually uses.
 *
 * The fallback here exists only for a hypothetical adapter implementation
 * that does not supply a segmentId (the interface allows it); the real
 * WhisperLiveKitSttAdapter always does.
 */
export function adapterEventToTranscriptEvent(
  source: TranscriptEvent['source'],
  speaker: TranscriptEvent['speaker'],
  kind: TranscriptEvent['kind'],
  text: string,
  seq: number,
  segmentId: string | undefined
): TranscriptEvent {
  return {
    source,
    speaker,
    kind,
    text,
    seq,
    ts: Date.now(),
    segmentId: segmentId ?? `${kind}:${source}:${seq}`
  }
}
