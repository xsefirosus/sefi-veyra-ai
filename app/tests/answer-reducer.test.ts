import { describe, expect, it } from 'vitest'
import {
  answerReducer,
  initialAnswerState,
  toAnswerAction,
  type AnswerState
} from '../src/renderer/src/transcript/answer-reducer'
import type { SuggestionDelta } from '../src/shared/llm/llm-adapter'

function delta(textDelta: string, kind: SuggestionDelta['kind'] = 'action-item'): SuggestionDelta {
  return { type: 'delta', kind, textDelta }
}
function complete(text: string, kind: SuggestionDelta['kind'] = 'action-item'): SuggestionDelta {
  return { type: 'complete', suggestion: { text, kind } }
}

describe('answer-reducer (phase 3 step 15)', () => {
  it('starts idle with empty text', () => {
    expect(initialAnswerState).toEqual({
      text: '',
      kind: null,
      status: 'idle',
      suggestion: null
    })
  })

  it('interleaved delta -> delta -> complete accumulates and reaches terminal state', () => {
    let state: AnswerState = initialAnswerState
    state = answerReducer(state, delta('Send '))
    expect(state).toEqual({
      text: 'Send ',
      kind: 'action-item',
      status: 'streaming',
      suggestion: null
    })
    state = answerReducer(state, delta('the agenda'))
    expect(state).toEqual({
      text: 'Send the agenda',
      kind: 'action-item',
      status: 'streaming',
      suggestion: null
    })
    state = answerReducer(state, complete('Send the agenda'))
    expect(state).toEqual({
      text: 'Send the agenda',
      kind: 'action-item',
      status: 'complete',
      suggestion: { text: 'Send the agenda', kind: 'action-item' }
    })
  })

  it('abort mid-stream (no complete) leaves partial text visible as streaming', () => {
    let state: AnswerState = initialAnswerState
    state = answerReducer(state, delta('Hel'))
    state = answerReducer(state, delta('lo'))
    // No complete arrives (abort): partial remains, no hang, no error
    expect(state.text).toBe('Hello')
    expect(state.status).toBe('streaming')
    expect(state.suggestion).toBeNull()
    // Stays streaming even without ever completing
    expect(state.kind).toBe('action-item')
  })

  it('resets on new suggestion: delta after complete starts a fresh accumulation', () => {
    let state: AnswerState = initialAnswerState
    state = answerReducer(state, delta('First '))
    state = answerReducer(state, complete('First '))
    expect(state.status).toBe('complete')
    expect(state.text).toBe('First ')
    // Next suggestion begins with a new delta — must reset, not append
    state = answerReducer(state, delta('Second'))
    expect(state).toEqual({
      text: 'Second',
      kind: 'action-item',
      status: 'streaming',
      suggestion: null
    })
    state = answerReducer(state, delta(' suggestion'))
    state = answerReducer(state, complete('Second suggestion'))
    expect(state.text).toBe('Second suggestion')
    expect(state.status).toBe('complete')
  })

  it('complete replaces accumulated deltas with the final Suggestion object exactly', () => {
    let state: AnswerState = initialAnswerState
    state = answerReducer(state, delta('token-1 '))
    state = answerReducer(state, delta('token-2'))
    // Complete text may differ from naive join (model may normalize) — reducer must use suggestion.text verbatim
    state = answerReducer(state, complete('final text'))
    expect(state.text).toBe('final text')
    expect(state.suggestion).toEqual({ text: 'final text', kind: 'action-item' })
    expect(state.status).toBe('complete')
  })

  it('toAnswerAction maps a SuggestionDelta to the reducer action (identity)', () => {
    const d: SuggestionDelta = delta('hi', 'question')
    expect(toAnswerAction(d)).toEqual(d)
    const c: SuggestionDelta = complete('done', 'summary')
    expect(toAnswerAction(c)).toEqual(c)
  })

  it('preserves kind from delta and from complete', () => {
    let state = answerReducer(initialAnswerState, delta('hi', 'question'))
    expect(state.kind).toBe('question')
    state = answerReducer(state, complete('hi', 'summary'))
    expect(state.kind).toBe('summary')
  })
})
