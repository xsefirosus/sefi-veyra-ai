import { describe, expect, it } from 'vitest'
import type {
  LlmAdapter,
  Suggestion,
  SuggestionDelta,
  TranscriptContext
} from '../src/shared/llm/llm-adapter'
import type { PersonaContext, TranscriptEvent } from '../src/shared/types'

/**
 * MockLlmAdapter: a self-contained LlmAdapter implementation used to prove
 * the interface contract (audit plan step 17). Compile: the
 * `implements LlmAdapter` clause plus the explicit
 * `const adapter: LlmAdapter = ...` assignments below fail to compile if the
 * interface drifts.
 *
 * Emit behavior: streamSuggestions yields one `{ type: 'delta' }` event per
 * queued chunk, then a single terminal `{ type: 'complete' }` carrying the
 * assembled Suggestion. It checks the AbortSignal before every yield: once
 * aborted, the stream stops silently — no further deltas, no complete event.
 */
class MockLlmAdapter implements LlmAdapter {
  lastCtx: TranscriptContext | undefined

  constructor(
    private readonly chunks: string[],
    private readonly kind: Suggestion['kind'] = 'action-item'
  ) {}

  async *streamSuggestions(
    ctx: TranscriptContext,
    signal?: AbortSignal
  ): AsyncIterable<SuggestionDelta> {
    this.lastCtx = ctx
    for (const chunk of this.chunks) {
      if (signal?.aborted) return
      yield { type: 'delta', kind: this.kind, textDelta: chunk }
    }
    if (signal?.aborted) return
    yield {
      type: 'complete',
      suggestion: { text: this.chunks.join(''), kind: this.kind }
    }
  }
}

describe('llm-adapter contract', () => {
  it('MockLlmAdapter satisfies the LlmAdapter interface', () => {
    // Compile-time structural check: this assignment only compiles while
    // MockLlmAdapter has every member of LlmAdapter with a compatible type
    // (token-level deltas + AbortSignal parameter, audit step 17).
    const adapter: LlmAdapter = new MockLlmAdapter([])
    expect(adapter).toBeInstanceOf(MockLlmAdapter)
  })

  it('streamSuggestions streams text deltas then a terminal complete event', async () => {
    const events: TranscriptEvent[] = [
      {
        source: 'mic',
        kind: 'final',
        text: 'testing one two three',
        seq: 0,
        ts: 1,
        segmentId: '0:00:00.00:0'
      }
    ]
    const mock = new MockLlmAdapter(['Send ', 'the agenda'])
    const out: SuggestionDelta[] = []
    for await (const d of mock.streamSuggestions({ events, meetingId: 'm-1' })) {
      out.push(d)
    }
    expect(out).toEqual([
      { type: 'delta', kind: 'action-item', textDelta: 'Send ' },
      { type: 'delta', kind: 'action-item', textDelta: 'the agenda' },
      {
        type: 'complete',
        suggestion: { text: 'Send the agenda', kind: 'action-item' }
      }
    ])
  })

  it('honors an AbortSignal mid-stream: stops without further deltas or complete', async () => {
    const mock = new MockLlmAdapter(['Hel', 'lo', ' world'])
    const controller = new AbortController()
    const out: SuggestionDelta[] = []
    for await (const d of mock.streamSuggestions({}, controller.signal)) {
      out.push(d)
      if (out.length === 1) controller.abort()
    }
    // First delta delivered; everything after the abort is suppressed,
    // including the terminal complete event.
    expect(out).toEqual([{ type: 'delta', kind: 'action-item', textDelta: 'Hel' }])
  })

  it('accepts a PersonaContext on TranscriptContext', async () => {
    const persona: PersonaContext = {
      resume: '10 years distributed systems',
      jobDescription: 'Staff engineer, infra',
      notes: ['mentions Terraform'],
      docs: []
    }
    const mock = new MockLlmAdapter(['ok'])
    const out: SuggestionDelta[] = []
    for await (const d of mock.streamSuggestions({ events: [], persona })) {
      out.push(d)
    }
    // Persona reaches the adapter untouched inside the context…
    expect(mock.lastCtx?.persona).toEqual(persona)
    // …and the stream still terminates correctly.
    expect(out[out.length - 1]?.type).toBe('complete')
  })

  it('persona is optional: a context without one still streams', async () => {
    const mock = new MockLlmAdapter(['hi'], 'question')
    const out: SuggestionDelta[] = []
    for await (const d of mock.streamSuggestions({ events: [], meetingId: 'm-2' })) {
      out.push(d)
    }
    expect(out).toEqual([
      { type: 'delta', kind: 'question', textDelta: 'hi' },
      {
        type: 'complete',
        suggestion: { text: 'hi', kind: 'question' }
      }
    ])
    expect(mock.lastCtx?.persona).toBeUndefined()
  })

  it('every declared Suggestion kind is accepted by the union', () => {
    // Compile-time check: every member of the union is assignable to
    // Suggestion['kind'] (a typo in the union fails this file to compile).
    const kinds: Suggestion['kind'][] = ['action-item', 'summary', 'question']
    expect(kinds).toHaveLength(3)
  })
})
