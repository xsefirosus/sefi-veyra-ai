export type SttModel = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3'

export type Theme = 'light' | 'dark'

export interface Settings {
  apiKey: string
  sttModel: SttModel
  audioDeviceId: string | null
  theme: Theme
  overlayOpacity: number
  stealthMode: boolean
}

export const initialSettings: Settings = {
  apiKey: '',
  sttModel: 'tiny',
  audioDeviceId: null,
  theme: 'light',
  overlayOpacity: 90,
  stealthMode: false
}

export type SettingsAction =
  | { type: 'setApiKey'; apiKey: string }
  | { type: 'setSttModel'; sttModel: SttModel }
  | { type: 'setAudioDevice'; audioDeviceId: string | null }
  | { type: 'setTheme'; theme: Theme }
  | { type: 'setOverlayOpacity'; overlayOpacity: number }
  | { type: 'setStealthMode'; stealthMode: boolean }
  /** Step 11: replace defaults with the persisted settings loaded on mount. */
  | { type: 'hydrate'; settings: Settings }

export function setApiKey(apiKey: string): SettingsAction {
  return { type: 'setApiKey', apiKey }
}

export function setSttModel(sttModel: SttModel): SettingsAction {
  return { type: 'setSttModel', sttModel }
}

export function setAudioDevice(audioDeviceId: string | null): SettingsAction {
  return { type: 'setAudioDevice', audioDeviceId }
}

export function setTheme(theme: Theme): SettingsAction {
  return { type: 'setTheme', theme }
}

export function setOverlayOpacity(overlayOpacity: number): SettingsAction {
  return { type: 'setOverlayOpacity', overlayOpacity }
}

export function setStealthMode(stealthMode: boolean): SettingsAction {
  return { type: 'setStealthMode', stealthMode }
}

/** Step 11: action creator for the mount-time hydration from settings:load. */
export function hydrate(settings: Settings): SettingsAction {
  return { type: 'hydrate', settings }
}

export function settingsReducer(state: Settings, action: SettingsAction): Settings {
  switch (action.type) {
    case 'setApiKey':
      return { ...state, apiKey: action.apiKey }
    case 'setSttModel':
      return { ...state, sttModel: action.sttModel }
    case 'setAudioDevice':
      return { ...state, audioDeviceId: action.audioDeviceId }
    case 'setTheme':
      return { ...state, theme: action.theme }
    case 'setOverlayOpacity': {
      const v = action.overlayOpacity
      // Trust boundary: clamp to 0-100 and round to integer; reducer never
      // stores an out-of-range value even if the IPC validator missed it.
      const clamped = Math.round(Math.min(100, Math.max(0, Number.isFinite(v) ? v : 90)))
      return { ...state, overlayOpacity: clamped }
    }
    case 'setStealthMode':
      return { ...state, stealthMode: action.stealthMode }
    case 'hydrate':
      // Merge over the current state so a partial payload can never blank a field.
      return { ...state, ...action.settings }
    default:
      return state
  }
}
