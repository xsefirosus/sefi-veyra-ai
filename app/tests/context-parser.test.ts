import { describe, expect, it } from 'vitest'
import { normalizeWlkMessage } from '../src/shared/stt/context-parser'
import type { TranscriptEvent } from '../src/shared/types'
import rawFixture from './fixtures/wlk-messages.json'

// The step-14 fixture: 14 JSON strings captured verbatim from wlk's
// ws://127.0.0.1:9090/asr stream.
const fixture: unknown[] = rawFixture as unknown[]

describe('context-parser (normalizeWlkMessage)', () => {
  it('every fixture message parses without throwing', () => {
    for (const msg of fixture) {
      expect(() => normalizeWlkMessage(msg)).not.toThrow()
    }
  })

  it('every produced event has non-empty text and kind partial|final', () => {
    const events: TranscriptEvent[] = []
    fixture.forEach((msg, i) => {
      const ev = normalizeWlkMessage(msg, 'mic', i)
      if (ev !== null) events.push(ev)
    })
    // The fixture's text-bearing evidence is 2 partials + 2 finals.
    expect(events.length).toBe(4)
    for (const ev of events) {
      expect(ev.text.trim().length).toBeGreaterThan(0)
      expect(ev.kind === 'partial' || ev.kind === 'final').toBe(true)
    }
  })

  it('seq is monotonic across produced events (caller-stamped, passthrough)', () => {
    const seqs: number[] = []
    fixture.forEach((msg, i) => {
      const ev = normalizeWlkMessage(msg, 'mic', i)
      if (ev !== null) seqs.push(ev.seq)
    })
    expect(seqs.length).toBe(4)
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1])
    }
  })

  it('derives partials from buffer_transcription and finals from committed lines', () => {
    // index 10: buffer_transcription " Testing 1, 2, 3" -> partial, trimmed.
    const partial = normalizeWlkMessage(fixture[10], 'mic', 10)
    expect(partial?.kind).toBe('partial')
    expect(partial?.text).toBe('Testing 1, 2, 3')

    // indexes 11-12: committed lines[] text -> final.
    const finalA = normalizeWlkMessage(fixture[11], 'mic', 11)
    expect(finalA?.kind).toBe('final')
    expect(finalA?.text).toBe('testing 1, 2, 3. This is the Vero meeting transcription')

    const finalB = normalizeWlkMessage(fixture[12], 'mic', 12)
    expect(finalB?.kind).toBe('final')
    expect(finalB?.text).toBe('testing 1, 2, 3. This is the Vero meeting transcription test')
  })

  it('control and empty messages produce no event', () => {
    // index 0: {"type":"config",...}; index 13: {"type":"ready_to_stop"}.
    expect(normalizeWlkMessage(fixture[0], 'mic', 0)).toBeNull()
    expect(normalizeWlkMessage(fixture[13], 'mic', 13)).toBeNull()
    // index 1: no_audio_detected with empty buffer_transcription and lines[].
    expect(normalizeWlkMessage(fixture[1], 'mic', 1)).toBeNull()
    // index 3: active_transcription whose only line has text "".
    expect(normalizeWlkMessage(fixture[3], 'mic', 3)).toBeNull()
  })

  it('source defaults to mic and is overridable per capture track', () => {
    const mic = normalizeWlkMessage(fixture[10])
    expect(mic?.source).toBe('mic')
    const loopback = normalizeWlkMessage(fixture[10], 'loopback', 0)
    expect(loopback?.source).toBe('loopback')
    expect(loopback?.kind).toBe('partial')
  })

  it('non-JSON payloads parse to null, never throw', () => {
    expect(normalizeWlkMessage('not json {')).toBeNull()
    expect(normalizeWlkMessage(42)).toBeNull()
    expect(normalizeWlkMessage(null)).toBeNull()
    expect(normalizeWlkMessage([])).toBeNull()
  })
})
