/**
 * Answer-suggestion reducer (phase 3 step 15).
 *
 * Accumulates `delta` events into a growing string per in-flight suggestion,
 * replaces with the final Suggestion on `complete`, and resets on a new
 * suggestion starting (a delta arriving after a complete). An abort mid-stream
 * (no `complete` ever arrives) leaves the partial text visible rather than
 * hanging or erroring — the reducer simply stays in `streaming`.
 *
 * State shape mirrors the overlay's three visible states:
 * - idle:       no active suggestion
 * - streaming:  deltas have arrived, accumulating text
 * - complete:   a terminal Suggestion is available
 *
 * The reducer is pure and window-agnostic (no React, no IPC) so tests exercise
 * every transition with plain dispatch sequences.
 */
import type { Suggestion, SuggestionDelta } from '../../../shared/llm/llm-adapter'

export type AnswerStatus = 'idle' | 'streaming' | 'complete'

export interface AnswerState {
  text: string
  kind: Suggestion['kind'] | null
  status: AnswerStatus
  suggestion: Suggestion | null
}

export const initialAnswerState: AnswerState = {
  text: '',
  kind: null,
  status: 'idle',
  suggestion: null
}

/**
 * Map a main-process SuggestionDelta (SUGGESTION_EVENT_CHANNEL payload) to the
 * reducer action. Identity today — delta and complete already are the action
 * shape — but kept as a named function mirroring toTranscriptAction so the IPC
 * -> reducer seam is explicit and testable.
 */
export function toAnswerAction(event: SuggestionDelta): SuggestionDelta {
  return event
}

export function answerReducer(state: AnswerState, action: SuggestionDelta): AnswerState {
  switch (action.type) {
    case 'delta': {
      // New suggestion after a complete resets the accumulation rather than
      // appending to the prior finished text.
      if (state.status === 'complete') {
        return {
          text: action.textDelta,
          kind: action.kind,
          status: 'streaming',
          suggestion: null
        }
      }
      return {
        text: state.text + action.textDelta,
        kind: action.kind,
        status: 'streaming',
        suggestion: null
      }
    }
    case 'complete': {
      return {
        text: action.suggestion.text,
        kind: action.suggestion.kind,
        status: 'complete',
        suggestion: action.suggestion
      }
    }
    default:
      return state
  }
}
