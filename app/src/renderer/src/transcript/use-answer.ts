/**
 * useAnswer (phase 3 step 16): subscribes the renderer to main-process
 * suggestion deltas over the preload bridge and feeds them to the
 * answer-reducer. Mirrors useTranscript's exact pattern.
 *
 * Each window (main + overlay) runs its own subscription; main broadcasts
 * every SuggestionDelta to BOTH windows on SUGGESTION_EVENT_CHANNEL.
 */

import { useEffect, useReducer } from 'react'
import {
  answerReducer,
  initialAnswerState,
  toAnswerAction,
  type AnswerState
} from './answer-reducer'
import type { SuggestionDelta } from '../../../shared/llm/llm-adapter'

export function useAnswer(): AnswerState {
  const [state, dispatch] = useReducer(answerReducer, initialAnswerState)

  useEffect(() => {
    const maybeApi = (window as unknown as { api?: Window['api'] }).api
    if (!maybeApi?.onSuggestionEvent) return
    return maybeApi.onSuggestionEvent((event: SuggestionDelta) => {
      dispatch(toAnswerAction(event))
    })
  }, [])

  return state
}
