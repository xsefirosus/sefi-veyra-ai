export type SessionState = 'idle' | 'starting' | 'listening' | 'stopping' | 'error'

export interface SessionStatus {
  state: string
  lastError: string | null
}

/**
 * Maps a session-state payload ({state, lastError}) to the chip text
 * shown in the Start/Stop control and the overlay empty state.
 *
 * - idle      -> "Idle"
 * - starting  -> "Starting model… (first run may take minutes to download)"
 *               (first base/small run downloads model, must not appear hung)
 * - listening -> "Listening"
 * - stopping  -> "Stopping…"
 * - error     -> "Error: <message>"
 */
export function sessionChipLabel(status: SessionStatus): string {
  switch (status.state) {
    case 'idle':
      return 'Idle'
    case 'starting':
      return 'Starting model\u2026 (first run may take minutes to download)'
    case 'listening':
      return 'Listening'
    case 'stopping':
      return 'Stopping\u2026'
    case 'error':
      return status.lastError ? `Error: ${status.lastError}` : 'Error'
    default:
      return 'Idle'
  }
}

/**
 * Short empty-state text for the overlay when no transcript lines are present.
 * Mirrors sessionChipLabel but uses overlay-appropriate phrasing.
 */
export function overlayEmptyLabel(status: SessionStatus): string {
  switch (status.state) {
    case 'idle':
      return 'Idle \u2014 press Start listening'
    case 'starting':
      return 'Starting model\u2026 (first run may take minutes to download)'
    case 'listening':
      return 'Listening\u2026'
    case 'stopping':
      return 'Stopping\u2026'
    case 'error':
      return status.lastError ? `Error: ${status.lastError}` : 'Error'
    default:
      return 'Idle \u2014 press Start listening'
  }
}

export function isListeningState(state: string): boolean {
  return state === 'listening' || state === 'starting'
}
