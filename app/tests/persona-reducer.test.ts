import { describe, expect, it } from 'vitest'
import {
  hydratePersona,
  initialPersona,
  personaReducer,
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
})
