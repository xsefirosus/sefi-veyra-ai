import { describe, expect, it } from 'vitest'
import {
  hydrate,
  initialSettings,
  settingsReducer,
  setApiKey,
  setAudioDevice,
  setSttModel,
  setTheme
} from '../src/renderer/src/settings/settings-reducer'

describe('settings-reducer', () => {
  it('has the documented default state', () => {
    expect(initialSettings).toEqual({
      apiKey: '',
      sttModel: 'tiny',
      audioDeviceId: null,
      theme: 'light'
    })
  })

  it('setApiKey replaces the api key', () => {
    const next = settingsReducer(initialSettings, setApiKey('AIza-test-key'))
    expect(next.apiKey).toBe('AIza-test-key')
    expect(next.sttModel).toBe('tiny')
    expect(next.audioDeviceId).toBeNull()
  })

  it('setSttModel replaces the stt model', () => {
    const next = settingsReducer(initialSettings, setSttModel('base'))
    expect(next.sttModel).toBe('base')
    expect(next.apiKey).toBe('')
    expect(next.audioDeviceId).toBeNull()
  })

  it('setAudioDevice replaces the audio device id', () => {
    const next = settingsReducer(initialSettings, setAudioDevice('default:mic'))
    expect(next.audioDeviceId).toBe('default:mic')
    expect(next.apiKey).toBe('')
    expect(next.sttModel).toBe('tiny')
  })

  it('setAudioDevice accepts null (no device selected)', () => {
    const withDevice = settingsReducer(initialSettings, setAudioDevice('dev-1'))
    const next = settingsReducer(withDevice, setAudioDevice(null))
    expect(next.audioDeviceId).toBeNull()
  })

  it('setTheme switches light ↔ dark', () => {
    const toDark = settingsReducer(initialSettings, setTheme('dark'))
    expect(toDark.theme).toBe('dark')
    expect(toDark.apiKey).toBe('')
    const toLight = settingsReducer(toDark, setTheme('light'))
    expect(toLight.theme).toBe('light')
  })

  it('hydrate merges persisted settings including theme', () => {
    const persisted = {
      apiKey: 'k',
      sttModel: 'base' as const,
      audioDeviceId: 'dev-2',
      theme: 'dark' as const
    }
    const next = settingsReducer(initialSettings, hydrate(persisted))
    expect(next).toEqual(persisted)
  })

  it('unknown action returns the state unchanged (same reference)', () => {
    const next = settingsReducer(initialSettings, { type: 'nope' } as never)
    expect(next).toBe(initialSettings)
  })
})
