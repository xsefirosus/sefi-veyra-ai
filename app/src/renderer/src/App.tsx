import { useEffect, useReducer } from 'react'
import SettingsScreen from './settings/SettingsScreen'
import { initialSettings, settingsReducer } from './settings/settings-reducer'
import OverlayScreen from './transcript/OverlayScreen'
import TranscriptPanel from './transcript/TranscriptPanel'
import { useTranscript } from './transcript/use-transcript'
import { startLoopbackCapture, type LoopbackCaptureHandle } from './capture/loopback-capture'
import { useCapture } from './capture/use-capture'

/**
 * Main window: the VEYRA settings screen (step 7) PLUS the transcript panel
 * (step 18). The panel is added below the existing settings form; branding and
 * settings content are untouched.
 */
function MainScreen(): React.JSX.Element {
  const { lines } = useTranscript()
  const [settings, dispatch] = useReducer(settingsReducer, initialSettings)
  // Step 4: react to session-state → listening (start mic with settings.audioDeviceId
  // skipping LOOPBACK_DEVICE_ID, start loopback) and stopping/idle (stop both).
  // Surface onFallback so the UI can show it. No-op when loopbackCheckMode.
  const capture = useCapture({
    audioDeviceId: settings.audioDeviceId,
    onFallback: (info) =>
      console.warn(`[capture] fallback ${info.source}: ${info.mode}`, info.error.message)
  })

  // Step 19 verification mode (scripts/check-loopback.ps1): auto-start the
  // loopback capture so main can measure the 440 Hz tone's energy and write
  // state/loopback-check.json. Only in check mode -- normal-mode capture start
  // is the e2e/demo wiring (steps 21-22). Kept working unchanged per step 4.
  useEffect(() => {
    if (!window.api.loopbackCheckMode) return
    let handle: LoopbackCaptureHandle | null = null
    let cancelled = false
    void startLoopbackCapture()
      .then((h) => {
        if (cancelled) void h.stop()
        else handle = h
      })
      .catch((err) =>
        console.error('[loopback-check] capture failed:', err instanceof Error ? err.message : err)
      )
    return () => {
      cancelled = true
      void handle?.stop()
    }
  }, [])

  return (
    <div className="main-screen">
      <SettingsScreen settings={settings} dispatch={dispatch} captureFallback={capture.fallback} />
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
