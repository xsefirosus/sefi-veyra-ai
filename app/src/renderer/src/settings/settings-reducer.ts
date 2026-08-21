export type SttModel = 'tiny' | 'base' | 'small'

export interface Settings {
  apiKey: string
  sttModel: SttModel
  audioDeviceId: string | null
}

export const initialSettings: Settings = {
  apiKey: '',
  sttModel: 'tiny',
  audioDeviceId: null
}

export type SettingsAction =
  | { type: 'setApiKey'; apiKey: string }
  | { type: 'setSttModel'; sttModel: SttModel }
  | { type: 'setAudioDevice'; audioDeviceId: string | null }
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
    case 'hydrate':
      // Merge over the current state so a partial payload can never blank a field.
      return { ...state, ...action.settings }
    default:
      return state
  }
}
