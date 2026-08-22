import { describe, expect, it } from 'vitest'
import {
  addAdditionalDoc,
  hydratePersona,
  initialPersona,
  personaReducer,
  removeAdditionalDoc,
  setJobDescription,
  setNotes,
  setResume
} from '../src/renderer/src/persona/persona-reducer'

describe('persona-reducer', () => {
  it('has the documented default state', () => {
    expect(initialPersona).toEqual({
      resumeText: '',
      resumeFileName: null,
      jobDescription: '',
      notes: '',
      additionalDocs: []
    })
  })

  it('setResume replaces resumeText and resumeFileName', () => {
    const next = personaReducer(initialPersona, setResume('hello', 'cv.pdf'))
    expect(next.resumeText).toBe('hello')
    expect(next.resumeFileName).toBe('cv.pdf')
    expect(next.jobDescription).toBe('')
  })

  it('setResume accepts null filename (clear)', () => {
    const withResume = personaReducer(initialPersona, setResume('a', 'a.pdf'))
    const cleared = personaReducer(withResume, setResume('', null))
    expect(cleared.resumeFileName).toBeNull()
    expect(cleared.resumeText).toBe('')
  })

  it('setJobDescription replaces jobDescription', () => {
    const next = personaReducer(initialPersona, setJobDescription('Staff Engineer'))
    expect(next.jobDescription).toBe('Staff Engineer')
    expect(next.resumeText).toBe('')
  })

  it('setNotes replaces notes', () => {
    const next = personaReducer(initialPersona, setNotes('prefers concise'))
    expect(next.notes).toBe('prefers concise')
  })

  it('hydrate merges persisted data including additionalDocs', () => {
    const persisted = {
      resumeText: 'Jane — senior',
      resumeFileName: 'jane.pdf',
      jobDescription: 'Staff at Acme',
      notes: 'notes here',
      additionalDocs: [{ fileName: 'a.txt', text: 'hi' }]
    }
    const next = personaReducer(initialPersona, hydratePersona(persisted))
    expect(next).toEqual(persisted)
  })

  it('unknown action returns state unchanged', () => {
    const next = personaReducer(initialPersona, { type: 'nope' } as never)
    expect(next).toBe(initialPersona)
  })

  it('addAdditionalDoc appends to additionalDocs', () => {
    const doc = { fileName: 'cover.txt', text: 'hello' }
    const next = personaReducer(initialPersona, addAdditionalDoc(doc))
    expect(next.additionalDocs).toEqual([doc])
    // Second add appends, preserving order and existing docs
    const doc2 = { fileName: 'notes.md', text: '# hi' }
    const next2 = personaReducer(next, addAdditionalDoc(doc2))
    expect(next2.additionalDocs).toEqual([doc, doc2])
  })

  it('addAdditionalDoc rejects malformed doc at trust boundary (no state change)', () => {
    const bad = { fileName: 123, text: 'hi' } as unknown as { fileName: string; text: string }
    const next = personaReducer(initialPersona, addAdditionalDoc(bad))
    expect(next).toBe(initialPersona)
    expect(next.additionalDocs).toEqual([])
  })

  it('removeAdditionalDoc removes by index', () => {
    const withDocs = personaReducer(
      initialPersona,
      addAdditionalDoc({ fileName: 'a.txt', text: 'a' })
    )
    const withTwo = personaReducer(withDocs, addAdditionalDoc({ fileName: 'b.txt', text: 'b' }))
    expect(withTwo.additionalDocs).toHaveLength(2)
    const afterRemoveFirst = personaReducer(withTwo, removeAdditionalDoc(0))
    expect(afterRemoveFirst.additionalDocs).toEqual([{ fileName: 'b.txt', text: 'b' }])
    const afterRemoveLast = personaReducer(afterRemoveFirst, removeAdditionalDoc(0))
    expect(afterRemoveLast.additionalDocs).toEqual([])
  })

  it('removeAdditionalDoc ignores out-of-bounds index (no state change)', () => {
    const withOne = personaReducer(
      initialPersona,
      addAdditionalDoc({ fileName: 'a.txt', text: 'a' })
    )
    const same = personaReducer(withOne, removeAdditionalDoc(5))
    expect(same).toBe(withOne)
    const sameNeg = personaReducer(withOne, removeAdditionalDoc(-1))
    expect(sameNeg).toBe(withOne)
  })

  it('hydrate replaces additionalDocs, not merges', () => {
    const withOne = personaReducer(
      initialPersona,
      addAdditionalDoc({ fileName: 'a.txt', text: 'a' })
    )
    const hydrated = personaReducer(
      withOne,
      hydratePersona({ ...initialPersona, additionalDocs: [{ fileName: 'b.txt', text: 'b' }] })
    )
    expect(hydrated.additionalDocs).toEqual([{ fileName: 'b.txt', text: 'b' }])
  })
})
