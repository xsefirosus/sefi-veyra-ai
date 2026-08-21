/**
 * LLM adapter seam (plan steps 10, 17) — DECLARED ONLY, no Phase 4 code.
 *
 * This file is the seam Phase 4 implements Gemini behind: REST
 * streamGenerateContent over SSE, or the @google/genai
 * generateContentStream (the SDK 3.x line requires Node 22). The exact
 * model string is UNKNOWN — Phase 4 must read it from settings/env, never
 * hardcode it. Nothing here calls any LLM; the seam exists so the
 * transcript pipeline can program against a stable interface. The tests
 * (tests/llm-adapter.test.ts runtime, tests/llm-adapter.test-d.ts types)
 * prove the contract with a mock.
 *
 * Step 17 reshaped this seam for Phase 3-4: streamSuggestions now streams
 * token-level SuggestionDelta events ending in one terminal `complete`
 * event (Phase 4's criterion is sub-3-4 s to first TOKEN), takes an optional
 * AbortSignal so a live copilot can cancel in-flight generation the moment
 * the speaker continues, and TranscriptContext carries an optional
 * PersonaContext for Phase 3's resume/JD/notes/docs context. Interface only —
 * no provider code exists anywhere yet.
 */

import type { PersonaContext, TranscriptEvent } from '../types'

/**
 * The transcript window handed to the LLM. `events` is the shared
 * TranscriptEvent stream (src/shared/types.ts — step 15's context parser
 * builds it from wlk fixtures); `meetingId` is optional and unused this pass;
 * `persona` is Phase 3's user context (resume, job description, notes, docs),
 * optional until that ingestion exists.
 */
export interface TranscriptContext {
  events: TranscriptEvent[]
  meetingId?: string
  persona?: PersonaContext
}

/** A single LLM-produced suggestion, tagged with its kind. */
export interface Suggestion {
  text: string
  kind: 'action-item' | 'summary' | 'question'
}

/**
 * One streamed piece of a suggestion. `delta` events carry incremental text
 * tokens as they arrive; the stream ends with exactly one terminal `complete`
 * event holding the fully assembled Suggestion, so consumers may either
 * render tokens live or wait for the complete object. No event follows
 * `complete`.
 */
export type SuggestionDelta =
  | { type: 'delta'; kind: Suggestion['kind']; textDelta: string }
  | { type: 'complete'; suggestion: Suggestion }

/**
 * Streaming suggestion contract. Implementations yield deltas token by token,
 * then one `complete`. Aborting `signal` cancels the in-flight generation:
 * implementations must stop yielding promptly (best effort at the next token
 * boundary) and must not emit `complete` after an abort. The iterator simply
 * ends.
 */
export interface LlmAdapter {
  streamSuggestions(ctx: TranscriptContext, signal?: AbortSignal): AsyncIterable<SuggestionDelta>
}
