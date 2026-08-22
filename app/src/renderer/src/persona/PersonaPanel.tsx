import { useEffect, useReducer } from 'react'
import {
  addAdditionalDoc,
  hydratePersona,
  initialPersona,
  personaReducer,
  removeAdditionalDoc,
  setJobDescription,
  setNotes,
  setResume
} from './persona-reducer'
import {
  applyLoadedPersona,
  initialPersonaUiState,
  persistPersona,
  personaUiReducer
} from './persona-persistence'
import type { PersonaData } from './persona-reducer'

/**
 * Step 9: Your background card — resume upload via window.api.pickFile → main
 * reads + parses via parse-document → persona:save, job description textarea,
 * notes input. Styled per canvas (border-radius:16px, padding:24px via
 * .persona-card), hydrate on mount mirroring audit-01 step 11.
 */

function UploadIconMini(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5" />
      <path d="M12 3v12" />
    </svg>
  )
}

function DocumentIconMini(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  )
}

export default function PersonaPanel(): React.JSX.Element {
  const [persona, dispatch] = useReducer(personaReducer, initialPersona)
  const [ui, dispatchUi] = useReducer(personaUiReducer, initialPersonaUiState)

  useEffect(() => {
    let cancelled = false
    const maybeApi = (window as unknown as { api?: Window['api'] }).api
    if (!maybeApi?.loadPersona) return
    void applyLoadedPersona(maybeApi.loadPersona, (loaded) => {
      if (cancelled) return
      dispatch(hydratePersona(loaded))
      dispatchUi({ type: 'hydrated' })
    })
    return () => {
      cancelled = true
    }
  }, [])

  const saveCurrent = (next: PersonaData): void => {
    const maybeApi = (window as unknown as { api?: Window['api'] }).api
    if (!maybeApi?.savePersona) return
    void persistPersona(maybeApi.savePersona, next).then((outcome) => {
      if (outcome.ok) dispatchUi({ type: 'saveOk' })
      else dispatchUi({ type: 'saveFailed', message: outcome.message })
    })
  }

  const onPickResume = (): void => {
    const maybeApi = (window as unknown as { api?: Window['api'] }).api
    if (!maybeApi?.pickFile) {
      dispatchUi({ type: 'pickFailed', message: 'File picker not available' })
      return
    }
    dispatchUi({ type: 'clearPickError' })
    void maybeApi
      .pickFile()
      .then((result) => {
        if (!result) return // cancelled
        const next: PersonaData = {
          ...persona,
          resumeText: result.text,
          resumeFileName: result.fileName
        }
        dispatch(setResume(result.text, result.fileName))
        dispatchUi({ type: 'edit' })
        saveCurrent(next)
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        dispatchUi({ type: 'pickFailed', message: msg })
      })
  }

  const onJobDescriptionChange = (value: string): void => {
    dispatch(setJobDescription(value))
    dispatchUi({ type: 'edit' })
    saveCurrent({ ...persona, jobDescription: value })
  }

  const onNotesChange = (value: string): void => {
    dispatch(setNotes(value))
    dispatchUi({ type: 'edit' })
    saveCurrent({ ...persona, notes: value })
  }

  const onPickAdditionalDoc = (): void => {
    const maybeApi = (window as unknown as { api?: Window['api'] }).api
    if (!maybeApi?.pickFile) {
      dispatchUi({ type: 'pickFailed', message: 'File picker not available' })
      return
    }
    dispatchUi({ type: 'clearPickError' })
    void maybeApi
      .pickFile()
      .then((result) => {
        if (!result) return // cancelled
        const doc = { fileName: result.fileName, text: result.text }
        const next: PersonaData = {
          ...persona,
          additionalDocs: [...persona.additionalDocs, doc]
        }
        dispatch(addAdditionalDoc(doc))
        dispatchUi({ type: 'edit' })
        saveCurrent(next)
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        dispatchUi({ type: 'pickFailed', message: msg })
      })
  }

  const onRemoveAdditionalDoc = (index: number): void => {
    const next: PersonaData = {
      ...persona,
      additionalDocs: persona.additionalDocs.filter((_, i) => i !== index)
    }
    dispatch(removeAdditionalDoc(index))
    dispatchUi({ type: 'edit' })
    saveCurrent(next)
  }

  return (
    <div className="persona-card persona-panel">
      <div className="persona-card-head">
        <span className="persona-card-icon" aria-hidden="true">
          <DocumentIconMini />
        </span>
        <span className="persona-card-title">Your background</span>
      </div>

      <div className="persona-field">
        <span className="persona-label">Resume</span>
        <div className="persona-resume-row">
          <span className="persona-resume-name" aria-live="polite">
            {persona.resumeFileName ?? 'No resume uploaded'}
          </span>
          <button type="button" className="persona-upload-btn" onClick={onPickResume}>
            <span aria-hidden="true">
              <UploadIconMini />
            </span>
            {persona.resumeFileName ? 'Replace' : 'Upload'}
          </button>
        </div>
        {persona.resumeText ? (
          <p className="persona-resume-preview" aria-label="Resume preview">
            {persona.resumeText.slice(0, 220)}
            {persona.resumeText.length > 220 ? '…' : ''}
          </p>
        ) : null}
        {ui.pickError ? (
          <p className="settings-error" role="alert">
            {ui.pickError}
          </p>
        ) : null}
      </div>

      <label className="persona-field">
        <span className="persona-label">Job description</span>
        <textarea
          value={persona.jobDescription}
          onChange={(e) => onJobDescriptionChange(e.target.value)}
          placeholder="Paste the job description"
          rows={4}
        />
      </label>

      <label className="persona-field">
        <span className="persona-label">Notes</span>
        <input
          type="text"
          value={persona.notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Anything else VEYRA should know"
        />
      </label>

      <div className="persona-field">
        <span className="persona-label">Additional context (optional)</span>
        {persona.additionalDocs.length > 0 ? (
          <ul className="persona-additional-list" aria-label="Additional context files">
            {persona.additionalDocs.map((doc, idx) => (
              <li key={`${doc.fileName}-${idx}`} className="persona-additional-item">
                <span className="persona-additional-name" title={doc.fileName}>
                  {doc.fileName}
                </span>
                <button
                  type="button"
                  className="persona-additional-remove"
                  aria-label={`Remove ${doc.fileName}`}
                  onClick={() => onRemoveAdditionalDoc(idx)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <button type="button" className="persona-add-file-btn" onClick={onPickAdditionalDoc}>
          <span aria-hidden="true">
            <UploadIconMini />
          </span>
          Add a file
        </button>
        {ui.pickError ? (
          <p className="settings-error" role="alert">
            {ui.pickError}
          </p>
        ) : null}
      </div>

      {ui.saved ? (
        <p className="settings-saved" role="status">
          Background saved
        </p>
      ) : null}
      {ui.error ? (
        <p className="settings-error" role="alert">
          {ui.error}
        </p>
      ) : null}
    </div>
  )
}
