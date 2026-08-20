/**
 * Transcript state (plan step 18).
 *
 * Model: `lines` is the ordered transcript. A `partial` event is the live
 * revision of the in-flight segment with that seq, so it REPLACES the pending
 * partial with the same seq (step-16 adapter contract: "a partial with a given
 * seq is the live revision of that segment"). A `final` commits that segment:
 * the pending partial for the seq is removed and the committed line is
 * APPENDED -- the UI then shows one solid line per committed segment.
 *
 * Speaker: the action carries an optional `speaker` ('me'|'other'|'unknown');
 * absent, it defaults to 'unknown'. When a final carries no speaker, the
 * pending partial's speaker is PRESERVED onto the committed line. Step 20 tags
 * adapter events with speaker in main (labelForSource: 'mic' -> 'me', anything
 * else -> 'other') before broadcast; toTranscriptAction passes event.speaker
 * through, so in practice lines read 'me' or 'other' and 'unknown' is only the
 * fallback for events that arrive without a label.
 */
import type { TranscriptEvent } from '../../../shared/types'

export type TranscriptKind = 'partial' | 'final'
export type Speaker = 'me' | 'other' | 'unknown'

export interface TranscriptLine {
  seq: number
  text: string
  kind: TranscriptKind
  speaker: Speaker
}

export interface TranscriptState {
  lines: TranscriptLine[]
}

export const initialTranscriptState: TranscriptState = { lines: [] }

export type TranscriptAction =
  | { type: 'partial'; seq: number; text: string; speaker?: Speaker }
  | { type: 'final'; seq: number; text: string; speaker?: Speaker }

export function transcriptReducer(
  state: TranscriptState,
  action: TranscriptAction
): TranscriptState {
  switch (action.type) {
    case 'partial': {
      const line: TranscriptLine = {
        seq: action.seq,
        text: action.text,
        kind: 'partial',
        speaker: action.speaker ?? 'unknown'
      }
      const idx = state.lines.findIndex((l) => l.kind === 'partial' && l.seq === action.seq)
      if (idx === -1) return { lines: [...state.lines, line] }
      const lines = [...state.lines]
      lines[idx] = line
      return { lines }
    }
    case 'final': {
      const pendingIdx = state.lines.findIndex((l) => l.kind === 'partial' && l.seq === action.seq)
      const speaker =
        action.speaker ?? (pendingIdx === -1 ? 'unknown' : state.lines[pendingIdx].speaker)
      const committed: TranscriptLine = {
        seq: action.seq,
        text: action.text,
        kind: 'final',
        speaker
      }
      const lines = state.lines.filter((l) => !(l.kind === 'partial' && l.seq === action.seq))
      return { lines: [...lines, committed] }
    }
    default:
      return state
  }
}

/** Map a main-process TranscriptEvent to a reducer action (useTranscript dispatch). */
export function toTranscriptAction(event: TranscriptEvent): TranscriptAction {
  return { type: event.kind, seq: event.seq, text: event.text, speaker: event.speaker }
}
