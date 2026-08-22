/**
 * Shared transcript event type (plan steps 10, 15 and 8 — audit remediation).
 *
 * Declared once here so both the LLM adapter seam (step 10,
 * src/shared/llm/llm-adapter.ts) and the STT context parser (step 15,
 * src/shared/stt/context-parser.ts) import the same shape:
 * `normalizeWlkMessage(msg: unknown): TranscriptEvent[]` builds these from
 * captured wlk fixtures, and `TranscriptContext.events` feeds them to the LLM
 * adapter.
 *
 * `source` is the capture track ('mic' from step 17, 'loopback' from step 19);
 * `kind` is the wlk segment state (a partial is the live revision of a
 * segment, the final with the same seq is its committed text); `seq` is the
 * adapter's monotonically increasing segment sequence number; `ts` is
 * epoch-ms when the event was produced.
 *
 * `speaker` (step 20) is the labelForSource label main applies before
 * broadcast: 'mic' -> 'me', anything else -> 'other'. Optional because events
 * may be constructed before that point (the step-15 context parser); the
 * step-18 reducer defaults an absent speaker to 'unknown'.
 *
 * `segmentId` (audit step 8) is the stable committed-segment identity derived
 * from wlk's own fields — `start` timestamp + `lines[]` index — so an in-place
 * revision of the same segment (fixture indexes 11 -> 12, same start
 * "0:00:00.34" index 0, text extended by " test") carries the SAME id and
 * downstream REPLACES instead of appending. For `kind: 'partial'` the id is
 * `partial:<source>:<seq>` (seq is per-adapter per segment, so revisions share
 * it until the segment commits and seq advances). The optional wlk fields
 * (`start`, `end`, `detectedLanguage`, `speakerId`) are carried verbatim from
 * `lines[]` for speaker attribution (step 10) and debugging; they are absent on
 * partials.
 */
export interface TranscriptEvent {
  source: 'mic' | 'loopback'
  kind: 'partial' | 'final'
  text: string
  seq: number
  ts: number
  speaker?: 'me' | 'other'
  segmentId: string
  start?: string
  end?: string
  detectedLanguage?: string
  speakerId?: number
}

/**
 * IPC channel carrying transcript events from main to the renderers (plan
 * step 18). Main broadcasts TranscriptEvents here to BOTH windows; the preload
 * exposes window.api.onTranscriptEvent(cb) over this channel.
 */
export const TRANSCRIPT_EVENT_CHANNEL = 'transcript-event'

/**
 * IPC channel carrying suggestion deltas from main to the renderers (phase 3
 * step 15). Mirrors TRANSCRIPT_EVENT_CHANNEL's exact pattern: main broadcasts
 * SuggestionDelta events (delta/complete from llm-adapter) to BOTH windows;
 * the preload exposes window.api.onSuggestionEvent(cb) over this channel.
 */
export const SUGGESTION_EVENT_CHANNEL = 'suggestion-event'

/**
 * Persona context for Phase 3 ingestion (audit plan step 17) — DECLARED ONLY,
 * nothing ingests or validates these fields yet. Phase 3 fills them from user
 * settings/files; Phase 4's LLM prompt assembles them. Every field is optional
 * because any subset may be present; validation happens at the Phase 3 trust
 * boundary when real data first enters, not here.
 */
export interface PersonaContext {
  /** The user's resume/CV, as text. */
  resume?: string
  /** The job description of the role being discussed, as text. */
  jobDescription?: string
  /** Free-form notes the user attached to their persona. */
  notes?: string[]
  /** Additional supporting documents, each as raw text. */
  docs?: string[]
}
