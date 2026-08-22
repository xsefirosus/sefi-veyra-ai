import { describe, expect, it, vi } from 'vitest'
import { subscribeSuggestionEvents, type IpcSubscribe } from '../src/preload/transcript-api'
import { SUGGESTION_EVENT_CHANNEL } from '../src/shared/types'
import type { SuggestionDelta } from '../src/shared/llm/llm-adapter'

/**
 * Seam under test (pre-agreed, phase 3 step 15): the preload suggestion
 * helpers — subscription wiring and trust-boundary shape guard, mirroring
 * preload-transcript-api.test.ts's contract.
 */

const delta: SuggestionDelta = { type: 'delta', kind: 'action-item', textDelta: 'hi ' }
const complete: SuggestionDelta = {
  type: 'complete',
  suggestion: { text: 'hi there', kind: 'action-item' }
}

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

describe('subscribeSuggestionEvents (preload)', () => {
  it('registers on the suggestion-event channel and forwards payloads to the callback', () => {
    const ipc = fakeIpc()
    const cb = vi.fn()
    subscribeSuggestionEvents(ipc, cb)
    expect(ipc.on).toHaveBeenCalledWith(SUGGESTION_EVENT_CHANNEL, expect.any(Function))

    ipc.listeners[0]({}, delta)
    expect(cb).toHaveBeenCalledWith(delta)

    ipc.listeners[0]({}, complete)
    expect(cb).toHaveBeenCalledWith(complete)
  })

  it('drops malformed payloads at the trust boundary', () => {
    const ipc = fakeIpc()
    const cb = vi.fn()
    subscribeSuggestionEvents(ipc, cb)
    // Missing textDelta
    ipc.listeners[0]({}, { type: 'delta', kind: 'action-item' })
    // Invalid kind
    ipc.listeners[0]({}, { type: 'delta', kind: 'nonsense', textDelta: 'hi' })
    // Complete with missing suggestion text
    ipc.listeners[0]({}, { type: 'complete', suggestion: { kind: 'action-item' } })
    expect(cb).not.toHaveBeenCalled()
  })

  it('returned unsubscribe removes the same listener', () => {
    const ipc = fakeIpc()
    const unsubscribe = subscribeSuggestionEvents(ipc, vi.fn())
    unsubscribe()
    expect(ipc.removeListener).toHaveBeenCalledWith(SUGGESTION_EVENT_CHANNEL, ipc.listeners[0])
  })
})
