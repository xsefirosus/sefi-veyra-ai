import { describe, expect, it } from 'vitest'
import {
  initialTranscriptState,
  toTranscriptAction,
  transcriptReducer,
  type Speaker,
  type TranscriptAction
} from '../src/renderer/src/transcript/transcript-reducer'

const partial = (seq: number, text: string, speaker?: Speaker): TranscriptAction =>
  speaker === undefined ? { type: 'partial', seq, text } : { type: 'partial', seq, text, speaker }

const final = (seq: number, text: string, speaker?: Speaker): TranscriptAction =>
  speaker === undefined ? { type: 'final', seq, text } : { type: 'final', seq, text, speaker }

describe('transcript-reducer (plan step 18)', () => {
  it('starts with no lines', () => {
    expect(initialTranscriptState).toEqual({ lines: [] })
  })

  it('partial replaces the pending partial for that seq', () => {
    let state = transcriptReducer(initialTranscriptState, partial(0, 'hello'))
    state = transcriptReducer(state, partial(0, 'hello world'))
    expect(state.lines).toEqual([
      { seq: 0, text: 'hello world', kind: 'partial', speaker: 'unknown' }
    ])
  })

  it('partials for different seqs coexist; a partial replaces only its own seq', () => {
    let state = transcriptReducer(initialTranscriptState, partial(0, 'one'))
    state = transcriptReducer(state, partial(1, 'two'))
    state = transcriptReducer(state, partial(0, 'one revised'))
    expect(state.lines).toEqual([
      { seq: 0, text: 'one revised', kind: 'partial', speaker: 'unknown' },
      { seq: 1, text: 'two', kind: 'partial', speaker: 'unknown' }
    ])
  })

  it('final appends a committed line and removes the pending partial for that seq', () => {
    let state = transcriptReducer(initialTranscriptState, partial(0, 'hello world'))
    state = transcriptReducer(state, final(0, 'hello world'))
    expect(state.lines).toEqual([
      { seq: 0, text: 'hello world', kind: 'final', speaker: 'unknown' }
    ])
  })

  it('final with no pending partial still appends a line', () => {
    const state = transcriptReducer(initialTranscriptState, final(2, 'committed'))
    expect(state.lines).toEqual([{ seq: 2, text: 'committed', kind: 'final', speaker: 'unknown' }])
  })

  it('later segments stay in order after earlier ones commit', () => {
    let state = transcriptReducer(initialTranscriptState, partial(0, 'a'))
    state = transcriptReducer(state, partial(1, 'b'))
    state = transcriptReducer(state, final(0, 'a'))
    state = transcriptReducer(state, final(1, 'b'))
    expect(state.lines.map((l) => l.text)).toEqual(['a', 'b'])
    expect(state.lines.every((l) => l.kind === 'final')).toBe(true)
  })

  it('speaker defaults to unknown when the action carries none', () => {
    const state = transcriptReducer(initialTranscriptState, partial(0, 'hi'))
    expect(state.lines[0].speaker).toBe('unknown')
  })

  it('speaker preserved: a final without a speaker keeps the pending partials speaker', () => {
    let state = transcriptReducer(initialTranscriptState, partial(0, 'hi', 'me'))
    state = transcriptReducer(state, final(0, 'hi'))
    expect(state.lines[0]).toEqual({ seq: 0, text: 'hi', kind: 'final', speaker: 'me' })
  })

  it('an explicit final speaker wins over the pending partials', () => {
    let state = transcriptReducer(initialTranscriptState, partial(0, 'hi', 'me'))
    state = transcriptReducer(state, final(0, 'hi', 'other'))
    expect(state.lines[0].speaker).toBe('other')
  })

  it('unknown action returns the state unchanged (same reference)', () => {
    const state = transcriptReducer(initialTranscriptState, { type: 'nope' } as never)
    expect(state).toBe(initialTranscriptState)
  })

  it('toTranscriptAction maps a TranscriptEvent to a reducer action', () => {
    expect(
      toTranscriptAction({ source: 'mic', kind: 'partial', text: 'hi', seq: 0, ts: 1 })
    ).toEqual({ type: 'partial', seq: 0, text: 'hi' })
    expect(
      toTranscriptAction({ source: 'loopback', kind: 'final', text: 'done', seq: 1, ts: 2 })
    ).toEqual({ type: 'final', seq: 1, text: 'done' })
  })

  it('toTranscriptAction passes the step-20 speaker label through to the action', () => {
    expect(
      toTranscriptAction({
        source: 'mic',
        kind: 'partial',
        text: 'hi',
        seq: 0,
        ts: 1,
        speaker: 'me'
      })
    ).toEqual({ type: 'partial', seq: 0, text: 'hi', speaker: 'me' })
    expect(
      toTranscriptAction({
        source: 'loopback',
        kind: 'final',
        text: 'done',
        seq: 1,
        ts: 2,
        speaker: 'other'
      })
    ).toEqual({ type: 'final', seq: 1, text: 'done', speaker: 'other' })
  })
})
