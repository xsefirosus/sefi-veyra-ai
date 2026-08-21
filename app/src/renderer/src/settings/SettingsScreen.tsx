import { useEffect, useReducer, useState } from 'react'
import {
  initialSettings,
  setApiKey,
  setAudioDevice,
  setSttModel,
  settingsReducer,
  type Settings,
  type SettingsAction,
  type SttModel
} from './settings-reducer'
import { LOOPBACK_DEVICE_ID } from '../capture/loopback-capture'
import type { CaptureMode } from '../capture/mic-capture'

const STT_MODELS: SttModel[] = ['tiny', 'base', 'small']

interface AudioDeviceOption {
  deviceId: string | null
  label: string
}

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
  const [saved, setSaved] = useState(false)

  // Audio device list feeds the device <select> (plan step 17 feeds this same
  // list from the capture path; enumerateDevices is the zero-dependency source).
  // Step 19 appends the virtual loopback track: "System audio (loopback)" is
  // NOT an audioinput device -- it is the plan's dual-track second capture.
  // The sentinel (LOOPBACK_DEVICE_ID) must never reach getUserMedia; the mic
  // path is its only consumer and treats it as absent.
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      if (!navigator.mediaDevices?.enumerateDevices) return
      try {
        const found = await navigator.mediaDevices.enumerateDevices()
        if (cancelled) return
        const inputs = found
          .filter((d) => d.kind === 'audioinput')
          .map((d) => ({ deviceId: d.deviceId, label: d.label || d.deviceId }))
        setDevices([
          { deviceId: null, label: 'System default' },
          ...inputs,
          { deviceId: LOOPBACK_DEVICE_ID, label: 'System audio (loopback)' }
        ])
      } catch {
        // Enumeration can throw (permission/policy); the default entry still works.
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const onSave = (): void => {
    // Contract (preload index.ts + main index.ts): settings:save validates and
    // stores to the in-memory map; resolves with the stored settings.
    void window.api.saveSettings(settings).then(() => setSaved(true))
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
            onChange={(e) => dispatch(setApiKey(e.target.value))}
            placeholder="Paste your Gemini API key"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <label className="settings-field">
          <span className="settings-label">STT model</span>
          <select
            value={settings.sttModel}
            onChange={(e) => dispatch(setSttModel(e.target.value as SttModel))}
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
            onChange={(e) =>
              dispatch(setAudioDevice(e.target.value === '' ? null : e.target.value))
            }
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
        {saved && <p className="settings-saved">Settings saved</p>}
      </form>
    </div>
  )
}

export default SettingsScreen
