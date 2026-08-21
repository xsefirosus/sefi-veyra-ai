/**
 * Transcript state (plan steps 18 + 9 - audit remediation).
 *
 * Model: `lines` is the ordered transcript. A `partial` event is the live
 * revision of the in-flight segment with that segmentId, so it REPLACES the
 * pending partial with the same segmentId (per-source, step 9). A `final`
 * commits that segment: any pending partial for the same source+seq is removed
 * and the committed line is APPENDED unless a committed line with the same
 * segmentId already exists (in-place revision - replaces). This prevents
 * cross-track seq collision: mic seq 0 and loopback seq 0 have distinct
 * segmentIds (`partial:mic:0` vs `partial:loopback:0`).
 *
 * Speaker + source are kept on every line. `segmentId` is the stable identity
 * from step 8 (`partial:<source>:<seq>` for partials, `<start>:<idx>` or
 * `final:<source>:<seq>` for finals) and is used as React key.
 *
 * Cap: at most MAX_COMMITTED_LINES committed (final) lines are retained; the
 * oldest are evicted first (hour-long meetings). Partials are not counted
 * towards the cap.
 */
import type { TranscriptEvent } from '../../../shared/types'

export type TranscriptKind = 'partial' | 'final'
export type Speaker = 'me' | 'other' | 'unknown'

export interface TranscriptLine {
  seq: number
  text: string
  kind: TranscriptKind
  speaker: Speaker
  segmentId: string
  source: 'mic' | 'loopback'
}

export interface TranscriptState {
  lines: TranscriptLine[]
}

export const initialTranscriptState: TranscriptState = { lines: [] }

/** Cap for committed lines - prevents unbounded growth over an hour-long meeting. */
export const MAX_COMMITTED_LINES = 200
/** Window size for panel rendering - same as cap to avoid full re-render. */
export const TRANSCRIPT_PANEL_WINDOW = 200

export type TranscriptAction =
  | {
      type: 'partial'
      seq: number
      text: string
      speaker?: Speaker
      segmentId: string
      source: 'mic' | 'loopback'
    }
  | {
      type: 'final'
      seq: number
      text: string
      speaker?: Speaker
      segmentId: string
      source: 'mic' | 'loopback'
    }
  // Legacy shape retained for backward compat with existing tests that omit
  // segmentId/source - the reducer derives them (not exported as public API
  // after step 9, but kept to keep `npm test` green during migration).
  | {
      type: 'partial'
      seq: number
      text: string
      speaker?: Speaker
      segmentId?: string
      source?: 'mic' | 'loopback'
    }
  | {
      type: 'final'
      seq: number
      text: string
      speaker?: Speaker
      segmentId?: string
      source?: 'mic' | 'loopback'
    }

function effectiveSegmentId(action: TranscriptAction): string {
  if (action.segmentId) return action.segmentId
  const src = (action as { source?: string }).source ?? 'mic'
  return `${action.type}:${src}:${action.seq}`
}

function effectiveSource(action: TranscriptAction): 'mic' | 'loopback' {
  return (action as { source?: string }).source === 'loopback' ? 'loopback' : 'mic'
}

function enforceCap(lines: TranscriptLine[]): TranscriptLine[] {
  const finals = lines.filter((l) => l.kind === 'final')
  if (finals.length <= MAX_COMMITTED_LINES) return lines
  const excess = finals.length - MAX_COMMITTED_LINES
  let removed = 0
  const result: TranscriptLine[] = []
  for (const l of lines) {
    if (l.kind === 'final' && removed < excess) {
      removed += 1
      continue
    }
    result.push(l)
  }
  return result
}

export function transcriptReducer(
  state: TranscriptState,
  action: TranscriptAction
): TranscriptState {
  switch (action.type) {
    case 'partial': {
      const segmentId = effectiveSegmentId(action)
      const source = effectiveSource(action)
      const line: TranscriptLine = {
        seq: action.seq,
        text: action.text,
        kind: 'partial',
        speaker: action.speaker ?? 'unknown',
        segmentId,
        source
      }
      const idx = state.lines.findIndex((l) => l.kind === 'partial' && l.segmentId === segmentId)
      if (idx === -1) return { lines: [...state.lines, line] }
      const lines = [...state.lines]
      lines[idx] = line
      return { lines }
    }
    case 'final': {
      const segmentId = effectiveSegmentId(action)
      const source = effectiveSource(action)
      const pendingIdx = state.lines.findIndex(
        (l) => l.kind === 'partial' && l.source === source && l.seq === action.seq
      )
      const committedIdx = state.lines.findIndex(
        (l) => l.kind === 'final' && l.segmentId === segmentId
      )
      const pendingSpeaker = pendingIdx !== -1 ? state.lines[pendingIdx].speaker : undefined
      const existingCommittedSpeaker =
        committedIdx !== -1 ? state.lines[committedIdx].speaker : undefined
      const speaker = action.speaker ?? pendingSpeaker ?? existingCommittedSpeaker ?? 'unknown'
      const committed: TranscriptLine = {
        seq: action.seq,
        text: action.text,
        kind: 'final',
        speaker,
        segmentId,
        source
      }
      // In-place revision: replace existing committed with same segmentId
      if (committedIdx !== -1) {
        const lines = [...state.lines]
        // If there is also a pending partial for same source+seq, remove it first
        // but keep committed index stable - filter pending, then replace.
        const withoutPending = pendingIdx !== -1 ? lines.filter((_, i) => i !== pendingIdx) : lines
        // committedIdx may have shifted if pending was before it
        const adjustedIdx =
          pendingIdx !== -1 && pendingIdx < committedIdx ? committedIdx - 1 : committedIdx
        // If we filtered, find again by segmentId in the filtered array to avoid off-by-one
        const finalIdx = withoutPending.findIndex(
          (l) => l.kind === 'final' && l.segmentId === segmentId
        )
        const targetIdx = finalIdx !== -1 ? finalIdx : adjustedIdx
        withoutPending[targetIdx] = committed
        return { lines: enforceCap(withoutPending) }
      }
      const lines = state.lines.filter(
        (l) => !(l.kind === 'partial' && l.source === source && l.seq === action.seq)
      )
      return { lines: enforceCap([...lines, committed]) }
    }
    default:
      return state
  }
}

/** Map a main-process TranscriptEvent to a reducer action (useTranscript dispatch). */
export function toTranscriptAction(event: TranscriptEvent): TranscriptAction {
  return {
    type: event.kind,
    seq: event.seq,
    text: event.text,
    speaker: event.speaker as Speaker | undefined,
    segmentId: event.segmentId,
    source: event.source
  }
}
