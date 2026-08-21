import { useEffect, useReducer, useState } from 'react'
import {
  hydrate,
  initialSettings,
  setApiKey,
  setAudioDevice,
  setSttModel,
  settingsReducer,
  type Settings,
  type SettingsAction,
  type SttModel
} from './settings-reducer'
import {
  applyLoadedSettings,
  persistSettings,
  settingsUiReducer,
  initialSettingsUiState
} from './settings-persistence'
import { deviceOptions, type AudioDeviceOption } from './device-options'
import type { CaptureMode } from '../capture/mic-capture'

const STT_MODELS: SttModel[] = ['tiny', 'base', 'small']

interface SettingsScreenProps {
  settings?: Settings
  dispatch?: React.Dispatch<SettingsAction>
  captureFallback?: { source: 'mic' | 'loopback'; mode: CaptureMode; error: Error } | null
}

/**
 * Direction: restrained (settings form — labels above controls, one accent
 * for the primary action). Governing spec: the plan step 7 (state/plan-veyra-p1p2.md).
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

  return (
    <div className="settings">
      <h1 className="settings-title">VEYRA</h1>
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault()
          onSave()
        }}
      >
        <label className="settings-field">
          <span className="settings-label">Gemini API key</span>
          <input
            type="password"
            value={settings.apiKey}
            onChange={(e) => edit(setApiKey(e.target.value))}
            placeholder="Paste your Gemini API key"
            autoComplete="off"
            spellCheck={false}
          />
          {ui.keyRestored && (
            <p className="settings-restored" role="status">
              Saved API key loaded (masked)
            </p>
          )}
        </label>

        <label className="settings-field">
          <span className="settings-label">STT model</span>
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
          <span className="settings-label">Audio device</span>
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
    </div>
  )
}

export default SettingsScreen
