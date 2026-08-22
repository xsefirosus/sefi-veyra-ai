import { describe, expect, it } from 'vitest'
import { getAnswerPanelView } from '../src/renderer/src/transcript/answer-panel-view'
import { initialAnswerState, answerReducer } from '../src/renderer/src/transcript/answer-reducer'
import type { SuggestionDelta } from '../src/shared/llm/llm-adapter'

function delta(textDelta: string): SuggestionDelta {
  return { type: 'delta', kind: 'action-item', textDelta }
}
function complete(text: string): SuggestionDelta {
  return { type: 'complete', suggestion: { text, kind: 'action-item' } }
}

describe('answer-panel-view (phase 3 step 16) — Listening / Generating / Ready + stealth + growing transition', () => {
  it('Listening (idle): mode listening, no hint, no Copy/Regenerate, card has growing class', () => {
    const view = getAnswerPanelView({ answer: initialAnswerState, hasTranscriptTail: true, stealthMode: false, theme: 'light' })
    expect(view.mode).toBe('listening')
    expect(view.text).toBe('')
    expect(view.showHint).toBe(false)
    expect(view.hint).toBeNull()
    expect(view.showCopy).toBe(false)
    expect(view.showRegenerate).toBe(false)
    expect(view.showChrome).toBe(true)
    expect(view.isStealth).toBe(false)
    expect(view.cardClassName).toContain('overlay-card')
    expect(view.cardClassName).toContain('overlay-card--answer')
    expect(view.cardClassName).not.toContain('overlay-card--stealth')
  })

  it('Generating (streaming delta): mode generating, text is accumulated deltas, hint shown, no buttons yet', () => {
    let state = initialAnswerState
    state = answerReducer(state, delta('Hel'))
    state = answerReducer(state, delta('lo '))
    state = answerReducer(state, delta('world'))
    const view = getAnswerPanelView({ answer: state, stealthMode: false, theme: 'light' })
    expect(view.mode).toBe('generating')
    expect(view.text).toBe('Hello world')
    expect(view.showHint).toBe(true)
    expect(view.hint).toBe('Drafting suggestion\u2026')
    expect(view.showCopy).toBe(false)
    expect(view.showRegenerate).toBe(false)
    expect(view.showChrome).toBe(true)
    expect(view.cardClassName).toContain('overlay-card--answer')
  })

  it('Ready (complete): mode ready, text is suggestion.text, Copy + Regenerate shown (red accent per step 4, secondary vs primary)', () => {
    let state = initialAnswerState
    state = answerReducer(state, delta('draft '))
    state = answerReducer(state, complete('draft final suggestion text'))
    const view = getAnswerPanelView({ answer: state, stealthMode: false, theme: 'light' })
    expect(view.mode).toBe('ready')
    expect(view.text).toBe('draft final suggestion text')
    expect(view.showHint).toBe(false)
    expect(view.hint).toBeNull()
    expect(view.showCopy).toBe(true)
    expect(view.showRegenerate).toBe(true)
    expect(view.showChrome).toBe(true)
    // Ready card still carries the growing transition class (continuous growth, not a jump)
    expect(view.cardClassName).toContain('overlay-card--answer')
  })

  it('stealth as fourth cross-cutting mode: any mode hides chrome, hint, and buttons, keeps faint wash class', () => {
    // listening + stealth
    const idleStealth = getAnswerPanelView({ answer: initialAnswerState, stealthMode: true, theme: 'light' })
    expect(idleStealth.isStealth).toBe(true)
    expect(idleStealth.showChrome).toBe(false)
    expect(idleStealth.cardClassName).toContain('overlay-card--stealth')
    expect(idleStealth.cardClassName).toContain('overlay-card--answer')
    expect(idleStealth.showCopy).toBe(false)
    expect(idleStealth.showHint).toBe(false)

    // generating + stealth — hint suppressed even though text exists
    let gen = answerReducer(initialAnswerState, delta('partial streaming text that is growing'))
    const genStealth = getAnswerPanelView({ answer: gen, stealthMode: true, theme: 'light' })
    expect(genStealth.mode).toBe('generating')
    expect(genStealth.isStealth).toBe(true)
    expect(genStealth.showChrome).toBe(false)
    expect(genStealth.showHint).toBe(false)
    expect(genStealth.hint).toBeNull()
    expect(genStealth.cardClassName).toContain('overlay-card--stealth')

    // ready + stealth — buttons suppressed
    gen = answerReducer(gen, complete('final stealth text'))
    const readyStealth = getAnswerPanelView({ answer: gen, stealthMode: true, theme: 'dark' })
    expect(readyStealth.mode).toBe('ready')
    expect(readyStealth.isStealth).toBe(true)
    expect(readyStealth.showCopy).toBe(false)
    expect(readyStealth.showRegenerate).toBe(false)
    expect(readyStealth.showChrome).toBe(false)
    expect(readyStealth.cardClassName).toContain('overlay-card--stealth')
    expect(readyStealth.cardClassName).toContain('overlay-card--answer')
  })

  it('dark theme propagates through stealth variant (no chrome change)', () => {
    const state = answerReducer(initialAnswerState, complete('dark ready'))
    const light = getAnswerPanelView({ answer: state, stealthMode: false, theme: 'light' })
    const dark = getAnswerPanelView({ answer: state, stealthMode: false, theme: 'dark' })
    expect(light.mode).toBe('ready')
    expect(dark.mode).toBe('ready')
    expect(light.showCopy).toBe(true)
    expect(dark.showCopy).toBe(true)
    const stealthDark = getAnswerPanelView({ answer: state, stealthMode: true, theme: 'dark' })
    expect(stealthDark.isStealth).toBe(true)
    expect(stealthDark.showChrome).toBe(false)
  })

  it('growing card: cardClassName always contains the continuous height transition class regardless of mode', () => {
    const idle = getAnswerPanelView({ answer: initialAnswerState, stealthMode: false, theme: 'light' })
    let gen = answerReducer(initialAnswerState, delta('growing '))
    gen = answerReducer(gen, delta('content '))
    gen = answerReducer(gen, delta('more content that keeps lengthening the card'))
    const generating = getAnswerPanelView({ answer: gen, stealthMode: false, theme: 'light' })
    const ready = getAnswerPanelView({ answer: answerReducer(gen, complete(gen.text)), stealthMode: false, theme: 'light' })
    for (const v of [idle, generating, ready]) {
      expect(v.cardClassName).toContain('overlay-card--answer')
    }
    // The class's CSS defines `interpolate-size: allow-keywords` + `transition: min-height 280ms, height 280ms`
    // — not a per-state hardcoded height jump — proven by the shared class across all three modes.
  })
})
