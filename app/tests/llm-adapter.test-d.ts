import { describe, expectTypeOf, it } from 'vitest'
import type {
  LlmAdapter,
  Suggestion,
  SuggestionDelta,
  TranscriptContext
} from '../src/shared/llm/llm-adapter'
import type { PersonaContext } from '../src/shared/types'

/**
 * Type-level contract for the LLM seam (audit plan step 17).
 *
 * The runtime tests in llm-adapter.test.ts exercise mock behavior; this file
 * pins the DECLARED surface itself, because no tsconfig currently includes
 * tests/ in `npm run typecheck`. It runs under vitest's typecheck mode,
 * scoped to *.test-d.ts so pre-existing type debt in other test files stays
 * out of scope until a dedicated infra step turns it off.
 */

// A reference implementation with exactly the shape step 17 mandates must be
// assignable to LlmAdapter — this one assertion carries the whole signature:
// (ctx: TranscriptContext, signal?: AbortSignal) => AsyncIterable<SuggestionDelta>.
declare function referenceStream(
  ctx: TranscriptContext,
  signal?: AbortSignal
): AsyncIterable<SuggestionDelta>

describe('llm-adapter declared seam (step 17)', () => {
  it('LlmAdapter.streamSuggestions accepts (ctx, AbortSignal?) and streams deltas', () => {
    expectTypeOf(referenceStream).toMatchTypeOf<LlmAdapter['streamSuggestions']>()
  })

  it('SuggestionDelta is a delta variant carrying incremental text', () => {
    const delta: SuggestionDelta = {
      type: 'delta',
      kind: 'action-item',
      textDelta: 'tok'
    }
    expectTypeOf(delta.type).toEqualTypeOf<'delta'>()
    expectTypeOf(delta.textDelta).toEqualTypeOf<string>()
    expectTypeOf(delta.kind).toEqualTypeOf<Suggestion['kind']>()
  })

  it('SuggestionDelta has a terminal complete variant carrying the assembled Suggestion', () => {
    const done: SuggestionDelta = {
      type: 'complete',
      suggestion: { text: 'done', kind: 'summary' }
    }
    expectTypeOf(done.type).toEqualTypeOf<'complete'>()
    expectTypeOf(done.suggestion).toEqualTypeOf<Suggestion>()
  })

  it('TranscriptContext.persona is an optional PersonaContext', () => {
    expectTypeOf<TranscriptContext['persona']>().toEqualTypeOf<PersonaContext | undefined>()
  })

  it('PersonaContext declares resume, job description, notes and docs', () => {
    expectTypeOf<PersonaContext['resume']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<PersonaContext['jobDescription']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<PersonaContext['notes']>().toEqualTypeOf<string[] | undefined>()
    expectTypeOf<PersonaContext['docs']>().toEqualTypeOf<string[] | undefined>()
  })
})
