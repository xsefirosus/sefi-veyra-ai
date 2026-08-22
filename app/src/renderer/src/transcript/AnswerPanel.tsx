/**
 * AnswerPanel (phase 3 step 16): growing overlay UI.
 *
 * Renders answer-reducer state through THREE visible states plus stealth
 * as a cross-cutting fourth mode (spec: step 14's minimal wash).
 *
 * - Listening: no active suggestion (idle) — shows the transcript tail from
 *   step 6 (3 most recent lines) so the overlay is never empty while quiet.
 * - Generating: status === 'streaming' — partial delta text in the same glass
 *   card, card height grows via CSS height/min-height transition keyed to
 *   content length (not a hardcoded per-state jump), plus the drafting
 *   micro-copy ("Drafting suggestion…").
 * - Ready: status === 'complete' — full suggestion text with Copy (primary
 *   red accent) + Regenerate (secondary outline red per step 4) buttons.
 *   Text is selectable; Copy uses the same clipboard pipeline as transcript.
 * - Stealth (any mode): faint oklch(100% 0 0 / 0.22) wash, no icons/labels/
 *   buttons/micro-copy, just the text at 0.7 opacity — per step 14's state 4.
 *
 * Card height continuity: the card carries `.overlay-card--answer` which
 * applies `interpolate-size: allow-keywords` + `transition: min-height 280ms,
 * height 280ms, padding 220ms` so delta-by-delta growth reads as continuous,
 * not a 3-step jump. The same class is appended by getAnswerPanelView, so the
 * transition applies in every non-stealth mode; stealth keeps the same
 * dimension transition but with the minimal wash.
 */

import { useState } from 'react'
import type { TranscriptLine } from './transcript-reducer'
import type { SessionStatus } from '../session/session-status'
import { overlayEmptyLabel } from '../session/session-status'
import { copyText } from './transcript-copy'
import { getAnswerPanelView, type AnswerPanelView } from './answer-panel-view'
import { type StealthTheme } from './stealth-variant'
import type { AnswerState } from './answer-reducer'

const OVERLAY_TAIL = 3

function SpeakerTag({ speaker }: { speaker: TranscriptLine['speaker'] }): React.JSX.Element | null {
  if (speaker === 'unknown') return null
  return <span className="transcript-speaker">{speaker}</span>
}

export interface AnswerPanelProps {
  answer: AnswerState
  lines: TranscriptLine[]
  sessionStatus?: SessionStatus
  stealthMode?: boolean
  theme?: StealthTheme
  onRegenerate?: () => void
}

function AnswerPanel({
  answer,
  lines,
  sessionStatus,
  stealthMode = false,
  theme = 'light',
  onRegenerate
}: AnswerPanelProps): React.JSX.Element {
  const tail = lines.slice(-OVERLAY_TAIL)
  const emptyText = sessionStatus
    ? overlayEmptyLabel(sessionStatus)
    : 'Idle — press Start listening'
  const isError = sessionStatus?.state === 'error'
  const view: AnswerPanelView = getAnswerPanelView({
    answer,
    hasTranscriptTail: tail.length > 0,
    stealthMode,
    theme: theme === 'dark' ? 'dark' : 'light'
  })
  const showChrome = view.showChrome

  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const handleCopy = (): void => {
    const text = view.text
    if (!text) return
    void copyText(text).then((ok) => {
      setCopyState(ok ? 'copied' : 'failed')
      setTimeout(() => setCopyState('idle'), 2000)
    })
  }

  // Listening — no active suggestion: render transcript tail (step 6 glass)
  if (view.mode === 'listening') {
    return (
      <div className="overlay-screen" role="status" aria-live="polite">
        <div className={view.cardClassName}>
          {tail.length === 0 ? (
            <p className={`overlay-empty ${isError ? 'overlay-empty--error' : ''}`}>{emptyText}</p>
          ) : (
            tail.map((l) => (
              <p key={l.segmentId} className={`overlay-line ${l.kind}`}>
                {showChrome ? <SpeakerTag speaker={l.speaker} /> : null}
                {l.text}
              </p>
            ))
          )}
        </div>
      </div>
    )
  }

  // Generating / Ready — suggestion states (growing card + hint / buttons)
  return (
    <div className="overlay-screen" role="status" aria-live="polite">
      <div className={view.cardClassName}>
        {/* Micro-copy (Generating only, hidden in stealth) */}
        {view.showHint && view.hint ? (
          <p className="answer-hint" aria-live="polite">
            {view.hint}
          </p>
        ) : null}
        {/* Suggestion text — selectable, wraps, grows the card continuously */}
        <p
          className={`answer-text ${answer.status === 'complete' ? 'answer-text--ready' : 'answer-text--generating'}`}
        >
          {view.text}
        </p>
        {/* Ready actions — red accent per step 4, hidden in stealth */}
        {view.mode === 'ready' && view.showCopy ? (
          <div className="answer-actions">
            <button
              type="button"
              className="transcript-copy"
              onClick={handleCopy}
              aria-label="Copy suggestion"
            >
              Copy
            </button>
            <span className="transcript-copy-status" role="status" aria-live="polite">
              {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : ''}
            </span>
            <button
              type="button"
              className="transcript-copy transcript-copy--secondary"
              onClick={onRegenerate}
              aria-label="Regenerate suggestion"
            >
              Regenerate
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default AnswerPanel
