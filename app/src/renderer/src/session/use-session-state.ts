import { useEffect, useState } from 'react'
import type { SessionStatus } from './session-status'

const DEFAULT_STATUS: SessionStatus = { state: 'idle', lastError: null }

/**
 * Subscribe to main's session-state broadcasts and hydrate initial state.
 * Returns the latest {state, lastError} for the status chip and button.
 */
export function useSessionState(): SessionStatus {
  const [status, setStatus] = useState<SessionStatus>(DEFAULT_STATUS)

  useEffect(() => {
    let cancelled = false
    const maybeApi = (window as unknown as { api?: Window['api'] }).api
    if (!maybeApi) return

    const onState = (payload: SessionStatus): void => {
      if (cancelled) return
      setStatus({ state: payload.state, lastError: payload.lastError })
    }

    const unsubscribe = maybeApi.onSessionState(onState)

    maybeApi
      .getSessionState()
      .then((s) => {
        if (!cancelled) setStatus({ state: s.state, lastError: s.lastError })
      })
      .catch(() => {})

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  return status
}

export default useSessionState
