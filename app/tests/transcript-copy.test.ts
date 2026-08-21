/**
 * Plan step 16(b) (plan-veyra-audit-01.md): `body { user-select: none }` made
 * the transcript unselectable -- copying a suggested answer is the core action
 * of this product.
 *
 * Seams under test (agreed before first test):
 *   1. transcriptToText -> pure serialization of reducer lines to
 *      clipboard-ready text (committed finals only, speaker prefixes, trimmed).
 *   2. copyTranscript   -> clipboard write that degrades to a boolean instead
 *      of throwing when the clipboard API/DOM is unavailable (node env) or the
 *      write is refused.
 * The CSS selection change and the Copy button wiring are verified by build +
 * the step-18 live pass; not re-tested below this seam.
 */
import { describe, expect, it } from 'vitest'
import { copyTranscript, transcriptToText } from '../src/renderer/src/transcript/transcript-copy'
import type { TranscriptLine } from '../src/renderer/src/transcript/transcript-reducer'

function line(over: Partial<TranscriptLine>): TranscriptLine {
  return {
    seq: 0,
    text: '',
    kind: 'final',
    speaker: 'unknown',
    segmentId: 'seg',
    source: 'mic',
    ...over
  }
}

describe('step 16b: transcriptToText serialization', () => {
  it('serializes nothing for an empty transcript', () => {
    expect(transcriptToText([])).toBe('')
  })

  it('prefixes known speakers and keeps unknown-speaker lines bare', () => {
    const text = transcriptToText([
      line({ speaker: 'me', text: 'I can start on Friday.' }),
      line({ speaker: 'other', text: 'Great. What is your notice period?' }),
      line({ speaker: 'unknown', text: '[inaudible]' })
    ])
    expect(text).toBe(
      'me: I can start on Friday.\nother: Great. What is your notice period?\n[inaudible]'
    )
  })

  it('copies only committed finals, never in-flight partials', () => {
    const text = transcriptToText([
      line({ speaker: 'me', text: 'Committed sentence one.' }),
      line({
        speaker: 'me',
        kind: 'partial',
        segmentId: 'partial:mic:1',
        text: 'half-typed partial tha'
      })
    ])
    expect(text).toBe('me: Committed sentence one.')
  })

  it('trims stray whitespace from line ends', () => {
    expect(transcriptToText([line({ speaker: 'me', text: '  padded text \n' })])).toBe(
      'me: padded text'
    )
  })
})

describe('step 16b: copyTranscript degradation', () => {
  it('refuses to copy empty text', async () => {
    await expect(copyTranscript('')).resolves.toBe(false)
  })

  it('returns false (never throws) where neither clipboard API nor DOM exists', async () => {
    // vitest node env: no navigator.clipboard, no document.
    const result = await copyTranscript('some transcript text')
    expect(result).toBe(false)
  })

  it('uses the textarea/execCommand fallback when the clipboard API is absent', async () => {
    // Minimal fake DOM surface: execCommand succeeds after the hidden
    // textarea is appended, selected and removed. (Node has no
    // navigator.clipboard, so the primary path is skipped.)
    const g = globalThis as unknown as { document?: unknown }
    const prevDoc = g.document
    let removed = false
    g.document = {
      createElement: () => ({
        value: '',
        style: {},
        setAttribute: () => {},
        select: () => {},
        remove: () => {
          removed = true
        }
      }),
      body: { appendChild: () => {} },
      execCommand: (cmd: string) => cmd === 'copy'
    }
    try {
      await expect(copyTranscript('fallback text')).resolves.toBe(true)
      expect(removed).toBe(true)
    } finally {
      g.document = prevDoc
    }
  })

  it('returns false when even the legacy path fails', async () => {
    const g = globalThis as unknown as { document?: unknown }
    const prevDoc = g.document
    g.document = {
      createElement: () => ({
        value: '',
        style: {},
        setAttribute: () => {},
        select: () => {},
        remove: () => {}
      }),
      body: { appendChild: () => {} },
      execCommand: () => false
    }
    try {
      await expect(copyTranscript('doomed text')).resolves.toBe(false)
    } finally {
      g.document = prevDoc
    }
  })
})
