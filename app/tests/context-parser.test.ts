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

  it('every produced event has non-empty text, kind partial|final, and segmentId', () => {
    const events: TranscriptEvent[] = fixture.flatMap((msg, i) =>
      normalizeWlkMessage(msg, 'mic', i)
    )
    // The fixture's text-bearing evidence is 2 partials + 2 finals (per-lines).
    expect(events.length).toBe(4)
    for (const ev of events) {
      expect(ev.text.trim().length).toBeGreaterThan(0)
      expect(ev.kind === 'partial' || ev.kind === 'final').toBe(true)
      expect(typeof ev.segmentId).toBe('string')
      expect(ev.segmentId.length).toBeGreaterThan(0)
    }
  })

  it('final segmentIds are stable from start+index (revisions share the same id)', () => {
    const finalsA = normalizeWlkMessage(fixture[11], 'mic', 11)
    const finalsB = normalizeWlkMessage(fixture[12], 'mic', 12)
    expect(finalsA).toHaveLength(1)
    expect(finalsB).toHaveLength(1)
    expect(finalsA[0].kind).toBe('final')
    expect(finalsB[0].kind).toBe('final')
    // Both derive from lines[0] start "0:00:00.34" index 0 => "0:00:00.34:0"
    expect(finalsA[0].segmentId).toBe('0:00:00.34:0')
    expect(finalsB[0].segmentId).toBe('0:00:00.34:0')
    expect(finalsA[0].segmentId).toBe(finalsB[0].segmentId)
    expect(finalsA[0].start).toBe('0:00:00.34')
    expect(finalsB[0].start).toBe('0:00:00.34')
  })

  it('replaying all 14 fixture messages yields exactly one committed segment with final text', () => {
    const allEvents = fixture.flatMap((msg, i) => normalizeWlkMessage(msg, 'mic', i))
    const finals = allEvents.filter((e) => e.kind === 'final')
    // Deduplicate by segmentId — in-place revisions share the same id, so
    // the two raw finals (indexes 11 and 12) collapse to one committed segment.
    const bySegment = new Map<string, TranscriptEvent>()
    for (const ev of finals) bySegment.set(ev.segmentId, ev)
    expect(bySegment.size).toBe(1)
    const committed = [...bySegment.values()][0]
    expect(committed.text).toBe('testing 1, 2, 3. This is the Vero meeting transcription test')
    expect(committed.segmentId).toBe('0:00:00.34:0')
    expect(committed.start).toBe('0:00:00.34')
    expect(committed.speakerId).toBe(1)
    expect(committed.detectedLanguage).toBe('en')
  })

  it('derives partials from buffer_transcription and finals from committed lines', () => {
    // index 10: buffer_transcription " Testing 1, 2, 3" -> partial, trimmed.
    const partials = normalizeWlkMessage(fixture[10], 'mic', 10)
    expect(partials).toHaveLength(1)
    expect(partials[0].kind).toBe('partial')
    expect(partials[0].text).toBe('Testing 1, 2, 3')
    expect(partials[0].segmentId).toBe('partial:mic:10')

    // indexes 11-12: committed lines[] text -> final.
    const finalA = normalizeWlkMessage(fixture[11], 'mic', 11)
    expect(finalA).toHaveLength(1)
    expect(finalA[0].kind).toBe('final')
    expect(finalA[0].text).toBe('testing 1, 2, 3. This is the Vero meeting transcription')

    const finalB = normalizeWlkMessage(fixture[12], 'mic', 12)
    expect(finalB).toHaveLength(1)
    expect(finalB[0].kind).toBe('final')
    expect(finalB[0].text).toBe('testing 1, 2, 3. This is the Vero meeting transcription test')
  })

  it('emits one event per non-empty lines[] entry (not just the last)', () => {
    const msg = JSON.stringify({
      status: 'active_transcription',
      lines: [
        {
          speaker: 1,
          text: ' hello',
          start: '0:00:00.10',
          end: '0:00:01.00',
          detected_language: 'en'
        },
        {
          speaker: 2,
          text: ' world',
          start: '0:00:01.10',
          end: '0:00:02.00',
          detected_language: 'en'
        }
      ],
      buffer_transcription: ''
    })
    const events = normalizeWlkMessage(msg, 'mic', 0)
    expect(events).toHaveLength(2)
    expect(events[0].text).toBe('hello')
    expect(events[0].segmentId).toBe('0:00:00.10:0')
    expect(events[1].text).toBe('world')
    expect(events[1].segmentId).toBe('0:00:01.10:1')
    expect(events[0].speakerId).toBe(1)
    expect(events[1].speakerId).toBe(2)
  })

  it('control and empty messages produce no events', () => {
    // index 0: {"type":"config",...}; index 13: {"type":"ready_to_stop"}.
    expect(normalizeWlkMessage(fixture[0], 'mic', 0)).toEqual([])
    expect(normalizeWlkMessage(fixture[13], 'mic', 13)).toEqual([])
    // index 1: no_audio_detected with empty buffer_transcription and lines[].
    expect(normalizeWlkMessage(fixture[1], 'mic', 1)).toEqual([])
    // index 3: active_transcription whose only line has text "".
    expect(normalizeWlkMessage(fixture[3], 'mic', 3)).toEqual([])
  })

  it('source defaults to mic and is overridable per capture track', () => {
    const mic = normalizeWlkMessage(fixture[10])
    expect(mic).toHaveLength(1)
    expect(mic[0].source).toBe('mic')
    const loopback = normalizeWlkMessage(fixture[10], 'loopback', 0)
    expect(loopback).toHaveLength(1)
    expect(loopback[0].source).toBe('loopback')
    expect(loopback[0].kind).toBe('partial')
    expect(loopback[0].segmentId).toBe('partial:loopback:0')
  })

  it('non-JSON payloads parse to empty array, never throw', () => {
    expect(normalizeWlkMessage('not json {')).toEqual([])
    expect(normalizeWlkMessage(42)).toEqual([])
    expect(normalizeWlkMessage(null)).toEqual([])
    expect(normalizeWlkMessage([])).toEqual([])
  })
})
