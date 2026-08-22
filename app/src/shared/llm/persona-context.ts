/**
 * Phase 3 step 11 — PersonaContext assembly for Phase-4 consumption.
 *
 * Small pure function mapping PersonaData (step 7, persisted as
 * veyra-persona.json) to the existing PersonaContext type declared in
 * src/shared/types.ts (audit-01 step 17). NOT wired to any LLM call —
 * this only proves the real persona data can be shaped into the real
 * interface Phase 4 will consume.
 *
 * Seams under test (pre-agreed, confirmed before first test written):
 *  - `toPersonaContext(data: PersonaData): PersonaContext`
 *    Inputs: PersonaData { resumeText, resumeFileName, jobDescription,
 *            notes, additionalDocs: Array<{fileName,text}> }
 *    Outputs: PersonaContext { resume?, jobDescription?, notes?, docs? }
 *    No I/O, no IPC, no Electron dependency — pure mapping.
 *    Scope: this file only; no LLM call, no storage, no UI.
 *
 * Notes mapping — DOCUMENTED CHOICE:
 *  `PersonaData.notes` is a single free-form string (one textarea in the
 *  settings UI). `PersonaContext.notes` is string[] (one entry per note).
 *  Two plausible mappings: (a) wrap as a one-element array, (b) split on
 *  blank lines into multiple entries. This implementation chooses (a):
 *  notes is mapped to a single-element array `[trimmedNotes]` when
 *  trimmed notes is non-empty, otherwise omitted (undefined). Rationale:
 *  deterministic, preserves author-intended paragraph breaks inside the
 *  single string without fragmenting on incidental blank lines, and the
 *  LLM prompt can still render it as one block. Splitting on
 *  `/\r?\n\s*\r?\n/` would be the upgrade path if Phase 4 wants per-note
 *  bullet handling — sefi: ceiling=single-element, upgrade=split-on-blank-lines.
 *
 * Other mappings:
 *  - resume: PersonaData.resumeText (trimmed) -> PersonaContext.resume
 *    Omitted when empty/whitespace-only; resumeFileName is not forwarded
 *    (display-only, not LLM context).
 *  - jobDescription: trimmed, omitted when empty.
 *  - docs: additionalDocs[].text (each trimmed, empty entries dropped) ->
 *    PersonaContext.docs. Omitted when resulting array is empty.
 *    Empty-text docs are dropped so a failed parse that produced "" does
 *    not pollute the prompt.
 */

import type { PersonaContext } from '../types'
import type { PersonaData } from '../../main/persona/persona-store'

function trimmedOrUndefined(value: string): string | undefined {
  const t = value.trim()
  return t.length > 0 ? t : undefined
}

export function toPersonaContext(data: PersonaData): PersonaContext {
  const ctx: PersonaContext = {}

  const resume = trimmedOrUndefined(data.resumeText)
  if (resume !== undefined) ctx.resume = resume

  const jd = trimmedOrUndefined(data.jobDescription)
  if (jd !== undefined) ctx.jobDescription = jd

  const notesTrimmed = data.notes.trim()
  if (notesTrimmed.length > 0) {
    // Single-element array — see module doc for split-on-blank-lines alternative.
    ctx.notes = [notesTrimmed]
  }

  if (Array.isArray(data.additionalDocs) && data.additionalDocs.length > 0) {
    const docs = data.additionalDocs
      .map((d) => d.text.trim())
      .filter((t) => t.length > 0)
    if (docs.length > 0) ctx.docs = docs
  }

  return ctx
}
