/**
 * Speaker labeling (plan steps 20 + audit step 10): maps capture source and
 * wlk diarization to a conservative speaker label.
 *
 * - `labelForSource(source)` — source-only fallback: 'mic' -> 'me', anything
 *   else -> 'other'. Conservative by design: an unknown source must never be
 *   mislabeled as the operator.
 * - `resolveSpeakerLabel(speakerId, source)` — diarization-aware resolver.
 *   Prefers wlk's `lines[].speaker` when present, resolves to 'me'/'other'
 *   using the capture source as the tiebreaker (the mic track's dominant
 *   speaker is 'me'), and falls back to `labelForSource` when diarization is
 *   absent. Unknown sentinel values stay conservative ('other').
 *
 * Pure and side-effect free; the main-process capture sites (src/main/index.ts)
 * apply it when constructing TranscriptEvents before broadcast. The parser
 * (src/shared/stt/context-parser.ts) carries `speakerId` verbatim from wlk's
 * `lines[]` (observed: 1 for a real speaker, -2 for unknown/no speech).
 *
 * sefi: ceiling is source tiebreaker; upgrade path is per-track dominant
 * speaker tracking (e.g. count diarized segments per source and map the
 * majority id on 'mic' to 'me', others to 'other') when mic bleed is measured
 * in the wild. Current minimum preserves correctness for the single-speaker
 * fixture and the unknown sentinel.
 */
export function labelForSource(source: string): 'me' | 'other' {
  return source === 'mic' ? 'me' : 'other'
}

/**
 * Prefer wlk diarization when present; otherwise fall back to source.
 * - `speakerId` is wlk's `lines[].speaker` (number when present, e.g. 1, -2).
 * - `source` is the capture track ('mic' | 'loopback' | unknown).
 * - Returns 'me' | 'other', never throws.
 *
 * Rules:
 *  1. Diarization absent (undefined/null/non-number/non-finite) -> fallback.
 *  2. wlk unknown sentinel (-2) or any negative -> conservative 'other'.
 *  3. Valid diarized id (>=0) -> resolve via source tiebreaker (mic -> 'me',
 *     loopback/other -> 'other'). Diarization wins over fallback, but the
 *     tiebreaker is still source until per-speaker tracking is added.
 */
export function resolveSpeakerLabel(speakerId: unknown, source: string): 'me' | 'other' {
  if (typeof speakerId === 'number' && Number.isFinite(speakerId)) {
    if (speakerId === -2) return 'other'
    if (speakerId >= 0) {
      // diarization present: source is the tiebreaker
      // sefi: source tiebreaker ceiling; upgrade to dominant-speaker map
      return labelForSource(source)
    }
    // any other negative (e.g. -1) is unknown -> conservative
    return 'other'
  }
  // absent or non-numeric -> fallback
  return labelForSource(source)
}
