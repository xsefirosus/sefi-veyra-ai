/**
 * Context parser (plan steps 15 + 8 — audit remediation): maps raw wlk WebSocket
 * messages to the shared TranscriptEvent shape (src/shared/types.ts).
 *
 * DISCRIMINATOR — derived from the REAL captured fixture
 * (tests/fixtures/wlk-messages.json, captured verbatim in step 14). Field
 * names below are observed in that fixture, never invented:
 *
 *   - Control messages carry a top-level `type` field and NO transcript text:
 *     `{"type":"config","useAudioWorklet":true,"mode":"full"}` and
 *     `{"type":"ready_to_stop"}` (fixture indexes 0 and 13). They parse to
 *     [] — no event.
 *   - Status messages carry `status` (`"no_audio_detected"` |
 *     `"active_transcription"`) plus `lines[]`, `buffer_transcription`,
 *     `buffer_diarization`, `buffer_translation`, `remaining_time_*`.
 *       * kind 'final'   — a `lines[]` entry whose `text` is non-empty: a
 *         COMMITTED segment. Observed at fixture indexes 11-12 (speaker 1,
 *         " testing 1, 2, 3. This is the Vero meeting transcription [test]").
 *         One event per non-empty entry, each with stable `segmentId` from
 *         wlk's own `start` timestamp + `lines[]` index (so index 11 and 12's
 *         first line share `"0:00:00.34:0"` and a downstream repeat REPLACES).
 *         Carries `speaker` (raw numeric), `start`, `end`, `detected_language`.
 *       * kind 'partial' — `buffer_transcription` non-empty: the LIVE revision
 *         of the in-flight segment. Observed at indexes 9-10 (" Testing 1",
 *         " Testing 1, 2, 3"). One event with `segmentId: partial:<source>:<seq>`
 *         (seq is the adapter's per-segment counter, so revisions of the same
 *         in-flight segment share the id until the final advances it).
 *       * No event       — `buffer_transcription` empty AND no `lines[]` entry
 *         has non-empty text (indexes 1-8: `no_audio_detected`, and
 *         `active_transcription` whose only line has `text: ""`).
 *   - Precedence when both carry text (NOT observed in the fixture; defined
 *     for determinism): committed `lines[]` text wins — finals are emitted,
 *     buffer is ignored.
 *   - Zero or more events per message (step 8): a message with N non-empty
 *     `lines[]` entries emits N finals; otherwise one partial or none.
 *
 * Final detection is NOT pending: the fixture contains final evidence
 * (indexes 11-12). If a later capture (step 21 e2e) reveals a distinct
 * end-of-segment status, extend the discriminator here.
 *
 * Text: buffer/line text is trimmed — the fixture's captured text carries
 * leading whitespace (e.g. " Testing 1"). Fields the TranscriptEvent shape
 * does not carry beyond `segmentId`/`start`/`end`/`detectedLanguage`/
 * `speakerId` (remaining_time_*, buffer_diarization, buffer_translation) are
 * dropped.
 *
 * SIGNATURE (step 8, breaking — see Risks):
 *   - Returns `TranscriptEvent[]` — zero or more events per message. Control/
 *     empty/non-JSON payloads yield `[]` (never throw). Callers must iterate.
 *   - `source`: wlk messages carry no track; the capture sites tag it
 *     (step 20). The caller passes 'mic' | 'loopback'; it defaults to 'mic'
 *     so the plan's single-arg call still compiles.
 *   - `seq`: the adapter (step 16) owns the segment sequence counter
 *     (src/shared/types.ts), so seq is caller-stamped (default 0) and passed
 *     through untouched. For finals the caller's counter should only advance
 *     per committed segment; the parser does not advance it.
 *   - `ts` is Date.now() at event production (epoch-ms).
 *   - `segmentId` is `"<start>:<lines-index>"` for finals (stable across
 *     in-place revisions, e.g. "0:00:00.34:0" for both fixture finals), and
 *     `"partial:<source>:<seq>"` for partials.
 */
import type { TranscriptEvent } from '../types'

export function normalizeWlkMessage(
  msg: unknown,
  source: 'mic' | 'loopback' = 'mic',
  seq: number = 0
): TranscriptEvent[] {
  const parsed = parseRecord(msg)
  if (parsed === null) return []

  // Control messages carry a top-level `type` field (observed: "config",
  // "ready_to_stop"); they never carry transcript text.
  if (parsed.type !== undefined) return []

  // Committed segments: one event per lines[] entry with non-empty text.
  // Each carries a stable segmentId from wlk's start + index, plus raw wlk
  // fields. If any finals exist, they win over the live buffer (precedence).
  const lines = parsed.lines
  if (Array.isArray(lines)) {
    const finals: TranscriptEvent[] = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!isRecord(line)) continue
      const t = trimmedText(line.text)
      if (t === null) continue
      const start = typeof line.start === 'string' ? line.start : undefined
      const end = typeof line.end === 'string' ? line.end : undefined
      const detectedLanguage =
        typeof line.detected_language === 'string' ? line.detected_language : undefined
      const speakerId = typeof line.speaker === 'number' ? line.speaker : undefined
      const segmentId = start !== undefined ? `${start}:${i}` : `idx:${i}`
      finals.push({
        source,
        kind: 'final',
        text: t,
        seq,
        ts: Date.now(),
        segmentId,
        start,
        end,
        detectedLanguage,
        speakerId
      })
    }
    if (finals.length > 0) return finals
  }

  // Live revision of the in-flight segment.
  const partialText = trimmedText(parsed.buffer_transcription)
  if (partialText !== null) {
    return [
      {
        source,
        kind: 'partial',
        text: partialText,
        seq,
        ts: Date.now(),
        segmentId: `partial:${source}:${seq}`
      }
    ]
  }

  // No text anywhere: no event.
  return []
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
