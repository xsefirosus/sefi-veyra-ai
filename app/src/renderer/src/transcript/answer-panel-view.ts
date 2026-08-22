/**
 * AnswerPanel view derivation (phase 3 step 16) — pure mapping.
 *
 * Seams under test (pre-agreed checkpoint, prior to first test):
 *  1. This pure function: AnswerState + transcript tail + stealth/theme -> view
 *     (Listening / Generating / Ready, plus stealth as cross-cutting fourth mode).
 *  2. CSS growing transition: `.overlay-card--answer` (height/min-height 280ms,
 *     interpolate-size: allow-keywords) — verified via build / class presence,
 *     not a per-state hardcoded height jump.
 *  3. AnswerPanel rendering of the view (micro-copy, buttons, chrome hiding).
 *  4. OverlayScreen wiring: useAnswer + useTranscript -> AnswerPanel via real
 *     SUGGESTION_EVENT_CHANNEL (SUGGESTION_EVENT_CHANNEL / answer-reducer).
 * No test is written at an unconfirmed seam.
 *
 * Card height grows continuously with content length via CSS
 * height/min-height transition on `.overlay-card--answer` (interpolate-size:
 * allow-keywords for height:auto in supporting browsers), not a hardcoded
 * per-state jump — so delta-by-delta streaming reads as a smooth growth.
 */

import { getStealthOverlayVariant, type StealthTheme } from './stealth-variant'
import type { AnswerState } from './answer-reducer'

export type AnswerPanelMode = 'listening' | 'generating' | 'ready'

export interface AnswerPanelView {
  /** Visible mode before stealth is applied. */
  mode: AnswerPanelMode
  /** Whether stealth minimal treatment is active (cross-cutting fourth mode). */
  isStealth: boolean
  /** Whether chrome (icons/labels/buttons, speaker tags) should be shown. Stealth => false. */
  showChrome: boolean
  /** CSS class(es) for the card element (includes stealth + growing-answer classes). */
  cardClassName: string
  /** Primary text to render: tail hint in listening, delta text in generating, suggestion in ready. */
  text: string
  /** Whether to show the drafting micro-copy (generating + not stealth + has text). */
  showHint: boolean
  /** Drafting micro-copy text when showHint is true. */
  hint: string | null
  /** Whether to show Copy / Regenerate buttons (ready + not stealth). */
  showCopy: boolean
  showRegenerate: boolean
  /** Underlying kind of the suggestion when known (`action-item`/`summary`/`question`). */
  kind: AnswerState['kind']
}

const DRAFT_HINT = 'Drafting suggestion\u2026'

/**
 * Derive the overlay AnswerPanel view from the answer reducer state,
 * transcript presence, and the stealth/theme chrome variant.
 *
 * Listening: no active suggestion (idle) — caller renders the transcript tail.
 * Generating: status === 'streaming' — partial delta text with hint, growing card.
 * Ready: status === 'complete' — final suggestion with Copy/Regenerate.
 * Stealth: cross-cutting — any mode, but chrome/buttons/hint hidden, faint wash.
 */
export function getAnswerPanelView(input: {
  answer: AnswerState
  hasTranscriptTail?: boolean
  stealthMode?: boolean
  theme?: StealthTheme
}): AnswerPanelView {
  const stealthMode = Boolean(input.stealthMode)
  const theme: StealthTheme = input.theme === 'dark' ? 'dark' : 'light'
  const answer = input.answer
  const stealth = getStealthOverlayVariant({
    stealthMode,
    theme,
    hasContent: Boolean(answer.text) || Boolean(input.hasTranscriptTail)
  })

  let mode: AnswerPanelMode
  if (answer.status === 'complete' && answer.suggestion) {
    mode = 'ready'
  } else if (answer.status === 'streaming') {
    mode = 'generating'
  } else {
    mode = 'listening'
  }

  const isStealth = stealth.isStealth
  const showChrome = stealth.showChrome

  // Base card is the glass card from step 6; add the growing-answer class so
  // the continuous height transition applies regardless of mode.
  const baseCardClass = stealth.cardClassName
  const cardClassName = baseCardClass.includes('overlay-card--answer')
    ? baseCardClass
    : `${baseCardClass} overlay-card--answer`

  const text = mode === 'listening' ? '' : answer.text

  const showHint = mode === 'generating' && !isStealth && text.length > 0
  const hint = showHint ? DRAFT_HINT : null

  const showCopy = mode === 'ready' && !isStealth
  const showRegenerate = mode === 'ready' && !isStealth

  return {
    mode,
    isStealth,
    showChrome,
    cardClassName,
    text,
    showHint,
    hint,
    showCopy,
    showRegenerate,
    kind: answer.kind
  }
}
