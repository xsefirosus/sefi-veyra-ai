/**
 * Speaker labeling (plan step 20): maps a capture source to a conservative
 * speaker label. 'mic' is the operator ('me'); every other source -- including
 * 'loopback' and any unrecognized value -- is 'other'. Conservative by design:
 * an unknown source must never be mislabeled as the operator, so the default
 * falls to 'other'. Pure and side-effect free; the main-process capture sites
 * (src/main/index.ts) apply it when constructing TranscriptEvents before
 * broadcast on the step-18 dispatch path.
 */
export function labelForSource(source: string): 'me' | 'other' {
  return source === 'mic' ? 'me' : 'other'
}
