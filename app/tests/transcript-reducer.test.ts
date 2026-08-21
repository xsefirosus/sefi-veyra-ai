import { describe, expect, it } from 'vitest'
import {
  initialTranscriptState,
  MAX_COMMITTED_LINES,
  toTranscriptAction,
  transcriptReducer,
  type Speaker,
  type TranscriptAction
} from '../src/renderer/src/transcript/transcript-reducer'

const partial = (
  seq: number,
  text: string,
  speaker?: Speaker,
  source: 'mic' | 'loopback' = 'mic',
  segmentId?: string
): TranscriptAction =>
  ({
    type: 'partial',
    seq,
    text,
    ...(speaker === undefined ? {} : { speaker }),
    segmentId: segmentId ?? `partial:${source}:${seq}`,
    source
  }) as TranscriptAction

const final = (
  seq: number,
  text: string,
  speaker?: Speaker,
  source: 'mic' | 'loopback' = 'mic',
  segmentId?: string
): TranscriptAction =>
  ({
    type: 'final',
    seq,
    text,
    ...(speaker === undefined ? {} : { speaker }),
    segmentId: segmentId ?? `final:${source}:${seq}`,
    source
  }) as TranscriptAction

describe('transcript-reducer (plan step 18)', () => {
  it('starts with no lines', () => {
    expect(initialTranscriptState).toEqual({ lines: [] })
  })

  it('partial replaces the pending partial for that seq', () => {
    let state = transcriptReducer(initialTranscriptState, partial(0, 'hello'))
    state = transcriptReducer(state, partial(0, 'hello world'))
    expect(state.lines).toEqual([
      {
        seq: 0,
        text: 'hello world',
        kind: 'partial',
        speaker: 'unknown',
        segmentId: 'partial:mic:0',
        source: 'mic'
      }
    ])
  })

  it('partials for different seqs coexist; a partial replaces only its own seq', () => {
    let state = transcriptReducer(initialTranscriptState, partial(0, 'one'))
    state = transcriptReducer(state, partial(1, 'two'))
    state = transcriptReducer(state, partial(0, 'one revised'))
    expect(state.lines).toEqual([
      {
        seq: 0,
        text: 'one revised',
        kind: 'partial',
        speaker: 'unknown',
        segmentId: 'partial:mic:0',
        source: 'mic'
      },
      {
        seq: 1,
        text: 'two',
        kind: 'partial',
        speaker: 'unknown',
        segmentId: 'partial:mic:1',
        source: 'mic'
      }
    ])
  })

  it('final appends a committed line and removes the pending partial for that seq', () => {
    let state = transcriptReducer(initialTranscriptState, partial(0, 'hello world'))
    state = transcriptReducer(state, final(0, 'hello world'))
    expect(state.lines).toEqual([
      {
        seq: 0,
        text: 'hello world',
        kind: 'final',
        speaker: 'unknown',
        segmentId: 'final:mic:0',
        source: 'mic'
      }
    ])
  })

  it('final with no pending partial still appends a line', () => {
    const state = transcriptReducer(initialTranscriptState, final(2, 'committed'))
    expect(state.lines).toEqual([
      {
        seq: 2,
        text: 'committed',
        kind: 'final',
        speaker: 'unknown',
        segmentId: 'final:mic:2',
        source: 'mic'
      }
    ])
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
    expect(state.lines[0]).toEqual({
      seq: 0,
      text: 'hi',
      kind: 'final',
      speaker: 'me',
      segmentId: 'final:mic:0',
      source: 'mic'
    })
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
      toTranscriptAction({
        source: 'mic',
        kind: 'partial',
        text: 'hi',
        seq: 0,
        ts: 1,
        segmentId: 'partial:mic:0'
      })
    ).toEqual({ type: 'partial', seq: 0, text: 'hi', segmentId: 'partial:mic:0', source: 'mic' })
    expect(
      toTranscriptAction({
        source: 'loopback',
        kind: 'final',
        text: 'done',
        seq: 1,
        ts: 2,
        segmentId: '0:00:01.00:0'
      })
    ).toEqual({
      type: 'final',
      seq: 1,
      text: 'done',
      segmentId: '0:00:01.00:0',
      source: 'loopback'
    })
  })

  it('toTranscriptAction passes the step-20 speaker label through to the action', () => {
    expect(
      toTranscriptAction({
        source: 'mic',
        kind: 'partial',
        text: 'hi',
        seq: 0,
        ts: 1,
        speaker: 'me',
        segmentId: 'partial:mic:0'
      })
    ).toEqual({
      type: 'partial',
      seq: 0,
      text: 'hi',
      speaker: 'me',
      segmentId: 'partial:mic:0',
      source: 'mic'
    })
    expect(
      toTranscriptAction({
        source: 'loopback',
        kind: 'final',
        text: 'done',
        seq: 1,
        ts: 2,
        speaker: 'other',
        segmentId: '0:00:01.00:0'
      })
    ).toEqual({
      type: 'final',
      seq: 1,
      text: 'done',
      speaker: 'other',
      segmentId: '0:00:01.00:0',
      source: 'loopback'
    })
  })

  it('keeps source on every line', () => {
    let state = transcriptReducer(initialTranscriptState, partial(0, 'mic hi', undefined, 'mic'))
    state = transcriptReducer(state, partial(0, 'loopback hi', undefined, 'loopback'))
    expect(state.lines.find((l) => l.source === 'mic')).toBeDefined()
    expect(state.lines.find((l) => l.source === 'loopback')).toBeDefined()
    state = transcriptReducer(state, final(0, 'mic hi', undefined, 'mic'))
    expect(state.lines.find((l) => l.kind === 'final' && l.source === 'mic')?.source).toBe('mic')
  })
})

describe('transcript-reducer (plan step 9 - cross-track seq collision)', () => {
  it('interleaved mic+loopback streams with colliding seq values produce two independent lines', () => {
    let state = initialTranscriptState
    // Both adapters start seq at 0, emit colliding seq values interleaved
    state = transcriptReducer(state, partial(0, 'mic hello', undefined, 'mic', 'partial:mic:0'))
    state = transcriptReducer(
      state,
      partial(0, 'loopback hello', undefined, 'loopback', 'partial:loopback:0')
    )
    expect(state.lines).toHaveLength(2)
    expect(state.lines[0]).toMatchObject({
      source: 'mic',
      text: 'mic hello',
      segmentId: 'partial:mic:0'
    })
    expect(state.lines[1]).toMatchObject({
      source: 'loopback',
      text: 'loopback hello',
      segmentId: 'partial:loopback:0'
    })

    // Revisions on each track stay independent - mic seq 0 revised, loopback seq 0 untouched
    state = transcriptReducer(
      state,
      partial(0, 'mic hello world', undefined, 'mic', 'partial:mic:0')
    )
    expect(state.lines).toHaveLength(2)
    expect(state.lines[0].text).toBe('mic hello world')
    expect(state.lines[1].text).toBe('loopback hello')

    // Committing one track does not delete the other's in-flight line
    state = transcriptReducer(state, final(0, 'mic hello world', undefined, 'mic', 'final:mic:0'))
    expect(state.lines).toHaveLength(2)
    expect(state.lines.find((l) => l.source === 'mic')?.kind).toBe('final')
    expect(state.lines.find((l) => l.source === 'loopback')?.kind).toBe('partial')
    expect(state.lines.find((l) => l.source === 'loopback')?.text).toBe('loopback hello')
  })

  it('revision replaces rather than appends (same segmentId)', () => {
    let state = initialTranscriptState
    // Wlk fixture 11 -> 12 same segmentId "0:00:00.34:0" extended text
    state = transcriptReducer(
      state,
      final(
        0,
        'testing 1, 2, 3. This is the Vero meeting transcription',
        undefined,
        'mic',
        '0:00:00.34:0'
      )
    )
    expect(state.lines).toHaveLength(1)
    expect(state.lines[0].text).toBe('testing 1, 2, 3. This is the Vero meeting transcription')

    state = transcriptReducer(
      state,
      final(
        1,
        'testing 1, 2, 3. This is the Vero meeting transcription test',
        undefined,
        'mic',
        '0:00:00.34:0'
      )
    )
    expect(state.lines).toHaveLength(1)
    expect(state.lines[0].text).toBe('testing 1, 2, 3. This is the Vero meeting transcription test')
    expect(state.lines[0].segmentId).toBe('0:00:00.34:0')
  })

  it('cap evicts oldest-first when committed lines exceed MAX_COMMITTED_LINES', () => {
    let state = initialTranscriptState
    for (let i = 0; i < MAX_COMMITTED_LINES + 5; i++) {
      state = transcriptReducer(state, final(i, `line ${i}`, undefined, 'mic', `final:mic:${i}`))
    }
    expect(state.lines.filter((l) => l.kind === 'final')).toHaveLength(MAX_COMMITTED_LINES)
    // Oldest 5 should be evicted: first remaining should be line 5
    expect(state.lines[0].text).toBe('line 5')
    expect(state.lines[state.lines.length - 1].text).toBe(`line ${MAX_COMMITTED_LINES + 4}`)
    // Partials are not counted towards cap and survive eviction
    state = transcriptReducer(state, partial(999, 'in-flight', undefined, 'mic', 'partial:mic:999'))
    expect(state.lines.some((l) => l.kind === 'partial' && l.text === 'in-flight')).toBe(true)
    expect(state.lines.filter((l) => l.kind === 'final')).toHaveLength(MAX_COMMITTED_LINES)
  })
})
