import { describe, expect, it, vi } from 'vitest'
import { broadcastTranscriptEvent } from '../src/main/transcript/transcript-broadcast'
import type { BroadcastWindow } from '../src/main/transcript/transcript-broadcast'
import { TRANSCRIPT_EVENT_CHANNEL } from '../src/shared/types'
import type { TranscriptEvent } from '../src/shared/types'

/**
 * Seam under test (pre-agreed, plan step 18): the main-process broadcast --
 * adapter events reach webContents.send('transcript-event', event) on BOTH
 * windows (main + overlay), skipping null slots and destroyed windows.
 */

const event: TranscriptEvent = { source: 'mic', kind: 'partial', text: 'hi', seq: 0, ts: 1 }

function fakeWindow(destroyed = false): BroadcastWindow {
  return {
    isDestroyed: () => destroyed,
    webContents: { send: vi.fn() }
  }
}

describe('transcript-broadcast', () => {
  it('sends the transcript event to BOTH windows with the payload', () => {
    const main = fakeWindow()
    const overlay = fakeWindow()
    broadcastTranscriptEvent([main, overlay], event)
    expect(main.webContents.send).toHaveBeenCalledWith(TRANSCRIPT_EVENT_CHANNEL, event)
    expect(overlay.webContents.send).toHaveBeenCalledWith(TRANSCRIPT_EVENT_CHANNEL, event)
  })

  it('skips null window slots and destroyed windows', () => {
    const main = fakeWindow()
    const destroyed = fakeWindow(true)
    broadcastTranscriptEvent([main, destroyed, null], event)
    expect(main.webContents.send).toHaveBeenCalledTimes(1)
    expect(destroyed.webContents.send).not.toHaveBeenCalled()
  })

  it('broadcasts on the shared channel constant', () => {
    expect(TRANSCRIPT_EVENT_CHANNEL).toBe('transcript-event')
  })
})
