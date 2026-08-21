/**
 * OverlayScreen (plan step 18): the overlay window's whole screen. Replaces the
 * template's default content with the live transcript: partials in italic/grey,
 * finals solid (TranscriptPanel variant 'overlay').
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
