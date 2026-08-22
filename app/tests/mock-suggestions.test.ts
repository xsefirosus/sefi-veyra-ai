import { describe, expect, it, vi, afterEach } from 'vitest'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  CANNED_SUGGESTION_DELTAS,
  MockSuggestionAdapter,
  resolveTestSuggestionDeltas
} from '../src/main/llm/mock-suggestions'
import { broadcastSuggestionEvent } from '../src/main/transcript/suggestion-broadcast'
import { SUGGESTION_EVENT_CHANNEL } from '../src/shared/types'
import type { LlmAdapter, SuggestionDelta } from '../src/shared/llm/llm-adapter'
import type { BroadcastWindow } from '../src/main/transcript/transcript-broadcast'

/**
 * Seams under test (pre-agreed checkpoint, phase 3 step 17):
 *  1. Env gating — absent env -> null (unreachable normally)
 *  2. MockSuggestionAdapter implements LlmAdapter (AbortSignal + delta/complete)
 *  3. Built-in canned sequence shape + terminal complete
 *  4. Fixture file path -> parsed deltas with per-event delayMs stripped
 *  5. REAL SUGGESTION_EVENT_CHANNEL broadcast to BOTH windows
 * No test at unconfirmed seam.
 */

function fakeWindow(destroyed = false): BroadcastWindow {
  return {
    isDestroyed: () => destroyed,
    webContents: { send: vi.fn() }
  }
}

describe('mock-suggestions seam (phase 3 step 17)', () => {
  const orig = process.env['VEYRA_TEST_SUGGESTIONS']

  afterEach(() => {
    if (orig === undefined) delete process.env['VEYRA_TEST_SUGGESTIONS']
    else process.env['VEYRA_TEST_SUGGESTIONS'] = orig
    vi.restoreAllMocks()
  })

  it('env gating: absent env -> null (unreachable in normal runs)', () => {
    expect(resolveTestSuggestionDeltas(undefined)).toBeNull()
    expect(resolveTestSuggestionDeltas('')).toBeNull()
    expect(resolveTestSuggestionDeltas('   ')).toBeNull()
  })

  it('built-in canned sequence: any truthy value -> CANNED_SUGGESTION_DELTAS', () => {
    const deltas = resolveTestSuggestionDeltas('1')
    expect(deltas).toEqual(CANNED_SUGGESTION_DELTAS)
    expect(resolveTestSuggestionDeltas('true')).toEqual(CANNED_SUGGESTION_DELTAS)
  })

  it('canned sequence ends with a terminal complete whose text equals joined deltas', () => {
    expect(CANNED_SUGGESTION_DELTAS.length).toBeGreaterThan(2)
    const last = CANNED_SUGGESTION_DELTAS[CANNED_SUGGESTION_DELTAS.length - 1]
    expect(last.type).toBe('complete')
    if (last.type === 'complete') {
      const joined = CANNED_SUGGESTION_DELTAS.filter((d) => d.type === 'delta')
        .map((d) => (d as Extract<SuggestionDelta, { type: 'delta' }>).textDelta)
        .join('')
      expect(last.suggestion.text).toBe(joined)
    }
  })

  it('MockSuggestionAdapter satisfies LlmAdapter and streams deltas then complete', async () => {
    const adapter: LlmAdapter = new MockSuggestionAdapter(CANNED_SUGGESTION_DELTAS)
    expect(adapter).toBeInstanceOf(MockSuggestionAdapter)
    const out: SuggestionDelta[] = []
    for await (const d of adapter.streamSuggestions({ events: [] })) {
      out.push(d)
    }
    expect(out).toEqual(CANNED_SUGGESTION_DELTAS)
  })

  it('MockSuggestionAdapter honors AbortSignal mid-stream', async () => {
    const adapter = new MockSuggestionAdapter(CANNED_SUGGESTION_DELTAS)
    const controller = new AbortController()
    const out: SuggestionDelta[] = []
    for await (const d of adapter.streamSuggestions({ events: [] }, controller.signal)) {
      out.push(d)
      if (out.length === 1) controller.abort()
    }
    expect(out).toHaveLength(1)
    expect(out[0]?.type).toBe('delta')
  })

  it('fixture file path: parses JSON array of deltas (strips delayMs)', () => {
    const fixturePath = join(tmpdir(), `veyra-suggestion-fixture-${Date.now()}.json`)
    const fixture = [
      { type: 'delta', kind: 'summary', textDelta: 'Hello ', delayMs: 123 },
      { type: 'delta', kind: 'summary', textDelta: 'world', delayMs: 456 },
      { type: 'complete', suggestion: { text: 'Hello world', kind: 'summary' }, delayMs: 0 }
    ]
    writeFileSync(fixturePath, JSON.stringify(fixture), 'utf8')
    try {
      const deltas = resolveTestSuggestionDeltas(fixturePath)
      expect(deltas).toEqual([
        { type: 'delta', kind: 'summary', textDelta: 'Hello ' },
        { type: 'delta', kind: 'summary', textDelta: 'world' },
        { type: 'complete', suggestion: { text: 'Hello world', kind: 'summary' } }
      ])
    } finally {
      try {
        unlinkSync(fixturePath)
      } catch (_e) {
        void _e
      }
    }
  })

  it('fixture file path: invalid JSON or missing file falls back to built-in', () => {
    const badPath = join(tmpdir(), `veyra-bad-${Date.now()}.json`)
    writeFileSync(badPath, 'not json {{{', 'utf8')
    try {
      const deltas = resolveTestSuggestionDeltas(badPath)
      expect(deltas).toEqual(CANNED_SUGGESTION_DELTAS)
    } finally {
      try {
        unlinkSync(badPath)
      } catch (_e) {
        void _e
      }
    }
    // Missing file also falls back
    expect(resolveTestSuggestionDeltas('/tmp/does-not-exist-xyz-123.json')).toEqual(
      CANNED_SUGGESTION_DELTAS
    )
  })

  it('emits through REAL SUGGESTION_EVENT_CHANNEL to BOTH windows', async () => {
    const main = fakeWindow()
    const overlay = fakeWindow()
    const adapter = new MockSuggestionAdapter(CANNED_SUGGESTION_DELTAS)
    for await (const d of adapter.streamSuggestions({ events: [] })) {
      broadcastSuggestionEvent([main, overlay], d)
    }
    // Every canned delta was sent on the real channel to both windows
    expect(main.webContents.send).toHaveBeenCalledTimes(CANNED_SUGGESTION_DELTAS.length)
    expect(overlay.webContents.send).toHaveBeenCalledTimes(CANNED_SUGGESTION_DELTAS.length)
    expect(main.webContents.send).toHaveBeenCalledWith(
      SUGGESTION_EVENT_CHANNEL,
      CANNED_SUGGESTION_DELTAS[0]
    )
  })
})
