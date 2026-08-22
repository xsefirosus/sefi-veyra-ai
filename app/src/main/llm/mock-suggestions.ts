/**
 * Mock suggestion seam (phase 3 step 17) — VEYRA_TEST_SUGGESTIONS.
 *
 * Mirrors VEYRA_TEST_AUDIO exactly: when env var is set, main constructs a
 * MockLlmAdapter that emits canned SuggestionDelta events through the REAL
 * SUGGESTION_EVENT_CHANNEL broadcast on a timer, exercising the real reducer
 * and the real AnswerPanel end to end. Env-gated: unreachable in normal runs.
 *
 * Seams under test (pre-agreed checkpoint, prior to first test):
 *  1. Env gating — VEYRA_TEST_SUGGESTIONS absent -> no broadcast, no adapter
 *     construction (never reachable normally).
 *  2. MockLlmAdapter contract — implements LlmAdapter.streamSuggestions with
 *     token-level delta + terminal complete + AbortSignal, same as llm-adapter.test.ts.
 *  3. REAL channel — broadcastSuggestionEvent via SUGGESTION_EVENT_CHANNEL to BOTH
 *     windows (mirrors transcript-broadcast's exact pattern).
 *  4. Timer pacing — delta-by-delta growth so overlay visibly progresses through
 *     Listening -> Generating -> Ready (same growth proof as step 16's CSS transition).
 *  5. Fixture choice — built-in canned sequence when env var is any truthy value;
 *     when env var names an existing JSON file containing an array of
 *     SuggestionDelta events (optionally with per-event delayMs), that file is
 *     used instead. Choice documented here; file path support is opportunistic
 *     and falls back to built-in on parse error.
 *
 * No test is written at an unconfirmed seam.
 */

import { existsSync, readFileSync } from 'fs'
import type { LlmAdapter, SuggestionDelta, TranscriptContext } from '../../shared/llm/llm-adapter'
import { broadcastSuggestionEvent } from '../transcript/suggestion-broadcast'
import type { BroadcastWindow } from '../transcript/transcript-broadcast'

/**
 * Built-in canned suggestion sequence — realistic pacing for the overlay growth
 * verification (Listening -> Generating -> Ready). The joined text matches the
 * terminal complete's suggestion.text exactly, as the reducer asserts.
 */
export const CANNED_SUGGESTION_DELTAS: SuggestionDelta[] = [
  { type: 'delta', kind: 'action-item', textDelta: 'Here is a ' },
  { type: 'delta', kind: 'action-item', textDelta: 'suggested response: ' },
  { type: 'delta', kind: 'action-item', textDelta: '"Thanks for the update \u2014 ' },
  { type: 'delta', kind: 'action-item', textDelta: 'let us align on next steps"' },
  {
    type: 'complete',
    suggestion: {
      text: 'Here is a suggested response: "Thanks for the update \u2014 let us align on next steps"',
      kind: 'action-item'
    }
  }
]

/** Per-event delay hint in fixture files (optional, ms). */
export type CannedFixtureEntry = SuggestionDelta & { delayMs?: number }

/**
 * Validate a single SuggestionDelta shape (same guard as preload/transcript-api.ts,
 * plus suggestion.text for complete). Returns true if valid.
 */
function isSuggestionDelta(value: unknown): value is SuggestionDelta {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (v.type === 'delta') {
    return (
      (v.kind === 'action-item' || v.kind === 'summary' || v.kind === 'question') &&
      typeof v.textDelta === 'string'
    )
  }
  if (v.type === 'complete') {
    const s = v.suggestion as Record<string, unknown> | undefined
    return (
      typeof s === 'object' &&
      s !== null &&
      typeof s.text === 'string' &&
      (s.kind === 'action-item' || s.kind === 'summary' || s.kind === 'question')
    )
  }
  return false
}

/**
 * Resolve canned deltas from the env var value.
 * - null/empty -> not enabled (env-gated)
 * - value that is an existing file path to a JSON array of SuggestionDelta (with
 *   optional delayMs) -> those deltas (validated; falls back to built-in on error)
 * - any other truthy value ("1", "true", etc.) -> built-in canned sequence
 *
 * Pure and testable without Electron (no window, no timer).
 */
export function resolveTestSuggestionDeltas(
  envValue: string | undefined
): SuggestionDelta[] | null {
  if (!envValue) return null
  const trimmed = envValue.trim()
  if (!trimmed) return null

  // Try fixture file path when value looks like a path and file exists
  const isPathLike = trimmed.includes('/') || trimmed.includes('\\') || trimmed.endsWith('.json')
  if (isPathLike) {
    try {
      if (existsSync(trimmed)) {
        const raw = readFileSync(trimmed, 'utf8')
        const parsed: unknown = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) {
          const deltas: SuggestionDelta[] = []
          for (const entry of parsed) {
            // Strip delayMs before validation — fixture may carry it
            const candidate = (() => {
              if (typeof entry !== 'object' || entry === null) return entry

              const { delayMs, ...rest } = entry as Record<string, unknown>
              void delayMs
              return rest
            })()
            if (isSuggestionDelta(candidate)) {
              deltas.push(candidate as SuggestionDelta)
            }
          }
          if (deltas.length > 0) return deltas
        }
      }
    } catch {
      // Fall through to built-in on any read/parse/validation error
    }
  }

  // Default: built-in canned sequence (any truthy env value)
  return CANNED_SUGGESTION_DELTAS
}

/**
 * Resolve per-event delays for a delta sequence.
 * - When from a fixture file, honor each entry's delayMs (default 450ms for deltas, 0 for complete).
 * - For built-in, use paced defaults: 450ms between deltas, initial 1200ms before first.
 */
export function resolveDelaysForDeltas(
  deltas: SuggestionDelta[],
  fixtureEntries: unknown[] | null,
  initialDelayMs = 1200
): number[] {
  const delays: number[] = []
  let first = true
  for (let i = 0; i < deltas.length; i++) {
    if (first) {
      delays.push(initialDelayMs)
      first = false
    } else {
      // Inter-delta pacing; fixture delayMs overrides default when present
      let delay = deltas[i - 1]?.type === 'delta' ? 450 : 0
      if (fixtureEntries && typeof fixtureEntries[i] === 'object' && fixtureEntries[i] !== null) {
        const entry = fixtureEntries[i] as Record<string, unknown>
        if (
          typeof entry.delayMs === 'number' &&
          Number.isFinite(entry.delayMs) &&
          entry.delayMs >= 0
        ) {
          delay = entry.delayMs
        }
      }
      delays.push(delay)
    }
  }
  return delays
}

/**
 * MockLlmAdapter for the verification seam — implements the real LlmAdapter
 * interface (audit plan step 17 shape: streamSuggestions with AbortSignal).
 * Yields one delta per queued chunk (here pre-built deltas), then the terminal
 * complete. Respects AbortSignal at each boundary, never emitting complete after abort.
 */
export class MockSuggestionAdapter implements LlmAdapter {
  constructor(private readonly deltas: SuggestionDelta[]) {}

  async *streamSuggestions(
    _ctx: TranscriptContext,
    signal?: AbortSignal
  ): AsyncIterable<SuggestionDelta> {
    for (const d of this.deltas) {
      if (signal?.aborted) return
      yield d
      // For the seam's timer, the caller spaces yields; adapter itself does not delay
      if (d.type === 'complete') return
    }
  }
}

/**
 * Env-gated entry point for main/index.ts.
 * When VEYRA_TEST_SUGGESTIONS is set, constructs a MockSuggestionAdapter with
 * canned (or fixture) deltas and emits each through the REAL
 * SUGGESTION_EVENT_CHANNEL broadcast on a timer, exercising the real reducer + AnswerPanel.
 *
 * `getWindows` is a closure over the module-level mainWindow/overlayWindow refs
 * so late-bound values are used at broadcast time (windows may not exist at call time,
 * matching the VEYRA_TEST_AUDIO pattern where handleTestAudio starts before launchWindows).
 *
 * This function is a no-op when the env var is absent — unreachable in normal runs.
 */
export function handleTestSuggestions(getWindows: () => readonly (BroadcastWindow | null)[]): void {
  const envValue = process.env['VEYRA_TEST_SUGGESTIONS']
  const deltas = resolveTestSuggestionDeltas(envValue)
  if (!deltas) return

  // Try to preserve fixture delays when env pointed at a file
  let fixtureEntries: unknown[] | null = null
  const trimmed = envValue?.trim() ?? ''
  const isPathLike = trimmed.includes('/') || trimmed.includes('\\') || trimmed.endsWith('.json')
  if (isPathLike) {
    try {
      if (existsSync(trimmed)) {
        const parsed: unknown = JSON.parse(readFileSync(trimmed, 'utf8'))
        if (Array.isArray(parsed)) fixtureEntries = parsed
      }
    } catch {
      fixtureEntries = null
    }
  }

  const adapter = new MockSuggestionAdapter(deltas)
  const delays = resolveDelaysForDeltas(deltas, fixtureEntries)

  void (async () => {
    // Initial Listening state remains visible briefly before first delta
    let elapsed = 0
    let index = 0
    for await (const d of adapter.streamSuggestions({ events: [] })) {
      const delayMs = delays[index] ?? (d.type === 'delta' ? 450 : 0)
      elapsed += delayMs
      const snapshot = d
      setTimeout(() => {
        broadcastSuggestionEvent(getWindows(), snapshot)
      }, elapsed)
      index += 1
      // For deltas, the next iteration's delay already spaces them; complete is last
    }
    // Log for verification harness (mirrors VEYRA_TEST_AUDIO log)
    const afterMs = elapsed + 100
    setTimeout(() => {
      console.log(
        `[suggestions] VEYRA_TEST_SUGGESTIONS: emitted ${deltas.length} events (Listening->Generating->Ready) via ${'SUGGESTION_EVENT_CHANNEL'}`
      )
    }, afterMs)
  })()
}
