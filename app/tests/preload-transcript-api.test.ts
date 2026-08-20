import { describe, expect, it, vi } from 'vitest'
import {
  resolveWindowRole,
  subscribeTranscriptEvents,
  WINDOW_ROLE_ARG,
  type IpcSubscribe
} from '../src/preload/transcript-api'
import { TRANSCRIPT_EVENT_CHANNEL } from '../src/shared/types'
import type { TranscriptEvent } from '../src/shared/types'

/**
 * Seam under test (pre-agreed, plan step 18): the preload transcript helpers --
 * window-role resolution from process.argv (additionalArguments) and the
 * onTranscriptEvent subscription wiring. Both are electron-free so they run
 * without mocking; the preload index.ts binds them to the real ipcRenderer.
 */

const event: TranscriptEvent = { source: 'mic', kind: 'final', text: 'done', seq: 0, ts: 1 }

function fakeIpc(): IpcSubscribe & {
  on: ReturnType<typeof vi.fn>
  removeListener: ReturnType<typeof vi.fn>
  listeners: Array<(event: unknown, ...args: unknown[]) => void>
} {
  const listeners: Array<(event: unknown, ...args: unknown[]) => void> = []
  return {
    listeners,
    on: vi.fn((_channel: string, listener: (event: unknown, ...args: unknown[]) => void) => {
      listeners.push(listener)
      return {}
    }),
    removeListener: vi.fn()
  }
}

describe('resolveWindowRole (preload)', () => {
  it('defaults to main when the overlay arg is absent', () => {
    expect(resolveWindowRole(['electron', '.'])).toBe('main')
    expect(resolveWindowRole([])).toBe('main')
  })

  it('returns overlay when the overlay arg is present', () => {
    expect(resolveWindowRole(['electron', '.', WINDOW_ROLE_ARG])).toBe('overlay')
  })
})

describe('subscribeTranscriptEvents (preload)', () => {
  it('registers on the transcript-event channel and forwards payloads to the callback', () => {
    const ipc = fakeIpc()
    const cb = vi.fn()
    subscribeTranscriptEvents(ipc, cb)
    expect(ipc.on).toHaveBeenCalledWith(TRANSCRIPT_EVENT_CHANNEL, expect.any(Function))

    ipc.listeners[0]({}, event)
    expect(cb).toHaveBeenCalledWith(event)
  })

  it('returned unsubscribe removes the same listener', () => {
    const ipc = fakeIpc()
    const unsubscribe = subscribeTranscriptEvents(ipc, vi.fn())
    unsubscribe()
    expect(ipc.removeListener).toHaveBeenCalledWith(TRANSCRIPT_EVENT_CHANNEL, ipc.listeners[0])
  })
})
