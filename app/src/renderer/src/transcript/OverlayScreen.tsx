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
 * window. Step 14: the stealth minimal treatment ("state 4" — faint wash,
 * no icons/labels/buttons, reduced text) is threaded as props to TranscriptPanel
 * via the same broadcast, proving the real IPC/render seam end-to-end.
 */
import { useEffect, useState } from 'react'
import TranscriptPanel from './TranscriptPanel'
import { useTranscript } from './use-transcript'
import { useSessionState } from '../session/use-session-state'
import type { StealthTheme } from './stealth-variant'

function OverlayScreen(): React.JSX.Element {
  const { lines } = useTranscript()
  const sessionStatus = useSessionState()
  const [stealthMode, setStealthMode] = useState(() => {
    const v = (window as unknown as { api?: { initialStealthMode?: boolean } }).api
      ?.initialStealthMode
    return Boolean(v)
  })
  const [theme, setTheme] = useState<StealthTheme>(() => {
    const v = (window as unknown as { api?: { initialTheme?: string } }).api?.initialTheme
    return v === 'dark' ? 'dark' : 'light'
  })

  // Keep stealthMode + theme live via settings-changed broadcasts (both windows).
  useEffect(() => {
    const maybeApi = (window as unknown as { api?: Window['api'] }).api
    if (!maybeApi?.onSettingsChanged) return
    return maybeApi.onSettingsChanged((s) => {
      setStealthMode(Boolean(s.stealthMode))
      if (s.theme === 'dark' || s.theme === 'light') {
        setTheme(s.theme)
        document.documentElement.dataset.theme = s.theme
      }
      document.documentElement.dataset.stealth = s.stealthMode ? '1' : '0'
    })
  }, [])

  // Prime the dataset from the synchronous initial values.
  useEffect(() => {
    document.documentElement.dataset.stealth = stealthMode ? '1' : '0'
  }, [stealthMode])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return (
    <TranscriptPanel
      lines={lines}
      variant="overlay"
      sessionStatus={sessionStatus}
      stealthMode={stealthMode}
      theme={theme}
    />
  )
}

export default OverlayScreen
