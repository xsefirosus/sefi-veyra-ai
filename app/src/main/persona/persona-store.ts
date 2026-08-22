import { app, ipcMain } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

/**
 * Step 7: disk persistence for persona data.
 *
 * veyra-persona.json lives under app.getPath('userData') (outside the repo).
 * All fields are plaintext JSON (approach decision 3: resume/JD/notes are not
 * secret-tier like apiKey, so no safeStorage encryption).
 *
 * Mirrors settings-store.ts shape: load() / save() + isPersonaData() trust
 * boundary + registerIpcHandlers() for persona:load / persona:save.
 */

const PERSONA_FILE = 'veyra-persona.json'
const SAVE_CHANNEL = 'persona:save'
const LOAD_CHANNEL = 'persona:load'

export interface PersonaDoc {
  fileName: string
  text: string
}

export interface PersonaData {
  resumeText: string
  resumeFileName: string | null
  jobDescription: string
  notes: string
  additionalDocs: PersonaDoc[]
}

export const defaultPersona: PersonaData = {
  resumeText: '',
  resumeFileName: null,
  jobDescription: '',
  notes: '',
  additionalDocs: []
}

function isPersonaDoc(value: unknown): value is PersonaDoc {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v['fileName'] === 'string' && typeof v['text'] === 'string'
}

/** Trust-boundary shape check for PersonaData. */
export function isPersonaData(value: unknown): value is PersonaData {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v['resumeText'] !== 'string') return false
  if (!(typeof v['resumeFileName'] === 'string' || v['resumeFileName'] === null)) return false
  if (typeof v['jobDescription'] !== 'string') return false
  if (typeof v['notes'] !== 'string') return false
  if (!Array.isArray(v['additionalDocs'])) return false
  for (const doc of v['additionalDocs']) {
    if (!isPersonaDoc(doc)) return false
  }
  return true
}

function personaPath(): string {
  return join(app.getPath('userData'), PERSONA_FILE)
}

/** Read persona data from disk; missing/corrupt/invalid file -> defaults. */
export function load(): PersonaData {
  try {
    const raw = readFileSync(personaPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!isPersonaData(parsed)) {
      return { ...defaultPersona, additionalDocs: [] }
    }
    // Return a deep-ish copy so caller mutations don't alias the file state
    return {
      resumeText: parsed.resumeText,
      resumeFileName: parsed.resumeFileName,
      jobDescription: parsed.jobDescription,
      notes: parsed.notes,
      additionalDocs: parsed.additionalDocs.map((d) => ({ fileName: d.fileName, text: d.text }))
    }
  } catch {
    // First run (no file) or corrupt JSON: fall back to defaults, never crash.
    return { ...defaultPersona, additionalDocs: [] }
  }
}

/** Validate and write veyra-persona.json (plaintext). Returns the saved data. */
export function save(data: PersonaData): PersonaData {
  if (!isPersonaData(data)) {
    throw new Error('persona:save payload failed validation')
  }
  const payload: PersonaData = {
    resumeText: data.resumeText,
    jobDescription: data.jobDescription,
    notes: data.notes,
    resumeFileName: data.resumeFileName,
    additionalDocs: data.additionalDocs.map((d) => ({ fileName: d.fileName, text: d.text }))
  }
  const file = personaPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8')
  return data
}

/** Register the persona:save / persona:load IPC handlers. Call once from main index. */
export function registerIpcHandlers(): void {
  ipcMain.handle(SAVE_CHANNEL, (_event, payload: unknown): PersonaData =>
    save(payload as PersonaData)
  )
  ipcMain.handle(LOAD_CHANNEL, (): PersonaData => load())
}
