/**
 * Preload transcript helpers (plan step 18), kept free of electron imports so
 * the wiring (subscription + window-role resolution) is unit-testable without
 * mocking Electron. The preload (index.ts) binds these to the real
 * ipcRenderer and process.argv.
 */
import { SUGGESTION_EVENT_CHANNEL, TRANSCRIPT_EVENT_CHANNEL } from '../shared/types'
import type { TranscriptEvent } from '../shared/types'
import type { SuggestionDelta } from '../shared/llm/llm-adapter'

/** additionalArguments token that marks the overlay window (windows.ts). */
export const WINDOW_ROLE_ARG = '--veyra-window=overlay'

export type WindowRole = 'main' | 'overlay'

/** Resolve the window role from the renderer's process.argv (additionalArguments). */
export function resolveWindowRole(argv: readonly string[]): WindowRole {
  return argv.includes(WINDOW_ROLE_ARG) ? 'overlay' : 'main'
}

export const THEME_ARG_PREFIX = '--veyra-theme='

export type Theme = 'light' | 'dark'

/** Resolve the persisted theme from additionalArguments; defaults to 'light'. */
export function resolveInitialTheme(argv: readonly string[]): Theme {
  const found = argv.find((a) => a.startsWith(THEME_ARG_PREFIX))
  if (!found) return 'light'
  const value = found.slice(THEME_ARG_PREFIX.length)
  return value === 'dark' ? 'dark' : 'light'
}

export const STEALTH_ARG_PREFIX = '--veyra-stealth='

/** Resolve the persisted stealthMode from additionalArguments; defaults to false. */
export function resolveInitialStealthMode(argv: readonly string[]): boolean {
  const found = argv.find((a) => a.startsWith(STEALTH_ARG_PREFIX))
  if (!found) return false
  return found.slice(STEALTH_ARG_PREFIX.length) === '1'
}

/** Structural slice of ipcRenderer used here (testable without Electron). */
export interface IpcSubscribe {
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
}

/** Shape-guard for the IPC payload (the fields the reducer consumes). */
function isTranscriptEvent(value: unknown): value is TranscriptEvent {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    (v.kind === 'partial' || v.kind === 'final') &&
    typeof v.text === 'string' &&
    typeof v.seq === 'number'
  )
}

/**
 * Subscribe to main-process transcript events; returns an unsubscribe fn.
 * Every renderer window subscribes (main broadcasts each event to BOTH), and
 * the returned fn is what React effect cleanup calls. Malformed payloads on
 * the channel are dropped at this trust boundary, never forwarded.
 */
export function subscribeTranscriptEvents(
  ipc: IpcSubscribe,
  cb: (event: TranscriptEvent) => void
): () => void {
  const listener = (_event: unknown, ...args: unknown[]): void => {
    const event = args[0]
    if (isTranscriptEvent(event)) cb(event)
  }
  ipc.on(TRANSCRIPT_EVENT_CHANNEL, listener)
  return () => {
    ipc.removeListener(TRANSCRIPT_EVENT_CHANNEL, listener)
  }
}

/** Shape-guard for suggestion deltas (phase 3 step 15). */
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
 * Subscribe to main-process suggestion deltas; returns an unsubscribe fn.
 * Mirrors subscribeTranscriptEvents's exact pattern (phase 3 step 15).
 * Malformed payloads are dropped at this trust boundary, never forwarded.
 */
export function subscribeSuggestionEvents(
  ipc: IpcSubscribe,
  cb: (event: SuggestionDelta) => void
): () => void {
  const listener = (_event: unknown, ...args: unknown[]): void => {
    const event = args[0]
    if (isSuggestionDelta(event)) cb(event)
  }
  ipc.on(SUGGESTION_EVENT_CHANNEL, listener)
  return () => {
    ipc.removeListener(SUGGESTION_EVENT_CHANNEL, listener)
  }
}
