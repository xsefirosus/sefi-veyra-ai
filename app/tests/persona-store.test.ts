import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PersonaData } from '../src/main/persona/persona-store'

// Temp userData dir, assigned per-test; mock factory reads it lazily inside app.getPath()
let mockUserDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: (name: string): string => {
      if (name !== 'userData') throw new Error(`unexpected app.getPath(${name})`)
      return mockUserDataDir
    }
  },
  ipcMain: {
    handle: vi.fn()
  }
}))

import { ipcMain } from 'electron'
import {
  defaultPersona,
  isPersonaData,
  load,
  registerIpcHandlers,
  save
} from '../src/main/persona/persona-store'

const PERSONA_FILE = 'veyra-persona.json'

const sample: PersonaData = {
  resumeText: 'Jane Doe — Senior Engineer\n10 years experience',
  resumeFileName: 'jane-resume.pdf',
  jobDescription: 'Staff Engineer role at Acme Corp',
  notes: 'Prefers concise answers',
  additionalDocs: [
    { fileName: 'cover-letter.txt', text: 'Dear hiring manager...' },
    { fileName: 'notes.md', text: '# Talking points\n- leadership' }
  ]
}

function fileContent(): string {
  return readFileSync(join(mockUserDataDir, PERSONA_FILE), 'utf8')
}

describe('persona-store', () => {
  beforeEach(() => {
    mockUserDataDir = mkdtempSync(join(tmpdir(), 'veyra-persona-'))
  })

  afterEach(() => {
    rmSync(mockUserDataDir, { recursive: true, force: true })
  })

  it('load() returns defaults when no file exists yet', () => {
    expect(load()).toEqual(defaultPersona)
  })

  it('load() returns defaults when file contains corrupt JSON', () => {
    writeFileSync(join(mockUserDataDir, PERSONA_FILE), '{ not valid json', 'utf8')
    expect(load()).toEqual(defaultPersona)
  })

  it('load() returns defaults when file contains valid JSON with wrong shape', () => {
    writeFileSync(join(mockUserDataDir, PERSONA_FILE), JSON.stringify({ resumeText: 42 }), 'utf8')
    expect(load()).toEqual(defaultPersona)
  })

  it('save() then load() round-trips all fields', () => {
    save(sample)
    expect(load()).toEqual(sample)
  })

  it('save() and load() handle null resumeFileName', () => {
    const data: PersonaData = { ...sample, resumeFileName: null, resumeText: '' }
    save(data)
    expect(load()).toEqual(data)
  })

  it('save() and load() handle empty additionalDocs', () => {
    const data: PersonaData = { ...sample, additionalDocs: [] }
    save(data)
    expect(load()).toEqual(data)
  })

  it('written file is plaintext JSON containing the persona fields', () => {
    save(sample)
    const content = fileContent()
    const parsed = JSON.parse(content) as PersonaData
    expect(parsed.resumeText).toBe(sample.resumeText)
    expect(parsed.resumeFileName).toBe(sample.resumeFileName)
    expect(parsed.jobDescription).toBe(sample.jobDescription)
    expect(parsed.notes).toBe(sample.notes)
    expect(parsed.additionalDocs).toEqual(sample.additionalDocs)
    // Plaintext check: resume text appears verbatim
    expect(content).toContain('Jane Doe')
    expect(content).toContain('cover-letter.txt')
  })

  it('additionalDocs with multiple entries round-trips', () => {
    save(sample)
    const loaded = load()
    expect(loaded.additionalDocs).toHaveLength(2)
    expect(loaded.additionalDocs[0]!.fileName).toBe('cover-letter.txt')
    expect(loaded.additionalDocs[1]!.text).toBe('# Talking points\n- leadership')
  })

  it('save() rejects malformed payloads at the trust boundary', () => {
    expect(() => save({ resumeText: 42 } as unknown as PersonaData)).toThrow(
      'persona:save payload failed validation'
    )
    expect(() =>
      save({ ...sample, additionalDocs: [{ fileName: 123, text: 'hi' }] } as unknown as PersonaData)
    ).toThrow('persona:save payload failed validation')
    expect(() => save(null as unknown as PersonaData)).toThrow(
      'persona:save payload failed validation'
    )
  })

  it('isPersonaData accepts valid data and rejects malformed values', () => {
    expect(isPersonaData(sample)).toBe(true)
    expect(isPersonaData(defaultPersona)).toBe(true)
    expect(isPersonaData({ ...sample, resumeText: 42 })).toBe(false)
    expect(isPersonaData({ ...sample, resumeFileName: 42 })).toBe(false)
    expect(isPersonaData({ ...sample, jobDescription: null })).toBe(false)
    expect(isPersonaData({ ...sample, notes: undefined })).toBe(false)
    expect(isPersonaData({ ...sample, additionalDocs: 'not-array' })).toBe(false)
    expect(isPersonaData({ ...sample, additionalDocs: [{ fileName: 'a.txt' }] })).toBe(false)
    expect(isPersonaData(null)).toBe(false)
    expect(isPersonaData(undefined)).toBe(false)
  })

  it('registerIpcHandlers registers persona:save and persona:load on ipcMain', () => {
    registerIpcHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('persona:save', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('persona:load', expect.any(Function))
  })

  it('IPC round-trip: persona:save persists and persona:load returns the same data', () => {
    registerIpcHandlers()
    const calls = vi.mocked(ipcMain.handle).mock.calls
    const saveHandler = calls.find(([channel]) => channel === 'persona:save')![1] as (
      _event: unknown,
      payload: unknown
    ) => PersonaData
    const loadHandler = calls.find(([channel]) => channel === 'persona:load')![1] as (
      _event?: unknown
    ) => PersonaData

    expect(saveHandler({}, sample)).toEqual(sample)
    expect(loadHandler()).toEqual(sample)
    expect(fileContent()).toContain('Jane Doe')
  })

  it('IPC persona:save handler rejects malformed payloads at the trust boundary', () => {
    registerIpcHandlers()
    const calls = vi.mocked(ipcMain.handle).mock.calls
    const saveHandler = calls.find(([channel]) => channel === 'persona:save')![1] as (
      _event: unknown,
      payload: unknown
    ) => PersonaData
    expect(() => saveHandler({}, { resumeText: 42 })).toThrow(
      'persona:save payload failed validation'
    )
  })
})
