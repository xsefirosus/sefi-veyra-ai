/**
 * Preload transcript helpers (plan step 18), kept free of electron imports so
 * the wiring (subscription + window-role resolution) is unit-testable without
 * mocking Electron. The preload (index.ts) binds these to the real
 * ipcRenderer and process.argv.
 */
import { TRANSCRIPT_EVENT_CHANNEL } from '../shared/types'
import type { TranscriptEvent } from '../shared/types'

/** additionalArguments token that marks the overlay window (windows.ts). */
export const WINDOW_ROLE_ARG = '--veyra-window=overlay'

export type WindowRole = 'main' | 'overlay'

/** Resolve the window role from the renderer's process.argv (additionalArguments). */
export function resolveWindowRole(argv: readonly string[]): WindowRole {
  return argv.includes(WINDOW_ROLE_ARG) ? 'overlay' : 'main'
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
