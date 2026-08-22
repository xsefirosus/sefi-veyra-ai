import { describe, expect, it, vi } from 'vitest'
import { broadcastSuggestionEvent } from '../src/main/transcript/suggestion-broadcast'
import type { BroadcastWindow } from '../src/main/transcript/transcript-broadcast'
import { SUGGESTION_EVENT_CHANNEL } from '../src/shared/types'
import type { SuggestionDelta } from '../src/shared/llm/llm-adapter'

/**
 * Seam under test (pre-agreed, phase 3 step 15): the main-process suggestion
 * broadcast — adapter deltas reach webContents.send('suggestion-event', delta)
 * on BOTH windows (main + overlay), skipping null slots and destroyed windows.
 * Mirrors transcript-broadcast.test.ts's exact contract.
 */

const delta: SuggestionDelta = { type: 'delta', kind: 'action-item', textDelta: 'hi ' }
const complete: SuggestionDelta = {
  type: 'complete',
  suggestion: { text: 'hi there', kind: 'action-item' }
}

function fakeWindow(destroyed = false): BroadcastWindow {
  return {
    isDestroyed: () => destroyed,
    webContents: { send: vi.fn() }
  }
}

describe('suggestion-broadcast', () => {
  it('sends the suggestion delta to BOTH windows with the payload', () => {
    const main = fakeWindow()
    const overlay = fakeWindow()
    broadcastSuggestionEvent([main, overlay], delta)
    expect(main.webContents.send).toHaveBeenCalledWith(SUGGESTION_EVENT_CHANNEL, delta)
    expect(overlay.webContents.send).toHaveBeenCalledWith(SUGGESTION_EVENT_CHANNEL, delta)
  })

  it('skips null window slots and destroyed windows', () => {
    const main = fakeWindow()
    const destroyed = fakeWindow(true)
    broadcastSuggestionEvent([main, destroyed, null], complete)
    expect(main.webContents.send).toHaveBeenCalledTimes(1)
    expect(destroyed.webContents.send).not.toHaveBeenCalled()
  })

  it('broadcasts on the shared channel constant', () => {
    expect(SUGGESTION_EVENT_CHANNEL).toBe('suggestion-event')
  })

  it('forwards complete events as well as deltas', () => {
    const main = fakeWindow()
    const overlay = fakeWindow()
    broadcastSuggestionEvent([main, overlay], complete)
    expect(main.webContents.send).toHaveBeenCalledWith(SUGGESTION_EVENT_CHANNEL, complete)
  })
})
