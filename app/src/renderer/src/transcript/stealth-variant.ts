/**
 * Stealth overlay variant (phase 3 step 14): pure mapping
 * stealthMode / theme / content -> rendered variant.
 *
 * The canvas's "state 4" minimal treatment: when stealthMode is true,
 * the overlay renders no card beyond a faint wash, no icons/labels/buttons
 * (showChrome=false), just text at reduced opacity.
 *
 * Seams under test (pre-agreed checkpoint):
 *  1. This pure function (unit-tested, no DOM).
 *  2. CSS class `overlay-card--stealth` (wash + text color, verified via build/class presence).
 *  3. TranscriptPanel overlay prop threading (stealthMode/theme -> variant).
 * No test is written at an unconfirmed seam.
 *
 * Colors: copied verbatim from plan/design source of truth:
 *  - wash:            oklch(100% 0 0 / 0.22)  (faint wash, both themes)
 *  - text light:      oklch(24% 0.01 90 / 0.7)
 *  - text dark equiv: oklch(96% 0.005 90 / 0.7) — near-white at 0.7, the dark
 *                     counterpart to 24% lightness on the light surface; keeps
 *                     the same Quiet Glass 0.7 text opacity.
 */

export type StealthTheme = 'light' | 'dark'

export interface StealthVariantInput {
  stealthMode: boolean
  theme: StealthTheme
  /** Text content length or hasContent; used only to keep the seam content-aware per plan. */
  content?: string
  hasContent?: boolean
}

export interface StealthVariant {
  /** Whether stealth minimal treatment is active. */
  isStealth: boolean
  /** Whether chrome (icons/labels/buttons/speaker tags) should be shown. */
  showChrome: boolean
  /** CSS class(es) for the card element. */
  cardClassName: string
  /** Faint wash background value (for verification, also present in CSS). */
  wash: string
  /** Resolved text color for the overlay lines. */
  textColor: string
  /** Resolved background for the card. */
  background: string
}

/** Faint wash — no card beyond this in stealth. */
export const STEALTH_WASH = 'oklch(100% 0 0 / 0.22)'

/** Stealth text at reduced opacity — light theme. */
export const STEALTH_TEXT_LIGHT = 'oklch(24% 0.01 90 / 0.7)'

/** Stealth text at reduced opacity — dark theme equivalent. */
export const STEALTH_TEXT_DARK = 'oklch(96% 0.005 90 / 0.7)'

/** Normal glass backgrounds (for reference / non-stealth verification). */
export const GLASS_BG_LIGHT = 'oklch(100% 0 0 / 0.7)'
export const GLASS_BG_DARK = 'oklch(22% 0.01 90 / 0.68)'

export function getStealthOverlayVariant(input: StealthVariantInput): StealthVariant {
  const stealthMode = Boolean(input.stealthMode)
  const theme: StealthTheme = input.theme === 'dark' ? 'dark' : 'light'

  if (!stealthMode) {
    return {
      isStealth: false,
      showChrome: true,
      cardClassName: 'overlay-card',
      wash: '',
      textColor: theme === 'dark' ? 'var(--ev-c-text-1)' : 'var(--ev-c-text-1)',
      background: theme === 'dark' ? GLASS_BG_DARK : GLASS_BG_LIGHT
    }
  }

  return {
    isStealth: true,
    showChrome: false,
    cardClassName: 'overlay-card overlay-card--stealth',
    wash: STEALTH_WASH,
    textColor: theme === 'dark' ? STEALTH_TEXT_DARK : STEALTH_TEXT_LIGHT,
    background: STEALTH_WASH
  }
}
