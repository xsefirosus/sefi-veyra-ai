import SettingsScreen from './settings/SettingsScreen'
import OverlayScreen from './transcript/OverlayScreen'
import TranscriptPanel from './transcript/TranscriptPanel'
import { useTranscript } from './transcript/use-transcript'

/**
 * Main window: the VEYRA settings screen (step 7) PLUS the transcript panel
 * (step 18). The panel is added below the existing settings form; branding and
 * settings content are untouched.
 */
function MainScreen(): React.JSX.Element {
  const { lines } = useTranscript()
  return (
    <div className="main-screen">
      <SettingsScreen />
      <TranscriptPanel lines={lines} variant="panel" />
    </div>
  )
}

function App(): React.JSX.Element {
  // Both windows load the same renderer bundle (windows.ts); the preload
  // resolves which window this is from its additionalArguments and exposes it
  // as window.api.windowRole. Overlay: live transcript only; main: settings +
  // transcript panel.
  if (window.api.windowRole === 'overlay') return <OverlayScreen />
  return <MainScreen />
}

export default App
