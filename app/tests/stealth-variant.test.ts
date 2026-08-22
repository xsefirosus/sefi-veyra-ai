import { describe, expect, it } from 'vitest'
import {
  getStealthOverlayVariant,
  STEALTH_TEXT_DARK,
  STEALTH_TEXT_LIGHT,
  STEALTH_WASH,
  GLASS_BG_DARK,
  GLASS_BG_LIGHT
} from '../src/renderer/src/transcript/stealth-variant'

describe('stealth-variant (phase 3 step 14) — pure function mapping stealthMode/theme/content -> variant', () => {
  it('normal mode (stealth off, light) keeps full glass-card chrome', () => {
    const v = getStealthOverlayVariant({ stealthMode: false, theme: 'light', content: 'hello' })
    expect(v.isStealth).toBe(false)
    expect(v.showChrome).toBe(true)
    expect(v.cardClassName).toBe('overlay-card')
    expect(v.cardClassName).not.toContain('overlay-card--stealth')
    expect(v.background).toBe(GLASS_BG_LIGHT)
    expect(v.wash).toBe('')
  })

  it('normal mode (stealth off, dark) uses dark glass background', () => {
    const v = getStealthOverlayVariant({ stealthMode: false, theme: 'dark', hasContent: true })
    expect(v.isStealth).toBe(false)
    expect(v.showChrome).toBe(true)
    expect(v.background).toBe(GLASS_BG_DARK)
    expect(v.cardClassName).toBe('overlay-card')
  })

  it('stealth on, light: faint wash, reduced text at oklch(24% ... / 0.7), no chrome', () => {
    const v = getStealthOverlayVariant({
      stealthMode: true,
      theme: 'light',
      content: 'hello world'
    })
    expect(v.isStealth).toBe(true)
    expect(v.showChrome).toBe(false)
    expect(v.cardClassName).toBe('overlay-card overlay-card--stealth')
    expect(v.wash).toBe(STEALTH_WASH)
    expect(v.wash).toBe('oklch(100% 0 0 / 0.22)')
    expect(v.background).toBe(STEALTH_WASH)
    expect(v.textColor).toBe(STEALTH_TEXT_LIGHT)
    expect(v.textColor).toBe('oklch(24% 0.01 90 / 0.7)')
  })

  it('stealth on, dark: equivalent dark text, same faint wash', () => {
    const v = getStealthOverlayVariant({ stealthMode: true, theme: 'dark', content: 'hello' })
    expect(v.isStealth).toBe(true)
    expect(v.showChrome).toBe(false)
    expect(v.cardClassName).toContain('overlay-card--stealth')
    expect(v.background).toBe(STEALTH_WASH)
    expect(v.wash).toBe('oklch(100% 0 0 / 0.22)')
    expect(v.textColor).toBe(STEALTH_TEXT_DARK)
    expect(v.textColor).toBe('oklch(96% 0.005 90 / 0.7)')
  })

  it('mapping is stable regardless of content length (empty vs non-empty)', () => {
    const empty = getStealthOverlayVariant({ stealthMode: true, theme: 'light', content: '' })
    const filled = getStealthOverlayVariant({
      stealthMode: true,
      theme: 'light',
      content: 'some transcript tail'
    })
    const byFlagEmpty = getStealthOverlayVariant({
      stealthMode: true,
      theme: 'light',
      hasContent: false
    })
    const byFlagFull = getStealthOverlayVariant({
      stealthMode: true,
      theme: 'light',
      hasContent: true
    })
    // Stealth properties are identical irrespective of content presence
    expect(empty.isStealth).toBe(filled.isStealth)
    expect(empty.textColor).toBe(filled.textColor)
    expect(empty.background).toBe(filled.background)
    expect(empty.showChrome).toBe(filled.showChrome)
    expect(byFlagEmpty.textColor).toBe(byFlagFull.textColor)
  })

  it('stealth off preserves chrome irrespective of content', () => {
    const a = getStealthOverlayVariant({ stealthMode: false, theme: 'light', content: '' })
    const b = getStealthOverlayVariant({ stealthMode: false, theme: 'dark', content: 'x' })
    expect(a.showChrome).toBe(true)
    expect(b.showChrome).toBe(true)
    expect(a.isStealth).toBe(false)
    expect(b.isStealth).toBe(false)
  })

  it('accepts both content and hasContent shapes (backwards seam coverage)', () => {
    const v1 = getStealthOverlayVariant({ stealthMode: false, theme: 'light' })
    const v2 = getStealthOverlayVariant({ stealthMode: false, theme: 'light', content: 'hi' })
    const v3 = getStealthOverlayVariant({ stealthMode: false, theme: 'light', hasContent: true })
    expect(v1.isStealth).toBe(false)
    expect(v2.isStealth).toBe(false)
    expect(v3.isStealth).toBe(false)
  })
})
