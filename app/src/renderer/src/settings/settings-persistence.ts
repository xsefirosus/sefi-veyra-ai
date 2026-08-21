import type { Settings } from './settings-reducer'

/**
 * Step 11 (plan-veyra-audit-01.md): the read half of the settings round-trip.
 *
 * Pure, node-testable core of SettingsScreen's mount/save wiring — the vitest
 * suite has no DOM renderer, so every behavior lives here and the component
 * stays thin:
 *  - applyLoadedSettings: hydration on mount; a failed load keeps the defaults.
 *  - persistSettings: save() rejections surface as {ok:false,message} instead
 *    of becoming a silent unhandled rejection.
 *  - settingsUiReducer: saved/restored/error flags ('edit' resets them).
 */

export type SaveOutcome = { ok: true } | { ok: false; message: string }

/** Run the mount-time load; any failure leaves the defaults standing. */
export async function applyLoadedSettings(
  load: () => Promise<Settings>,
  apply: (loaded: Settings) => void
): Promise<void> {
  try {
    apply(await load())
  } catch {
    // window.api.loadSettings missing or IPC gone mid-flight: defaults remain,
    // never crash on mount.
  }
}

/** Save with the rejection surfaced as data instead of an unhandled rejection. */
export async function persistSettings(
  save: (settings: Settings) => Promise<Settings>,
  settings: Settings
): Promise<SaveOutcome> {
  try {
    await save(settings)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export interface SettingsUiState {
  /** "Settings saved" is transient: shown after saveOk until the next edit. */
  saved: boolean
  /** A non-empty apiKey came back from disk — show the masked "saved key" hint. */
  keyRestored: boolean
  /** Last save failure message (safeStorage refusal etc.), null when none. */
  error: string | null
}

export const initialSettingsUiState: SettingsUiState = {
  saved: false,
  keyRestored: false,
  error: null
}

export type SettingsUiAction =
  | { type: 'edit' }
  | { type: 'hydrated'; hasKey: boolean }
  | { type: 'saveOk' }
  | { type: 'saveFailed'; message: string }

export function settingsUiReducer(
  state: SettingsUiState,
  action: SettingsUiAction
): SettingsUiState {
  switch (action.type) {
    case 'edit':
      return { ...state, saved: false, keyRestored: false }
    case 'hydrated':
      return { ...state, keyRestored: action.hasKey }
    case 'saveOk':
      return { ...state, saved: true, error: null }
    case 'saveFailed':
      return { ...state, saved: false, error: action.message }
    default:
      return state
  }
}
