import { app, ipcMain, safeStorage } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Settings } from '../renderer/src/settings/settings-reducer'

/**
 * Step 8: disk persistence for settings.
 *
 * veyra-settings.json lives under app.getPath('userData') (outside the repo).
 * The apiKey field is stored ONLY as base64(safeStorage.encryptString(key));
 * every other field is plaintext. On Windows safeStorage is DPAPI, so the file
 * is not portable across Windows users/machines -- accepted for v1.
 *
 * The key is never logged and never written in plaintext. If safeStorage
 * encryption is unavailable and a non-empty key is being saved, save() throws
 * rather than degrade to plaintext (loud failure over silent data loss).
 */

const SETTINGS_FILE = 'veyra-settings.json'
const SAVE_CHANNEL = 'settings:save'
const LOAD_CHANNEL = 'settings:load'

/** Trust-boundary shape check (moved here from step 7's inline handler). */
export function isSettings(value: unknown): value is Settings {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v['apiKey'] === 'string' &&
    (v['sttModel'] === 'tiny' || v['sttModel'] === 'base' || v['sttModel'] === 'small') &&
    (typeof v['audioDeviceId'] === 'string' || v['audioDeviceId'] === null) &&
    (v['theme'] === 'light' || v['theme'] === 'dark') &&
    typeof v['overlayOpacity'] === 'number' &&
    Number.isFinite(v['overlayOpacity']) &&
    Number.isInteger(v['overlayOpacity']) &&
    (v['overlayOpacity'] as number) >= 0 &&
    (v['overlayOpacity'] as number) <= 100
  )
}

function settingsPath(): string {
  return join(app.getPath('userData'), SETTINGS_FILE)
}

/** base64(safeStorage.encryptString(key)); empty key stays empty, never plaintext. */
function encryptApiKey(apiKey: string): string {
  if (apiKey === '') return ''
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption unavailable; refusing to persist apiKey')
  }
  return safeStorage.encryptString(apiKey).toString('base64')
}

function decryptApiKey(stored: string): string {
  if (stored === '') return ''
  return safeStorage.decryptString(Buffer.from(stored, 'base64'))
}

/** Read settings from disk; missing/corrupt file or undecryptable key -> defaults. */
export function load(): Settings {
  try {
    const raw = readFileSync(settingsPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!isSettings(parsed)) {
      // Backward compat: files written before theme/overlayOpacity existed lack
      // those fields. If the old shape validates, migrate forward with defaults.
      // overlayOpacity default 90 — sane window legibility, NOT the canvas's
      // illustrative 65% copy which was a mockup placeholder.
      if (typeof parsed === 'object' && parsed !== null) {
        const v = parsed as Record<string, unknown>
        const baseValid =
          typeof v['apiKey'] === 'string' &&
          (v['sttModel'] === 'tiny' || v['sttModel'] === 'base' || v['sttModel'] === 'small') &&
          (typeof v['audioDeviceId'] === 'string' || v['audioDeviceId'] === null)
        if (baseValid) {
          const themeValid = v['theme'] === 'light' || v['theme'] === 'dark'
          const opacityRaw = v['overlayOpacity']
          const opacityValid =
            typeof opacityRaw === 'number' &&
            Number.isFinite(opacityRaw) &&
            Number.isInteger(opacityRaw) &&
            opacityRaw >= 0 &&
            opacityRaw <= 100
          // Any combination of missing/invalid new fields -> migrate with defaults
          // for those fields, but only if the base fields are intact.
          const theme = themeValid ? (v['theme'] as Settings['theme']) : 'light'
          const overlayOpacity = opacityValid ? (opacityRaw as number) : 90
          // If either new field was missing/invalid, treat as migratable.
          if (!themeValid || !opacityValid) {
            return {
              apiKey: decryptApiKey(v['apiKey'] as string),
              sttModel: v['sttModel'] as Settings['sttModel'],
              audioDeviceId: v['audioDeviceId'] as string | null,
              theme,
              overlayOpacity
            }
          }
        }
      }
      return { apiKey: '', sttModel: 'tiny', audioDeviceId: null, theme: 'light', overlayOpacity: 90 }
    }
    return {
      apiKey: decryptApiKey(parsed.apiKey),
      sttModel: parsed.sttModel,
      audioDeviceId: parsed.audioDeviceId,
      theme: parsed.theme,
      overlayOpacity: parsed.overlayOpacity
    }
  } catch {
    // First run (no file), corrupt JSON, or a key that no longer decrypts
    // (tampered file / different Windows user): fall back to defaults, never crash.
    return { apiKey: '', sttModel: 'tiny', audioDeviceId: null, theme: 'light', overlayOpacity: 90 }
  }
}

/** Validate, encrypt the key, and write veyra-settings.json. Returns the saved settings. */
export function save(settings: Settings): Settings {
  // Trust boundary: the renderer is not trusted; reject malformed payloads.
  if (!isSettings(settings)) {
    throw new Error('settings:save payload failed validation')
  }
  const payload = {
    apiKey: encryptApiKey(settings.apiKey),
    sttModel: settings.sttModel,
    audioDeviceId: settings.audioDeviceId,
    theme: settings.theme,
    overlayOpacity: settings.overlayOpacity
  }
  const file = settingsPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8')
  return settings
}

/** Register the settings:save / settings:load IPC handlers. Call once from main index. */
export function registerIpcHandlers(): void {
  ipcMain.handle(SAVE_CHANNEL, (_event, payload: unknown): Settings => save(payload as Settings))
  ipcMain.handle(LOAD_CHANNEL, (): Settings => load())
}
