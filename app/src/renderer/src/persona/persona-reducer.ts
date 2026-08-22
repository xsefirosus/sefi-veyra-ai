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
  | { type: 'addAdditionalDoc'; doc: PersonaDoc }
  | { type: 'removeAdditionalDoc'; index: number }

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

export function addAdditionalDoc(doc: PersonaDoc): PersonaAction {
  return { type: 'addAdditionalDoc', doc }
}

export function removeAdditionalDoc(index: number): PersonaAction {
  return { type: 'removeAdditionalDoc', index }
}

export function personaReducer(state: PersonaData, action: PersonaAction): PersonaData {
  switch (action.type) {
    case 'setResume':
      return { ...state, resumeText: action.resumeText, resumeFileName: action.resumeFileName }
    case 'setJobDescription':
      return { ...state, jobDescription: action.jobDescription }
    case 'setNotes':
      return { ...state, notes: action.notes }
    case 'addAdditionalDoc':
      // Trust boundary: validate doc shape at reducer entry (defensive, mirrors store validation)
      if (
        !action.doc ||
        typeof action.doc.fileName !== 'string' ||
        typeof action.doc.text !== 'string'
      ) {
        return state
      }
      return {
        ...state,
        additionalDocs: [
          ...state.additionalDocs,
          { fileName: action.doc.fileName, text: action.doc.text }
        ]
      }
    case 'removeAdditionalDoc':
      if (
        !Number.isInteger(action.index) ||
        action.index < 0 ||
        action.index >= state.additionalDocs.length
      ) {
        return state
      }
      return { ...state, additionalDocs: state.additionalDocs.filter((_, i) => i !== action.index) }
    case 'hydrate':
      return { ...state, ...action.data, additionalDocs: [...(action.data.additionalDocs ?? [])] }
    default:
      return state
  }
}
