/**
 * Step 9 seams (mirrors audit-01 step 11 settings-roundtrip):
 *  1. Hydration on mount   -> personaReducer 'hydrate' + applyLoadedPersona()
 *  2. Save failure surface -> persistPersona() outcome {ok:false}
 *  3. Saved-flag lifecycle -> personaUiReducer ('edit' resets)
 */
import { describe, expect, it, vi } from 'vitest'
import {
  hydratePersona,
  initialPersona,
  personaReducer,
  type PersonaData
} from '../src/renderer/src/persona/persona-reducer'
import {
  applyLoadedPersona,
  initialPersonaUiState,
  persistPersona,
  personaUiReducer
} from '../src/renderer/src/persona/persona-persistence'

const savedOnDisk: PersonaData = {
  resumeText: 'Jane Doe — Senior',
  resumeFileName: 'jane.pdf',
  jobDescription: 'Staff Engineer at Acme',
  notes: 'Prefers concise answers',
  additionalDocs: [{ fileName: 'a.txt', text: 'hello' }]
}

describe('step 9: hydration on mount', () => {
  it('hydrate replaces defaults so saved resume/JD/notes survive restart', () => {
    const next = personaReducer(initialPersona, hydratePersona(savedOnDisk))
    expect(next).toEqual(savedOnDisk)
  })

  it('applyLoadedPersona applies the load() result', async () => {
    const load = vi.fn(async () => savedOnDisk)
    const apply = vi.fn()
    await applyLoadedPersona(load, apply)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith(savedOnDisk)
  })

  it('load() rejecting leaves defaults standing (no crash on mount)', async () => {
    const load = vi.fn(async () => {
      throw new Error('ipc gone')
    })
    const apply = vi.fn()
    await applyLoadedPersona(load, apply)
    expect(apply).not.toHaveBeenCalled()
  })
})

describe('step 9: save-failure surfaces an error', () => {
  it('successful save resolves {ok:true}', async () => {
    const save = vi.fn(async (d: PersonaData) => d)
    const outcome = await persistPersona(save, savedOnDisk)
    expect(save).toHaveBeenCalledWith(savedOnDisk)
    expect(outcome).toEqual({ ok: true })
  })

  it('persist failure becomes {ok:false} with message', async () => {
    const save = vi.fn(async (): Promise<PersonaData> => {
      throw new Error('persona:save payload failed validation')
    })
    const outcome = await persistPersona(save, savedOnDisk)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('expected failure')
    expect(outcome.message).toBe('persona:save payload failed validation')
  })

  it('non-Error rejections are stringified', async () => {
    const save = vi.fn(async (): Promise<PersonaData> => {
      throw 'boom'
    })
    const outcome = await persistPersona(save, savedOnDisk)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('expected failure')
    expect(outcome.message).toBe('boom')
  })
})

describe('step 9: saved-flag lifecycle', () => {
  it('starts with nothing saved, no error', () => {
    expect(initialPersonaUiState).toEqual({ saved: false, error: null, pickError: null })
  })

  it('saveOk shows flag and clears earlier error', () => {
    const failed = personaUiReducer(initialPersonaUiState, {
      type: 'saveFailed',
      message: 'fail'
    })
    const ok = personaUiReducer(failed, { type: 'saveOk' })
    expect(ok.saved).toBe(true)
    expect(ok.error).toBeNull()
  })

  it('next edit resets saved flag and errors', () => {
    const afterSave = personaUiReducer(initialPersonaUiState, { type: 'saveOk' })
    const afterEdit = personaUiReducer(afterSave, { type: 'edit' })
    expect(afterSave.saved).toBe(true)
    expect(afterEdit.saved).toBe(false)
    expect(afterEdit.error).toBeNull()
    expect(afterEdit.pickError).toBeNull()
  })

  it('saveFailed surfaces message and hides saved', () => {
    const state = personaUiReducer(initialPersonaUiState, { type: 'saveOk' })
    const failed = personaUiReducer(state, { type: 'saveFailed', message: 'boom' })
    expect(failed.saved).toBe(false)
    expect(failed.error).toBe('boom')
  })

  it('pickFailed surfaces message independently', () => {
    const failed = personaUiReducer(initialPersonaUiState, {
      type: 'pickFailed',
      message: 'unsupported file type: .png'
    })
    expect(failed.pickError).toBe('unsupported file type: .png')
    expect(failed.saved).toBe(false)
  })

  it('clearPickError resets pickError', () => {
    const failed = personaUiReducer(initialPersonaUiState, {
      type: 'pickFailed',
      message: 'x'
    })
    const cleared = personaUiReducer(failed, { type: 'clearPickError' })
    expect(cleared.pickError).toBeNull()
  })

  it('hydrated clears error but not pickError handling', () => {
    const failed = personaUiReducer(initialPersonaUiState, {
      type: 'saveFailed',
      message: 'x'
    })
    const hydrated = personaUiReducer(failed, { type: 'hydrated' })
    expect(hydrated.error).toBeNull()
    expect(hydrated.saved).toBe(false)
  })
})
