/**
 * Plan step 11 (plan-veyra-audit-01.md): the settings round-trip was write-only.
 *
 * Seams under test (agreed before first test):
 *   1. Hydration on mount   -> settingsReducer 'hydrate' action + applyLoadedSettings()
 *   2. Save failure surface -> persistSettings() outcome {ok:false,message}
 *                              (safeStorage throw must not be an unhandled rejection)
 *   3. Saved-flag lifecycle -> settingsUiReducer ('edit' resets the flag)
 * The 'settings:load' IPC contract itself is covered by tests/settings-store.test.ts;
 * the preload binding is typed glue (src/preload/index.d.ts).
 */
import { describe, expect, it, vi } from 'vitest'
import {
  hydrate,
  initialSettings,
  settingsReducer,
  type Settings
} from '../src/renderer/src/settings/settings-reducer'
import {
  applyLoadedSettings,
  initialSettingsUiState,
  persistSettings,
  settingsUiReducer
} from '../src/renderer/src/settings/settings-persistence'

const savedOnDisk: Settings = {
  apiKey: 'AIza-saved-key',
  sttModel: 'base',
  audioDeviceId: 'dev-9',
  theme: 'light',
  overlayOpacity: 90,
  stealthMode: false
}

describe('step 11: hydration on mount', () => {
  it('hydrate replaces the defaults so a saved key/model/device survive restart', () => {
    const next = settingsReducer(initialSettings, hydrate(savedOnDisk))
    expect(next).toEqual(savedOnDisk)
  })

  it('applyLoadedSettings applies the load() result', async () => {
    const load = vi.fn(async () => savedOnDisk)
    const apply = vi.fn()
    await applyLoadedSettings(load, apply)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith(savedOnDisk)
  })

  it('load() rejecting leaves the defaults standing (no crash on mount)', async () => {
    const load = vi.fn(async () => {
      throw new Error('ipc handler gone')
    })
    const apply = vi.fn()
    await applyLoadedSettings(load, apply)
    expect(apply).not.toHaveBeenCalled()
  })
})

describe('step 11: save-failure surfaces an error', () => {
  it('a successful save resolves {ok:true}', async () => {
    const save = vi.fn(async (s: Settings) => s)
    const outcome = await persistSettings(save, savedOnDisk)
    expect(save).toHaveBeenCalledWith(savedOnDisk)
    expect(outcome).toEqual({ ok: true })
  })

  it('the safeStorage refusal becomes {ok:false} with the thrown message', async () => {
    const save = vi.fn(async (): Promise<Settings> => {
      throw new Error('safeStorage encryption unavailable; refusing to persist apiKey')
    })
    const outcome = await persistSettings(save, savedOnDisk)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('expected a failure outcome')
    expect(outcome.message).toBe('safeStorage encryption unavailable; refusing to persist apiKey')
  })

  it('non-Error rejections are stringified, never swallowed', async () => {
    const save = vi.fn(async (): Promise<Settings> => {
      throw 'boom'
    })
    const outcome = await persistSettings(save, savedOnDisk)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('expected a failure outcome')
    expect(outcome.message).toBe('boom')
  })
})

describe('step 11: saved-flag lifecycle', () => {
  it('starts with nothing saved, nothing restored, no error', () => {
    expect(initialSettingsUiState).toEqual({ saved: false, keyRestored: false, error: null })
  })

  it('saveOk shows the flag and clears any earlier error', () => {
    const failed = settingsUiReducer(initialSettingsUiState, {
      type: 'saveFailed',
      message: 'safeStorage encryption unavailable'
    })
    const ok = settingsUiReducer(failed, { type: 'saveOk' })
    expect(ok.saved).toBe(true)
    expect(ok.error).toBeNull()
  })

  it('the next edit resets the saved flag AND the restored-key hint', () => {
    const afterSave = settingsUiReducer(initialSettingsUiState, { type: 'saveOk' })
    const afterEdit = settingsUiReducer(afterSave, { type: 'edit' })
    expect(afterSave.saved).toBe(true)
    expect(afterEdit.saved).toBe(false)
    expect(afterEdit.keyRestored).toBe(false)
    expect(afterEdit.error).toBeNull()
  })

  it('saveFailed surfaces the message and hides the saved flag', () => {
    const state = settingsUiReducer(initialSettingsUiState, { type: 'saveOk' })
    const failed = settingsUiReducer(state, {
      type: 'saveFailed',
      message: 'safeStorage encryption unavailable; refusing to persist apiKey'
    })
    expect(failed.saved).toBe(false)
    expect(failed.error).toBe('safeStorage encryption unavailable; refusing to persist apiKey')
  })

  it('hydrate marks keyRestored only when a key came back from disk', () => {
    const withKey = settingsUiReducer(initialSettingsUiState, { type: 'hydrated', hasKey: true })
    const withoutKey = settingsUiReducer(initialSettingsUiState, {
      type: 'hydrated',
      hasKey: false
    })
    expect(withKey.keyRestored).toBe(true)
    expect(withoutKey.keyRestored).toBe(false)
    expect(withKey.saved).toBe(false)
  })
})
