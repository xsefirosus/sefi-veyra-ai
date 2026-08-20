/**
 * LLM adapter seam (plan step 10) — DECLARED ONLY, no Phase 4 code.
 *
 * This file is the seam Phase 4 implements Gemini behind: REST
 * streamGenerateContent over SSE, or the @google/genai
 * generateContentStream (the SDK 3.x line requires Node 22). The exact
 * model string is UNKNOWN — Phase 4 must read it from settings/env, never
 * hardcode it. Nothing here calls any LLM; the seam exists so the
 * transcript pipeline can program against a stable interface. The test
 * (tests/llm-adapter.test.ts) proves the contract with a mock.
 */

import type { TranscriptEvent } from '../types'

/**
 * The transcript window handed to the LLM. `events` is the shared
 * TranscriptEvent stream (src/shared/types.ts — step 15's context parser
 * builds it from wlk fixtures); `meetingId` is optional and unused this pass.
 */
export interface TranscriptContext {
  events: TranscriptEvent[]
  meetingId?: string
}

/** A single LLM-produced suggestion, tagged with its kind. */
export interface Suggestion {
  text: string
  kind: 'action-item' | 'summary' | 'question'
}

/**
 * Streaming suggestion contract. Implementations yield Suggestion objects as
 * they become available, mirroring the STT adapter's partial/final flow.
 */
export interface LlmAdapter {
  streamSuggestions(ctx: TranscriptContext): AsyncIterable<Suggestion>
}
