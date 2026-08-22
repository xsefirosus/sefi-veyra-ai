import type { PersonaData } from './persona-reducer'

/**
 * Step 9 (mirrors step 11 settings-persistence): pure, node-testable core of
 * PersonaPanel's mount/save wiring. Vitest suite has no DOM renderer, so
 * behavior lives here and the component stays thin.
 *  - applyLoadedPersona: hydration on mount; failed load keeps defaults.
 *  - persistPersona: save rejections surface as {ok:false,message}.
 *  - personaUiReducer: saved/error flags ('edit' resets them).
 */

export type SaveOutcome = { ok: true } | { ok: false; message: string }

export async function applyLoadedPersona(
  load: () => Promise<PersonaData>,
  apply: (loaded: PersonaData) => void
): Promise<void> {
  try {
    apply(await load())
  } catch {
    // window.api.loadPersona missing or IPC gone: defaults remain, never crash.
  }
}

export async function persistPersona(
  save: (data: PersonaData) => Promise<PersonaData>,
  data: PersonaData
): Promise<SaveOutcome> {
  try {
    await save(data)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export interface PersonaUiState {
  saved: boolean
  error: string | null
  pickError: string | null
}

export const initialPersonaUiState: PersonaUiState = {
  saved: false,
  error: null,
  pickError: null
}

export type PersonaUiAction =
  | { type: 'edit' }
  | { type: 'hydrated' }
  | { type: 'saveOk' }
  | { type: 'saveFailed'; message: string }
  | { type: 'pickFailed'; message: string }
  | { type: 'clearPickError' }

export function personaUiReducer(state: PersonaUiState, action: PersonaUiAction): PersonaUiState {
  switch (action.type) {
    case 'edit':
      return { ...state, saved: false, error: null, pickError: null }
    case 'hydrated':
      return { ...state, saved: false, error: null }
    case 'saveOk':
      return { ...state, saved: true, error: null }
    case 'saveFailed':
      return { ...state, saved: false, error: action.message }
    case 'pickFailed':
      return { ...state, pickError: action.message }
    case 'clearPickError':
      return { ...state, pickError: null }
    default:
      return state
  }
}
