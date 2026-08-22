/**
 * Plan step 16(b): transcript copy support.
 *
 * body-level user-select:none made the transcript unselectable; copying a
 * suggested answer is this product's core action. The CSS now leaves text
 * selectable; these helpers give the panel an explicit one-click Copy.
 */

/** Clipboard-ready text: committed finals only, speaker-prefixed, trimmed. */
export function transcriptToText(lines: TranscriptLineForCopy[]): string {
  return lines
    .filter((l) => l.kind === 'final')
    .map((l) => {
      const text = l.text.trim()
      return l.speaker !== 'unknown' && l.speaker !== undefined ? `${l.speaker}: ${text}` : text
    })
    .filter((text) => text !== '')
    .join('\n')
}

interface TranscriptLineForCopy {
  kind: 'partial' | 'final'
  speaker?: 'me' | 'other' | 'unknown'
  text: string
}

interface MinimalDocument {
  createElement(tagName: string): {
    value: string
    style: Record<string, string>
    setAttribute(name: string, value: string): void
    select(): void
    remove(): void
  }
  body: { appendChild(node: unknown): unknown }
  execCommand(commandId: string): boolean
}

function minimalDocument(): MinimalDocument | null {
  const doc = typeof document !== 'undefined' ? document : null
  if (!doc || typeof doc.createElement !== 'function' || !doc.body) return null
  return doc as unknown as MinimalDocument
}

/**
 * Generic copy for suggestion/answer text (phase 3 step 16 — AnswerPanel
 * Ready's Copy button). Reuses the same clipboard + legacy fallback pipeline
 * as copyTranscript but without transcript-specific filtering.
 */
export async function copyText(text: string): Promise<boolean> {
  return copyTranscript(text)
}

/**
 * Write text to the clipboard; resolves false (never throws) when the async
 * clipboard API is unavailable/refused or the legacy textarea fallback fails.
 */
export async function copyTranscript(text: string): Promise<boolean> {
  if (text === '') return false
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Permission refused / document unfocused: fall through to legacy path.
  }
  const doc = minimalDocument()
  if (!doc || typeof doc.execCommand !== 'function') return false
  try {
    const ta = doc.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style['position'] = 'fixed'
    ta.style['opacity'] = '0'
    doc.body.appendChild(ta)
    ta.select()
    const ok = doc.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}
