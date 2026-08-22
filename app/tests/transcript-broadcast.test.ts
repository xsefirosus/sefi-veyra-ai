import { describe, expect, it, vi } from 'vitest'
import {
  adapterEventToTranscriptEvent,
  broadcastTranscriptEvent
} from '../src/main/transcript/transcript-broadcast'
import type { BroadcastWindow } from '../src/main/transcript/transcript-broadcast'
import { TRANSCRIPT_EVENT_CHANNEL } from '../src/shared/types'
import type { TranscriptEvent } from '../src/shared/types'

/**
 * Seam under test (pre-agreed, plan step 18): the main-process broadcast --
 * adapter events reach webContents.send('transcript-event', event) on BOTH
 * windows (main + overlay), skipping null slots and destroyed windows.
 */

const event: TranscriptEvent = {
  source: 'mic',
  kind: 'partial',
  text: 'hi',
  seq: 0,
  ts: 1,
  segmentId: 'partial:mic:0'
}

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

/**
 * Audit-02 regression: main/index.ts's real interactive wiring
 * (wireAdapterEvents, handleTestAudio) used to fabricate its own
 * `${kind}:${source}:${seq}` segmentId instead of using the adapter's real
 * one, silently defeating step 8's duplicate/lost-final-segment fix on the
 * only path a live user (or the VEYRA_TEST_AUDIO demo) actually exercises --
 * despite the parser/adapter/reducer and the e2e harness proving the fix
 * correct in isolation. This locks in the fix at the seam both call sites
 * now share.
 */
describe('adapterEventToTranscriptEvent', () => {
  it('uses the adapter-supplied segmentId verbatim, not a source:seq fabrication', () => {
    const event = adapterEventToTranscriptEvent(
      'mic',
      'me',
      'final',
      'hello world',
      0,
      '0:00:00.34:0'
    )
    expect(event.segmentId).toBe('0:00:00.34:0')
  })

  it('gives two revisions of the same real segment the SAME segmentId even as seq advances', () => {
    // Mirrors wlk resending an extended lines[] entry across two messages:
    // the adapter's seq advances per final callback, but its real segmentId
    // (start+index derived) stays stable across the revision.
    const first = adapterEventToTranscriptEvent(
      'mic',
      'me',
      'final',
      'testing one two',
      0,
      '0:00:00.34:0'
    )
    const second = adapterEventToTranscriptEvent(
      'mic',
      'me',
      'final',
      'testing one two three',
      1,
      '0:00:00.34:0'
    )
    expect(first.segmentId).toBe(second.segmentId)
  })

  it('falls back to a source:seq id only when the adapter supplies no segmentId', () => {
    const event = adapterEventToTranscriptEvent('loopback', 'other', 'partial', 'hi', 3, undefined)
    expect(event.segmentId).toBe('partial:loopback:3')
  })

  it('carries source, speaker, kind, text, seq through unchanged and stamps ts', () => {
    const before = Date.now()
    const event = adapterEventToTranscriptEvent('mic', 'me', 'partial', 'hi', 2, 'partial:mic:2')
    expect(event).toMatchObject({
      source: 'mic',
      speaker: 'me',
      kind: 'partial',
      text: 'hi',
      seq: 2,
      segmentId: 'partial:mic:2'
    })
    expect(event.ts).toBeGreaterThanOrEqual(before)
  })
})
