import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../src/renderer/src/settings/settings-reducer'

// Temp userData dir, assigned per-test; the mock factory only reads it lazily
// inside app.getPath(), which runs during the tests, never at factory time.
let mockUserDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: (name: string): string => {
      if (name !== 'userData') throw new Error(`unexpected app.getPath(${name})`)
      return mockUserDataDir
    }
  },
  safeStorage: {
    isEncryptionAvailable: (): boolean => true,
    // Identity buffer: encryptString returns the plaintext unchanged as a
    // Buffer, decryptString is its exact inverse.
    encryptString: (plain: string): Buffer => Buffer.from(plain, 'utf8'),
    decryptString: (encrypted: Buffer): string => encrypted.toString('utf8')
  },
  ipcMain: {
    handle: vi.fn()
  }
}))

import { ipcMain } from 'electron'
import { isSettings, load, registerIpcHandlers, save } from '../src/main/settings-store'

const SETTINGS_FILE = 'veyra-settings.json'

const sample: Settings = {
  apiKey: 'sk-test-secret-key-123',
  sttModel: 'base',
  audioDeviceId: 'dev-1',
  theme: 'dark'
}

function fileContent(): string {
  return readFileSync(join(mockUserDataDir, SETTINGS_FILE), 'utf8')
}

describe('settings-store', () => {
  beforeEach(() => {
    mockUserDataDir = mkdtempSync(join(tmpdir(), 'veyra-settings-'))
  })

  afterEach(() => {
    rmSync(mockUserDataDir, { recursive: true, force: true })
  })

  it('load() returns defaults when no file exists yet', () => {
    expect(load()).toEqual({ apiKey: '', sttModel: 'tiny', audioDeviceId: null, theme: 'light' })
  })

  it('save() then load() round-trips all fields', () => {
    save(sample)
    expect(load()).toEqual(sample)
  })

  it('sttModel persists across save/load', () => {
    save({ ...sample, sttModel: 'small' })
    expect(load().sttModel).toBe('small')
    expect(load().apiKey).toBe(sample.apiKey)
  })

  it('written file does NOT contain the plaintext apiKey (only its base64-encrypted form)', () => {
    save(sample)
    const content = fileContent()
    expect(content).not.toContain(sample.apiKey)
    expect(content).toContain(Buffer.from(sample.apiKey, 'utf8').toString('base64'))
  })

  it('other fields are stored plaintext in the file', () => {
    save(sample)
    const content = fileContent()
    expect(content).toContain('"sttModel": "base"')
    expect(content).toContain('"audioDeviceId": "dev-1"')
    expect(content).toContain('"theme": "dark"')
  })

  it('theme round-trips and is plaintext', () => {
    save({ ...sample, theme: 'light' })
    expect(load().theme).toBe('light')
    expect(fileContent()).toContain('"theme": "light"')
    save({ ...sample, theme: 'dark' })
    expect(load().theme).toBe('dark')
  })

  it('migrates files written before theme existed (defaults to light)', () => {
    // Simulate an old file without the theme key — reuse the mocked
    // userData dir directly (the electron mock already points there).
    const file = join(mockUserDataDir, SETTINGS_FILE)
    mkdirSync(dirname(file), { recursive: true })
    // Replicate the encrypt helper from the electron mock (identity buffer)
    const encrypted = Buffer.from(sample.apiKey, 'utf8').toString('base64')
    const oldPayload = {
      apiKey: encrypted,
      sttModel: sample.sttModel,
      audioDeviceId: sample.audioDeviceId
    }
    writeFileSync(file, JSON.stringify(oldPayload), 'utf8')
    expect(load().theme).toBe('light')
    expect(load().apiKey).toBe(sample.apiKey)
  })

  it('save() rejects malformed payloads at the trust boundary', () => {
    expect(() => save({ apiKey: 42 } as unknown as Settings)).toThrow(
      'settings:save payload failed validation'
    )
  })

  it('isSettings accepts valid settings and rejects malformed values', () => {
    expect(isSettings(sample)).toBe(true)
    expect(isSettings({ ...sample, sttModel: 'huge' })).toBe(false)
    expect(isSettings({ ...sample, audioDeviceId: 42 })).toBe(false)
    expect(isSettings({ ...sample, theme: 'blue' })).toBe(false)
    expect(isSettings({ ...sample, theme: undefined })).toBe(false)
    expect(isSettings(null)).toBe(false)
  })

  it('registerIpcHandlers registers settings:save and settings:load on ipcMain', () => {
    registerIpcHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('settings:save', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('settings:load', expect.any(Function))
  })

  it('IPC round-trip: settings:save persists and settings:load returns the same settings', () => {
    registerIpcHandlers()
    const calls = vi.mocked(ipcMain.handle).mock.calls
    const saveHandler = calls.find(([channel]) => channel === 'settings:save')![1] as (
      _event: unknown,
      payload: unknown
    ) => Settings
    const loadHandler = calls.find(([channel]) => channel === 'settings:load')![1] as (
      _event?: unknown
    ) => Settings

    expect(saveHandler({}, sample)).toEqual(sample)
    expect(loadHandler()).toEqual(sample)
    expect(fileContent()).not.toContain(sample.apiKey)
  })

  it('settings:save handler rejects malformed payloads at the IPC trust boundary', () => {
    registerIpcHandlers()
    const calls = vi.mocked(ipcMain.handle).mock.calls
    const saveHandler = calls.find(([channel]) => channel === 'settings:save')![1] as (
      _event: unknown,
      payload: unknown
    ) => Settings
    expect(() => saveHandler({}, { apiKey: 42 })).toThrow('settings:save payload failed validation')
  })
})
