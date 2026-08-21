import { describe, expect, it } from 'vitest'
import type { LlmAdapter, Suggestion, TranscriptContext } from '../src/shared/llm/llm-adapter'
import type { TranscriptEvent } from '../src/shared/types'

/**
 * MockLlmAdapter: a self-contained LlmAdapter implementation used to prove the
 * interface contract. Compile: the `implements LlmAdapter` clause plus the
 * explicit `const adapter: LlmAdapter = ...` assignment below fail to compile
 * if the interface drifts. Emit behavior: streamSuggestions yields the
 * Suggestion objects queued at construction time.
 */
class MockLlmAdapter implements LlmAdapter {
  constructor(private readonly suggestions: Suggestion[]) {}

  async *streamSuggestions(ctx: TranscriptContext): AsyncIterable<Suggestion> {
    // The mock deliberately ignores the context; the void marks that intent
    // for no-unused-vars while keeping the interface signature intact.
    void ctx
    for (const s of this.suggestions) yield s
  }
}

describe('llm-adapter contract', () => {
  it('MockLlmAdapter satisfies the LlmAdapter interface', () => {
    // Compile-time structural check: this assignment only compiles while
    // MockLlmAdapter has every member of LlmAdapter with a compatible type.
    const adapter: LlmAdapter = new MockLlmAdapter([])
    expect(adapter).toBeInstanceOf(MockLlmAdapter)
  })

  it('streamSuggestions yields a Suggestion for a TranscriptContext', async () => {
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
    const mock = new MockLlmAdapter([{ text: 'send the agenda', kind: 'action-item' }])
    const out: Suggestion[] = []
    for await (const s of mock.streamSuggestions({ events, meetingId: 'm-1' })) {
      out.push(s)
    }
    expect(out).toEqual([{ text: 'send the agenda', kind: 'action-item' }])
  })

  it('every declared Suggestion kind is accepted by the union', () => {
    // Compile-time check: every member of the union is assignable to
    // Suggestion['kind'] (a typo in the union fails this file to compile).
    const kinds: Suggestion['kind'][] = ['action-item', 'summary', 'question']
    expect(kinds).toHaveLength(3)
  })
})
