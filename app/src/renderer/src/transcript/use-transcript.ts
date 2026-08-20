/**
 * useTranscript (plan step 18): subscribes the renderer to main-process
 * transcript events over the preload bridge and feeds them to the
 * transcript-reducer. Each window (main + overlay) runs its own subscription;
 * main broadcasts every event to BOTH windows.
 */
import { useEffect, useReducer } from 'react'
import type { TranscriptEvent } from '../../../shared/types'
import {
  initialTranscriptState,
  toTranscriptAction,
  transcriptReducer,
  type TranscriptState
} from './transcript-reducer'

export function useTranscript(): TranscriptState {
  const [state, dispatch] = useReducer(transcriptReducer, initialTranscriptState)

  useEffect(() => {
    // onTranscriptEvent returns the unsubscribe fn; the effect cleanup runs it
    // (React StrictMode mounts effects twice in dev, so a leak-free return is
    // required, not optional).
    return window.api.onTranscriptEvent((event: TranscriptEvent) => {
      dispatch(toTranscriptAction(event))
    })
  }, [])

  return state
}
