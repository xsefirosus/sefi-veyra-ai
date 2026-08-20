/**
 * Shared transcript event type (plan steps 10 and 15).
 *
 * Declared once here so both the LLM adapter seam (step 10,
 * src/shared/llm/llm-adapter.ts) and the STT context parser (step 15,
 * src/shared/stt/context-parser.ts) import the same shape:
 * `normalizeWlkMessage(msg: unknown): TranscriptEvent` builds these from
 * captured wlk fixtures, and `TranscriptContext.events` feeds them to the LLM
 * adapter.
 *
 * `source` is the capture track ('mic' from step 17, 'loopback' from step 19);
 * `kind` is the wlk segment state (a partial is the live revision of a
 * segment, the final with the same seq is its committed text); `seq` is the
 * adapter's monotonically increasing segment sequence number; `ts` is
 * epoch-ms when the event was produced.
 */
export interface TranscriptEvent {
  source: 'mic' | 'loopback'
  kind: 'partial' | 'final'
  text: string
  seq: number
  ts: number
}
