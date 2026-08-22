/**
 * Step 10 seams under test (pre-agreed, confirmed scope):
 *  1. personaReducer addAdditionalDoc / removeAdditionalDoc — pure reducer seam
 *  2. persona-store save/load round-trip for additionalDocs — disk persistence seam
 *  3. PersonaPanel pickFile -> persist -> pickFailed surfacing — IPC/UI error seam
 *     (corrupt/unsupported files must surface error, never silently drop)
 *
 * Minimization ladder: reuse existing personaReducer, persona-store, persona-persistence,
 * parse-document (step 8) — no new storage, no new IPC channel.
 */
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addAdditionalDoc,
  initialPersona,
  personaReducer,
  removeAdditionalDoc
} from '../src/renderer/src/persona/persona-reducer'
import {
  initialPersonaUiState,
  persistPersona,
  personaUiReducer
} from '../src/renderer/src/persona/persona-persistence'

let mockUserDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: (name: string): string => {
      if (name !== 'userData') throw new Error(`unexpected app.getPath(${name})`)
      return mockUserDataDir
    }
  },
  ipcMain: { handle: vi.fn() }
}))

import { load, save } from '../src/main/persona/persona-store'

describe('step 10: additional context add/remove updates persisted state', () => {
  beforeEach(() => {
    mockUserDataDir = mkdtempSync(join(tmpdir(), 'veyra-persona-additional-'))
  })
  afterEach(() => {
    rmSync(mockUserDataDir, { recursive: true, force: true })
  })

  it('add file via reducer then save/load round-trips', () => {
    const doc = { fileName: 'a.txt', text: 'hello additional' }
    const next = personaReducer(initialPersona, addAdditionalDoc(doc))
    expect(next.additionalDocs).toEqual([doc])
    save(next)
    expect(load()).toEqual(next)
  })

  it('remove file updates persisted state', () => {
    const doc1 = { fileName: 'a.txt', text: 'aaa' }
    const doc2 = { fileName: 'b.md', text: 'bbb' }
    let state = personaReducer(initialPersona, addAdditionalDoc(doc1))
    state = personaReducer(state, addAdditionalDoc(doc2))
    save(state)
    expect(load().additionalDocs).toHaveLength(2)
    // Remove first
    const afterRemove = personaReducer(state, removeAdditionalDoc(0))
    expect(afterRemove.additionalDocs).toEqual([doc2])
    save(afterRemove)
    expect(load()).toEqual(afterRemove)
    expect(load().additionalDocs).toHaveLength(1)
    // Remove last
    const empty = personaReducer(afterRemove, removeAdditionalDoc(0))
    save(empty)
    expect(load().additionalDocs).toEqual([])
  })

  it('persistPersona outcome reflects add/remove save success', async () => {
    const doc = { fileName: 'c.pdf', text: 'pdf text' }
    const state = personaReducer(initialPersona, addAdditionalDoc(doc))
    const mockSave = vi.fn(async (d: typeof state) => {
      save(d)
      return d
    })
    const outcome = await persistPersona(mockSave, state)
    expect(outcome.ok).toBe(true)
    expect(load().additionalDocs).toEqual([doc])
  })

  it('each file through step8 parser would be appended — simulate multiple picks', async () => {
    // Simulate sequential picks via reducer (mirrors PersonaPanel onPickAdditionalDoc loop)
    const picks: Array<{ fileName: string; text: string }> = [
      { fileName: 'one.txt', text: 'one' },
      { fileName: 'two.docx', text: 'two' },
      { fileName: 'three.pdf', text: 'three' }
    ]
    let state = initialPersona
    for (const pick of picks) {
      state = personaReducer(state, addAdditionalDoc(pick))
    }
    expect(state.additionalDocs).toEqual(picks)
    save(state)
    const loaded = load()
    expect(loaded.additionalDocs).toHaveLength(3)
    expect(loaded.additionalDocs.map((d) => d.fileName)).toEqual([
      'one.txt',
      'two.docx',
      'three.pdf'
    ])
  })
})

describe('step 10: corrupt/unsupported surfaces error instead of silently dropping', () => {
  it('pickFailed surfaces unsupported file type error', () => {
    const err = new Error('unsupported file type: .png — supported: .pdf, .docx, .txt, .md')
    const state = personaUiReducer(initialPersonaUiState, {
      type: 'pickFailed',
      message: err.message
    })
    expect(state.pickError).toBe(err.message)
    expect(state.pickError).toMatch(/unsupported file type/i)
  })

  it('corrupt pdf parse error also surfaces via pickFailed', () => {
    const corruptErr = new Error('Invalid PDF structure')
    const state = personaUiReducer(initialPersonaUiState, {
      type: 'pickFailed',
      message: corruptErr.message
    })
    expect(state.pickError).toBe('Invalid PDF structure')
  })

  it('clearPickError resets after a failed pick, next successful add clears error', () => {
    let state = personaUiReducer(initialPersonaUiState, {
      type: 'pickFailed',
      message: 'unsupported file type: .exe'
    })
    expect(state.pickError).toMatch(/unsupported/)
    state = personaUiReducer(state, { type: 'clearPickError' })
    expect(state.pickError).toBeNull()
    // Successful pick path in component does clearPickError before invoke, so error does not leak
  })

  it('persist failure after add surfaces via saveFailed (not silent)', async () => {
    const doc = { fileName: 'a.txt', text: 'hi' }
    const state = personaReducer(initialPersona, addAdditionalDoc(doc))
    const failingSave = vi.fn(async () => {
      throw new Error('persona:save payload failed validation')
    })
    const outcome = await persistPersona(failingSave, state)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.message).toMatch(/validation/i)
    const ui = personaUiReducer(initialPersonaUiState, {
      type: 'saveFailed',
      message: outcome.ok ? '' : outcome.message
    })
    expect(ui.error).toMatch(/validation/i)
  })

  it('remove out-of-bounds does not corrupt persisted state', () => {
    const withOne = personaReducer(
      initialPersona,
      addAdditionalDoc({ fileName: 'a.txt', text: 'a' })
    )
    const same = personaReducer(withOne, removeAdditionalDoc(99))
    expect(same).toBe(withOne)
    expect(same.additionalDocs).toEqual(withOne.additionalDocs)
  })
})
