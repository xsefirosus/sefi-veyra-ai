import { describe, expect, it } from 'vitest'
import { toPersonaContext } from '../src/shared/llm/persona-context'
import type { PersonaData } from '../src/main/persona/persona-store'
import type { PersonaContext } from '../src/shared/types'

const fixture: PersonaData = {
  resumeText: 'Jane Doe — Senior Engineer\n10 years experience',
  resumeFileName: 'jane-resume.pdf',
  jobDescription: 'Staff Engineer role at Acme Corp',
  notes: 'Prefers concise answers',
  additionalDocs: [
    { fileName: 'cover-letter.txt', text: 'Dear hiring manager...' },
    { fileName: 'notes.md', text: '# Talking points\n- leadership' }
  ]
}

describe('persona-context assembly (step 11)', () => {
  it('maps fixture PersonaData to PersonaContext shape', () => {
    const ctx: PersonaContext = toPersonaContext(fixture)
    expect(ctx).toEqual({
      resume: 'Jane Doe — Senior Engineer\n10 years experience',
      jobDescription: 'Staff Engineer role at Acme Corp',
      notes: ['Prefers concise answers'],
      docs: ['Dear hiring manager...', '# Talking points\n- leadership']
    })
  })

  it('omits resume when resumeText is empty or whitespace', () => {
    const empty: PersonaData = { ...fixture, resumeText: '   ', additionalDocs: [] }
    const ctx = toPersonaContext({ ...empty, resumeText: '', jobDescription: '', notes: '' })
    expect(ctx.resume).toBeUndefined()
    expect(ctx.jobDescription).toBeUndefined()
    expect(ctx.notes).toBeUndefined()
    expect(ctx.docs).toBeUndefined()
    expect(ctx).toEqual({})
  })

  it('trims resume and jobDescription and does not forward resumeFileName', () => {
    const data: PersonaData = {
      ...fixture,
      resumeText: '  hello  ',
      resumeFileName: 'should-not-appear.pdf',
      jobDescription: '\n Staff \n',
      notes: '',
      additionalDocs: []
    }
    const ctx = toPersonaContext(data)
    expect(ctx.resume).toBe('hello')
    expect(ctx.jobDescription).toBe('Staff')
    // resumeFileName never appears in PersonaContext
    expect((ctx as Record<string, unknown>)['resumeFileName']).toBeUndefined()
  })

  it('maps notes as a one-element array (documented choice, not split on blank lines)', () => {
    const data: PersonaData = {
      ...fixture,
      notes: 'line one\n\nline two\n\nline three',
      additionalDocs: []
    }
    const ctx = toPersonaContext(data)
    // Choice: single element preserving blank lines verbatim
    expect(ctx.notes).toEqual(['line one\n\nline two\n\nline three'])
    expect(ctx.notes).toHaveLength(1)
  })

  it('omits notes when empty or whitespace-only', () => {
    const ctx = toPersonaContext({ ...fixture, notes: '   \n  ' })
    expect(ctx.notes).toBeUndefined()
  })

  it('maps additionalDocs text to docs, dropping empty entries', () => {
    const data: PersonaData = {
      ...fixture,
      additionalDocs: [
        { fileName: 'a.txt', text: '  keep  ' },
        { fileName: 'empty.txt', text: '   ' },
        { fileName: 'b.txt', text: '\n\n  also keep\n' }
      ]
    }
    const ctx = toPersonaContext(data)
    expect(ctx.docs).toEqual(['keep', 'also keep'])
  })

  it('omits docs when additionalDocs is empty or all entries blank', () => {
    expect(toPersonaContext({ ...fixture, additionalDocs: [] }).docs).toBeUndefined()
    expect(
      toPersonaContext({
        ...fixture,
        additionalDocs: [{ fileName: 'x.txt', text: '   ' }]
      }).docs
    ).toBeUndefined()
  })

  it('does not mutate input data', () => {
    const data: PersonaData = {
      resumeText: '  r  ',
      resumeFileName: 'r.pdf',
      jobDescription: '  jd  ',
      notes: '  n  ',
      additionalDocs: [{ fileName: 'a.txt', text: '  t  ' }]
    }
    const copy = JSON.parse(JSON.stringify(data)) as PersonaData
    toPersonaContext(data)
    expect(data).toEqual(copy)
  })

  it('full empty PersonaData yields empty PersonaContext', () => {
    const empty: PersonaData = {
      resumeText: '',
      resumeFileName: null,
      jobDescription: '',
      notes: '',
      additionalDocs: []
    }
    expect(toPersonaContext(empty)).toEqual({})
  })
})
