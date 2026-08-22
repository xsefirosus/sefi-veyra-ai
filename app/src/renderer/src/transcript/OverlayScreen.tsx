/**
 * OverlayScreen (plan step 18, glass restyle step 6): the overlay window's whole
 * screen. Delegates to TranscriptPanel variant 'overlay' which now renders the
 * Quiet Glass translucent card (oklch 100% /0.7 + blur 6px, rounded, soft shadow)
 * for the transcript-tail / Listening state. Generating/Ready states arrive in
 * step 16.
 *
 * Step 13: subscribes to `settings-changed` broadcasts (same mechanism as
 * `session-state` — see src/main/settings-store.ts for the choice) so the
 * overlay stays in sync with stealthMode/theme changes made in the main
 * window. The actual stealth rendering arrives in step 14; this just keeps
 * the plumbing live.
 */
import { useEffect, useState } from 'react'
import TranscriptPanel from './TranscriptPanel'
import { useTranscript } from './use-transcript'
import { useSessionState } from '../session/use-session-state'

function OverlayScreen(): React.JSX.Element {
  const { lines } = useTranscript()
  const sessionStatus = useSessionState()
  const [stealthMode] = useState(() => {
    const v = (window as unknown as { api?: { initialStealthMode?: boolean } }).api
      ?.initialStealthMode
    return Boolean(v)
  })

  // Keep stealthMode live via settings-changed broadcasts (both windows).
  useEffect(() => {
    const maybeApi = (window as unknown as { api?: Window['api'] }).api
    if (!maybeApi?.onSettingsChanged) return
    return maybeApi.onSettingsChanged((s) => {
      // Step 14 will consume this to switch the minimal treatment. For step 13
      // we just prove the seam is live — attach to the root dataset so a
      // visual check or test can observe it without rendering logic.
      document.documentElement.dataset.stealth = s.stealthMode ? '1' : '0'
      if (s.theme) document.documentElement.dataset.theme = s.theme
    })
  }, [])

  // Prime the dataset from the synchronous initial value.
  useEffect(() => {
    document.documentElement.dataset.stealth = stealthMode ? '1' : '0'
  }, [stealthMode])

  return <TranscriptPanel lines={lines} variant="overlay" sessionStatus={sessionStatus} />
}

export default OverlayScreen
