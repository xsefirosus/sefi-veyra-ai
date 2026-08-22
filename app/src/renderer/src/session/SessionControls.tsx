import { useCallback, useState } from 'react'
import type { Settings } from '../settings/settings-reducer'
import { sessionChipLabel } from './session-status'
import { useSessionState } from './use-session-state'

interface SessionControlsProps {
  settings: Settings
}

function SessionControls({ settings }: SessionControlsProps): React.JSX.Element {
  const status = useSessionState()
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const isActive = status.state === 'listening' || status.state === 'starting'
  const isTransitioning = status.state === 'starting' || status.state === 'stopping'

  const chipLabel = sessionChipLabel(status)
  const chipVariant =
    status.state === 'error'
      ? 'error'
      : status.state === 'listening'
        ? 'listening'
        : status.state === 'starting'
          ? 'starting'
          : 'idle'

  const handleToggle = useCallback(async () => {
    if (busy) return
    // Do not start again while transitioning, but ALLOW Stop while starting
    // (the hang fix: starting must remain cancellable so "reply was never sent"
    // does not brick the UI; Stop stays enabled during STARTING MODEL).
    if (isTransitioning && !isActive) return
    setBusy(true)
    setActionError(null)
    try {
      if (isActive) {
        await window.api.stopSession()
      } else {
        await window.api.startSession(settings)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setActionError(msg)
    } finally {
      setBusy(false)
    }
  }, [busy, isTransitioning, isActive, settings])

  const buttonDisabled = busy || (isTransitioning && !isActive)
  const buttonLabel = isActive ? 'Stop listening' : 'Start listening'

  return (
    <div className="session-controls">
      <button
        type="button"
        className="session-button"
        onClick={() => void handleToggle()}
        disabled={buttonDisabled}
        aria-label={buttonLabel}
        aria-busy={isTransitioning}
      >
        {buttonLabel}
      </button>
      <span
        className={`session-chip session-chip--${chipVariant}`}
        role="status"
        aria-live="polite"
        aria-label={`Session status: ${chipLabel}`}
      >
        {chipLabel}
      </span>
      {actionError && (
        <span className="session-error" role="alert">
          {actionError}
        </span>
      )}
    </div>
  )
}

export default SessionControls
