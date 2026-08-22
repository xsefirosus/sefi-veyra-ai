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

export const initialPersona: PersonaData = {
  resumeText: '',
  resumeFileName: null,
  jobDescription: '',
  notes: '',
  additionalDocs: []
}

export type PersonaAction =
  | { type: 'setResume'; resumeText: string; resumeFileName: string | null }
  | { type: 'setJobDescription'; jobDescription: string }
  | { type: 'setNotes'; notes: string }
  | { type: 'hydrate'; data: PersonaData }

export function setResume(resumeText: string, resumeFileName: string | null): PersonaAction {
  return { type: 'setResume', resumeText, resumeFileName }
}

export function setJobDescription(jobDescription: string): PersonaAction {
  return { type: 'setJobDescription', jobDescription }
}

export function setNotes(notes: string): PersonaAction {
  return { type: 'setNotes', notes }
}

export function hydratePersona(data: PersonaData): PersonaAction {
  return { type: 'hydrate', data }
}

export function personaReducer(state: PersonaData, action: PersonaAction): PersonaData {
  switch (action.type) {
    case 'setResume':
      return { ...state, resumeText: action.resumeText, resumeFileName: action.resumeFileName }
    case 'setJobDescription':
      return { ...state, jobDescription: action.jobDescription }
    case 'setNotes':
      return { ...state, notes: action.notes }
    case 'hydrate':
      return { ...state, ...action.data, additionalDocs: [...(action.data.additionalDocs ?? [])] }
    default:
      return state
  }
}
