/**
 * OverlayScreen (plan step 18, glass restyle step 6): the overlay window's whole
 * screen. Delegates to TranscriptPanel variant 'overlay' which now renders the
 * Quiet Glass translucent card (oklch 100% /0.7 + blur 6px, rounded, soft shadow)
 * for the transcript-tail / Listening state. Generating/Ready states arrive in
 * step 16.
 */
import TranscriptPanel from './TranscriptPanel'
import { useTranscript } from './use-transcript'
import { useSessionState } from '../session/use-session-state'

function OverlayScreen(): React.JSX.Element {
  const { lines } = useTranscript()
  const sessionStatus = useSessionState()
  return <TranscriptPanel lines={lines} variant="overlay" sessionStatus={sessionStatus} />
}

export default OverlayScreen
