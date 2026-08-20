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
    (typeof v['audioDeviceId'] === 'string' || v['audioDeviceId'] === null)
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
    if (!isSettings(parsed)) return { apiKey: '', sttModel: 'tiny', audioDeviceId: null }
    return {
      apiKey: decryptApiKey(parsed.apiKey),
      sttModel: parsed.sttModel,
      audioDeviceId: parsed.audioDeviceId
    }
  } catch {
    // First run (no file), corrupt JSON, or a key that no longer decrypts
    // (tampered file / different Windows user): fall back to defaults, never crash.
    return { apiKey: '', sttModel: 'tiny', audioDeviceId: null }
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
    audioDeviceId: settings.audioDeviceId
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