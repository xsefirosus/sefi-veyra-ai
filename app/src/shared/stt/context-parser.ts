/**
 * Context parser (plan step 15): maps raw wlk WebSocket messages to the shared
 * TranscriptEvent shape (src/shared/types.ts — declared there in step 10,
 * reused here).
 *
 * DISCRIMINATOR — derived from the REAL captured fixture
 * (tests/fixtures/wlk-messages.json, captured verbatim in step 14). Field
 * names below are observed in that fixture, never invented:
 *
 *   - Control messages carry a top-level `type` field and NO transcript text:
 *     `{"type":"config","useAudioWorklet":true,"mode":"full"}` and
 *     `{"type":"ready_to_stop"}` (fixture indexes 0 and 13). They parse to
 *     null — no event.
 *   - Status messages carry `status` (`"no_audio_detected"` |
 *     `"active_transcription"`) plus `lines[]`, `buffer_transcription`,
 *     `buffer_diarization`, `buffer_translation`, `remaining_time_*`.
 *       * kind 'final'   — a `lines[]` entry whose `text` is non-empty: a
 *         COMMITTED segment. Observed at fixture indexes 11-12 (speaker 1,
 *         " testing 1, 2, 3. This is the Vero meeting transcription [test]").
 *       * kind 'partial' — `buffer_transcription` non-empty: the LIVE revision
 *         of the in-flight segment. Observed at indexes 9-10 (" Testing 1",
 *         " Testing 1, 2, 3").
 *       * No event       — `buffer_transcription` empty AND no `lines[]` entry
 *         has non-empty text (indexes 1-8: `no_audio_detected`, and
 *         `active_transcription` whose only line has `text: ""`).
 *   - Precedence when both carry text (NOT observed in the fixture; defined
 *     for determinism): the committed `lines[]` text wins (final) over the
 *     live buffer revision (partial).
 *   - One event per message; if several `lines[]` entries have text, the LAST
 *     non-empty one wins (the most recently committed segment).
 *
 * Final detection is NOT pending: the fixture contains final evidence
 * (indexes 11-12). If a later capture (step 21 e2e) reveals a distinct
 * end-of-segment status, extend the discriminator here.
 *
 * Text: buffer/line text is trimmed — the fixture's captured text carries
 * leading whitespace (e.g. " Testing 1"). Fields the TranscriptEvent shape
 * does not carry (speaker, start, end, detected_language, remaining_time_*,
 * buffer_diarization, buffer_translation) are dropped.
 *
 * SIGNATURE — deviations from the plan's bare `normalizeWlkMessage(msg)`,
 * chosen to keep step 16 working (documented per step 15):
 *   - `source`: wlk messages carry no track; the capture sites tag it
 *     (step 20). The caller passes 'mic' | 'loopback'; it defaults to 'mic'
 *     so the plan's single-arg call still compiles.
 *   - `seq`: the adapter (step 16) owns the segment sequence counter
 *     (src/shared/types.ts), so seq is caller-stamped (default 0) and passed
 *     through untouched. The caller's counter must only advance per produced
 *     event to keep seq monotonic.
 *   - Returns `TranscriptEvent | null`: control/empty messages parse cleanly
 *     but produce no event; non-JSON payloads also yield null (never throw).
 *   - `ts` is Date.now() at event production (epoch-ms).
 */
import type { TranscriptEvent } from '../types'

export function normalizeWlkMessage(
  msg: unknown,
  source: 'mic' | 'loopback' = 'mic',
  seq: number = 0
): TranscriptEvent | null {
  const parsed = parseRecord(msg)
  if (parsed === null) return null

  // Control messages carry a top-level `type` field (observed: "config",
  // "ready_to_stop"); they never carry transcript text.
  if (parsed.type !== undefined) return null

  // Committed segments: the last lines[] entry with non-empty text wins.
  const finalText = lastNonEmptyLineText(parsed.lines)
  if (finalText !== null) {
    return { source, kind: 'final', text: finalText, seq, ts: Date.now() }
  }

  // Live revision of the in-flight segment.
  const partialText = trimmedText(parsed.buffer_transcription)
  if (partialText !== null) {
    return { source, kind: 'partial', text: partialText, seq, ts: Date.now() }
  }

  // No text anywhere: no event.
  return null
}

/** Accepts a JSON string or an already-parsed object; anything else -> null. */
function parseRecord(msg: unknown): Record<string, unknown> | null {
  if (typeof msg === 'string') {
    try {
      const parsed: unknown = JSON.parse(msg)
      return isRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return isRecord(msg) ? msg : null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Trims whitespace; null when not a non-empty string. */
function trimmedText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

/** The last lines[] entry with non-empty text, else null. */
function lastNonEmptyLineText(lines: unknown): string | null {
  if (!Array.isArray(lines)) return null
  let last: string | null = null
  for (const line of lines) {
    if (isRecord(line)) {
      const t = trimmedText(line.text)
      if (t !== null) last = t
    }
  }
  return last
}
