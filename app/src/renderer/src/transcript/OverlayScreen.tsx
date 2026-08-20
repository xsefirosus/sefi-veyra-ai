/**
 * OverlayScreen (plan step 18): the overlay window's whole screen. Replaces the
 * template's default content with the live transcript: partials in italic/grey,
 * finals solid (TranscriptPanel variant 'overlay').
 */
import TranscriptPanel from './TranscriptPanel'
import { useTranscript } from './use-transcript'

function OverlayScreen(): React.JSX.Element {
  const { lines } = useTranscript()
  return <TranscriptPanel lines={lines} variant="overlay" />
}

export default OverlayScreen
