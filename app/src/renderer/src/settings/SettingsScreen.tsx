import { useEffect, useReducer, useState } from 'react'
import {
  hydrate,
  initialSettings,
  setApiKey,
  setAudioDevice,
  setOverlayOpacity,
  setStealthMode,
  setSttModel,
  setTheme,
  settingsReducer,
  type Settings,
  type SettingsAction,
  type SttModel,
  type Theme
} from './settings-reducer'
import {
  applyLoadedSettings,
  persistSettings,
  settingsUiReducer,
  initialSettingsUiState
} from './settings-persistence'
import { deviceOptions, type AudioDeviceOption } from './device-options'
import type { CaptureMode } from '../capture/mic-capture'
import PersonaPanel from '../persona/PersonaPanel'

const STT_MODELS: SttModel[] = ['tiny', 'base', 'small']

/* Quiet Glass inline icon set — stroke-based, no icon font, no emoji.
   Path data copied verbatim from the published canvas Main.dc.html (page "Veyra"). */
function BrandIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l7 4v8l-7 4-7-4V7l7-4z" />
      <path d="M8.5 9.5l3.5 6 3.5-6" />
    </svg>
  )
}

function SunIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

function MoonIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function DocumentIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h8" />
    </svg>
  )
}

function UploadIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5" />
      <path d="M12 3v12" />
    </svg>
  )
}

function EyeOffIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.59 9.59 0 0 0 5.39-1.61" />
      <path d="M2 2l20 20" />
    </svg>
  )
}

function EyeIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

interface SettingsScreenProps {
  settings?: Settings
  dispatch?: React.Dispatch<SettingsAction>
  captureFallback?: { source: 'mic' | 'loopback'; mode: CaptureMode; error: Error } | null
}

/**
 * Direction: Quiet Glass — per state/plan-veyra-phase3-quietglass.md step 5 and
 * the published canvas Main.dc.html (page "Veyra").
 * Rounded 16px cards, pill session-chip, persona-card treatment (border,
 * padding 24px, soft surface), stroke-based inline icons copied from canvas.
 */
function SettingsScreen(props: SettingsScreenProps): React.JSX.Element {
  const [internalSettings, internalDispatch] = useReducer(settingsReducer, initialSettings)
  const settings = props.settings ?? internalSettings
  const dispatch = props.dispatch ?? internalDispatch
  const captureFallback = props.captureFallback ?? null
  const [devices, setDevices] = useState<AudioDeviceOption[]>([
    { deviceId: null, label: 'System default' }
  ])
  const [ui, dispatchUi] = useReducer(settingsUiReducer, initialSettingsUiState)
  const [showKey, setShowKey] = useState(false)

  // Step 11: hydration on mount — a saved key/model/device come back from
  // settings:load (apiKey decrypted in main) instead of the form starting
  // empty every restart. A failed load keeps the defaults standing.
  useEffect(() => {
    let cancelled = false
    const maybeApi = (window as unknown as { api?: Window['api'] }).api
    if (!maybeApi?.loadSettings) return
    void applyLoadedSettings(maybeApi.loadSettings, (loaded) => {
      if (cancelled) return
      dispatch(hydrate(loaded))
      dispatchUi({ type: 'hydrated', hasKey: loaded.apiKey !== '' })
    })
    return () => {
      cancelled = true
    }
    // dispatch is a useReducer/prop dispatcher: stable for the mount lifetime.
  }, [dispatch])

  // Every field edit also resets the transient flags ("Settings saved" must
  // not persist forever, step 11).
  const edit = (action: SettingsAction): void => {
    dispatch(action)
    dispatchUi({ type: 'edit' })
  }

  // Phase 3 step 3: keep the live document attribute in sync with the
  // reducer's theme (hydrate on mount + toggle). The initial value was
  // already set BEFORE first paint via preload/additionalArguments
  // (main.tsx); this effect keeps subsequent changes live.
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  // Phase 3 step 13: live sync of settings (stealthMode/theme/opacity) from
  // main's `settings-changed` broadcast (same mechanism as `session-state`).
  // Choice documented in src/main/settings-store.ts: `settings-changed` via
  // webContents.send to both windows. Hydrate keeps this window's reducer in
  // sync when the other window persists a change.
  useEffect(() => {
    const maybeApi = (window as unknown as { api?: Window['api'] }).api
    if (!maybeApi?.onSettingsChanged) return
    const unsubscribe = maybeApi.onSettingsChanged((latest) => {
      dispatch(hydrate(latest))
      // Keep the theme attribute in sync when the change came from the other window.
      if (latest.theme) document.documentElement.dataset.theme = latest.theme
    })
    return unsubscribe
  }, [dispatch])

  const toggleTheme = (): void => {
    const next: Theme = settings.theme === 'dark' ? 'light' : 'dark'
    edit(setTheme(next))
    document.documentElement.dataset.theme = next
    const maybeApi = (window as unknown as { api?: Window['api'] }).api
    if (!maybeApi?.saveSettings) return
    const nextSettings: Settings = { ...settings, theme: next }
    void persistSettings(maybeApi.saveSettings, nextSettings).then((outcome) => {
      if (outcome.ok) dispatchUi({ type: 'saveOk' })
      else dispatchUi({ type: 'saveFailed', message: outcome.message })
    })
  }

  // Audio device list feeds the device <select>. Step 16(e): labels come back
  // EMPTY from enumerateDevices() until microphone permission is granted, so
  // (1) unlabeled devices get a friendly "Microphone N" placeholder instead of
  // the raw deviceId hash, and (2) we re-enumerate when the permission flips to
  // granted or whenever devices change -- real labels then flow in without a
  // restart. The loopback sentinel entry ("System audio (loopback)") is NOT an
  // audioinput device; it must never reach getUserMedia.
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      if (!navigator.mediaDevices?.enumerateDevices) return
      try {
        const found = await navigator.mediaDevices.enumerateDevices()
        if (cancelled) return
        setDevices(
          deviceOptions(
            found
              .filter((d) => d.kind === 'audioinput')
              .map((d) => ({ deviceId: d.deviceId, label: d.label }))
          )
        )
      } catch {
        // Enumeration can throw (permission/policy); the default entries still work.
      }
    }
    void load()

    const onReenumerate = (): void => {
      void load()
    }

    // Permission flip -> labels appear; re-enumerate on grant. Best-effort:
    // not every runtime exposes the Permissions API for 'microphone'.
    let permission: PermissionStatus | null = null
    try {
      void navigator.permissions
        ?.query({ name: 'microphone' as PermissionName })
        .then((status) => {
          if (cancelled || !status) return
          permission = status
          status.addEventListener('change', onReenumerate)
          if (status.state === 'granted') void load()
        })
        .catch(() => {
          /* no permission API here: mount-time enumeration still applies */
        })
    } catch {
      /* ditto */
    }

    navigator.mediaDevices?.addEventListener?.('devicechange', onReenumerate)

    return () => {
      cancelled = true
      permission?.removeEventListener('change', onReenumerate)
      navigator.mediaDevices?.removeEventListener?.('devicechange', onReenumerate)
    }
  }, [])

  const onSave = (): void => {
    // Contract (preload index.ts + main settings-store.ts): settings:save
    // validates and persists; a rejection (e.g. the documented
    // "safeStorage encryption unavailable; refusing to persist apiKey" throw)
    // surfaces as an error message instead of a silent unhandled rejection.
    const maybeApi = (window as unknown as { api?: Window['api'] }).api
    if (!maybeApi?.saveSettings) return
    void persistSettings(maybeApi.saveSettings, settings).then((outcome) => {
      if (outcome.ok) dispatchUi({ type: 'saveOk' })
      else dispatchUi({ type: 'saveFailed', message: outcome.message })
    })
  }

  const onOpacityChange = (value: number): void => {
    const clamped = Math.round(Math.min(100, Math.max(0, value)))
    edit(setOverlayOpacity(clamped))
    const maybeApi = (window as unknown as { api?: Window['api'] }).api
    // Live apply to the overlay window via IPC (approach decision 4:
    // BrowserWindow.setOpacity). Linux caveat: setOpacity has weaker/no effect
    // on some Linux window managers (Electron docs) — same class as the
    // existing macOS-loopback and Windows-only-scripts caveats; the call is
    // still made.
    if (maybeApi?.setOverlayOpacity) {
      void maybeApi.setOverlayOpacity(clamped).catch(() => {
        // IPC failure (e.g. handler not yet registered) is non-fatal.
      })
    }
    if (maybeApi?.saveSettings) {
      const nextSettings: Settings = { ...settings, overlayOpacity: clamped }
      void persistSettings(maybeApi.saveSettings, nextSettings).then((outcome) => {
        if (outcome.ok) dispatchUi({ type: 'saveOk' })
        else dispatchUi({ type: 'saveFailed', message: outcome.message })
      })
    }
  }

  const onStealthToggle = (): void => {
    const next = !settings.stealthMode
    edit(setStealthMode(next))
    const maybeApi = (window as unknown as { api?: Window['api'] }).api
    if (maybeApi?.saveSettings) {
      const nextSettings: Settings = { ...settings, stealthMode: next }
      // Persist + broadcast via settings-store's settings-changed (step 13).
      // Broadcast choice: `settings-changed` via webContents.send to both
      // windows, same mechanism as `session-state` (see settings-store.ts).
      void persistSettings(maybeApi.saveSettings, nextSettings).then((outcome) => {
        if (outcome.ok) dispatchUi({ type: 'saveOk' })
        else dispatchUi({ type: 'saveFailed', message: outcome.message })
      })
    }
  }

  return (
    <div className="settings">
      <div className="settings-header">
        <div className="settings-brand">
          <span className="settings-brand-mark" aria-hidden="true">
            <BrandIcon />
          </span>
          <h1 className="settings-title">VEYRA</h1>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settings.theme === 'dark'}
          aria-label={`Switch to ${settings.theme === 'dark' ? 'light' : 'dark'} theme`}
          className={`theme-toggle${settings.theme === 'dark' ? ' theme-toggle--dark' : ''}`}
          onClick={toggleTheme}
        >
          <span className="theme-toggle-track" aria-hidden="true">
            <span className="theme-toggle-icon theme-toggle-icon--sun">
              <SunIcon />
            </span>
            <span className="theme-toggle-icon theme-toggle-icon--moon">
              <MoonIcon />
            </span>
          </span>
          <span className="theme-toggle-knob" aria-hidden="true" />
        </button>
      </div>
      <form
        className="settings-form persona-card"
        onSubmit={(e) => {
          e.preventDefault()
          onSave()
        }}
      >
        <div className="settings-card-head">
          <span className="settings-card-icon" aria-hidden="true">
            <DocumentIcon />
          </span>
          <span className="settings-card-title">Settings</span>
        </div>
        <label className="settings-field">
          <span className="settings-label">
            <span className="settings-label-icon" aria-hidden="true">
              <EyeOffIcon />
            </span>
            Gemini API key
          </span>
          <span className="settings-input-wrap">
            <input
              type={showKey ? 'text' : 'password'}
              value={settings.apiKey}
              onChange={(e) => edit(setApiKey(e.target.value))}
              placeholder="Paste your Gemini API key"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="settings-eye-toggle"
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
              aria-pressed={showKey}
              onClick={() => setShowKey((v) => !v)}
            >
              {showKey ? <EyeIcon /> : <EyeOffIcon />}
            </button>
          </span>
          {ui.keyRestored && (
            <p className="settings-restored" role="status">
              Saved API key loaded (masked)
            </p>
          )}
        </label>

        <label className="settings-field">
          <span className="settings-label">
            <span className="settings-label-icon" aria-hidden="true">
              <DocumentIcon />
            </span>
            STT model
          </span>
          <select
            value={settings.sttModel}
            onChange={(e) => edit(setSttModel(e.target.value as SttModel))}
          >
            {STT_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <label className="settings-field">
          <span className="settings-label">
            <span className="settings-label-icon" aria-hidden="true">
              <UploadIcon />
            </span>
            Audio device
          </span>
          <select
            value={settings.audioDeviceId ?? ''}
            onChange={(e) => edit(setAudioDevice(e.target.value === '' ? null : e.target.value))}
          >
            {devices.map((d) => (
              <option key={d.deviceId ?? '__default__'} value={d.deviceId ?? ''}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        <button type="submit" className="settings-save">
          <span className="settings-save-icon" aria-hidden="true">
            <UploadIcon />
          </span>
          Save
        </button>
        {captureFallback && (
          <p className="settings-fallback" role="status">
            Audio fallback ({captureFallback.source}): {captureFallback.mode}
          </p>
        )}
        {ui.saved && <p className="settings-saved">Settings saved</p>}
        {ui.error && (
          <p className="settings-error" role="alert">
            {ui.error}
          </p>
        )}
      </form>
      <div className="persona-card visibility-card">
        <div className="persona-card-head">
          <span className="persona-card-icon" aria-hidden="true">
            <EyeIcon />
          </span>
          <span className="persona-card-title">Visibility</span>
        </div>
        <div className="visibility-row">
          <span className="visibility-label">Overlay opacity</span>
          <span className="visibility-value" aria-live="polite">
            {settings.overlayOpacity}%
          </span>
        </div>
        <div className="visibility-slider-wrap">
          <span className="visibility-extreme" aria-hidden="true">
            Faint
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={settings.overlayOpacity}
            onChange={(e) => onOpacityChange(Number(e.target.value))}
            className="visibility-slider"
            aria-label="Overlay opacity"
          />
          <span className="visibility-extreme" aria-hidden="true">
            Full
          </span>
        </div>
        <div className="visibility-stealth-row">
          <div className="visibility-stealth-copy">
            <span className="visibility-stealth-label">Stealth mode</span>
            <span className="visibility-stealth-desc">
              Minimal overlay — just the answer text, no card or buttons. Ideal for screen-sharing.
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.stealthMode}
            aria-label="Toggle stealth mode"
            className={`stealth-toggle${settings.stealthMode ? ' stealth-toggle--on' : ''}`}
            onClick={onStealthToggle}
          >
            <span className="stealth-toggle-knob" aria-hidden="true" />
          </button>
        </div>
      </div>
      <PersonaPanel />
    </div>
  )
}

export default SettingsScreen
