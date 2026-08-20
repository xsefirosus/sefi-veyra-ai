# Overlay capture-exclusion note (setContentProtection) — step 6

Date: 2026-08-20. Recorded during step 6 (main + overlay windows + smoke mode) of
plan-veyra-p1p2.md, per the plan's anti-hallucination registry entry ("Overlay
capture-exclusion on Windows (setContentProtection): PENDING — attempted in step 6,
behavior recorded").

## Finding: SUPPORTED on this Electron/Windows combination

- Electron: 39.8.10 (installed, `npm ls electron`).
- Windows: 10.0.26200 (build 26200).
- API presence: `app/node_modules/electron/electron.d.ts` documents
  `setContentProtection(enable: boolean): void` with `@platform darwin,win32`.
- Native behavior (from the same docs): on Windows it calls
  `SetWindowDisplayAffinity` with `WDA_EXCLUDEFROMCAPTURE`; on Windows 10
  version 2004+ (build 19041+) the window is removed from capture entirely;
  older Windows versions behave as `WDA_MONITOR` (a black window is captured).
- This machine's build (26200) satisfies the >= 19041 requirement, so the
  exclusion mechanism is available.
- Observed in the step-6 smoke launch: `overlay.setContentProtection(true)`
  executed without error (the API returns void; no failure surfaced).

## Caveats / not claimed

- Whether the overlay is actually excluded from a live third-party capture tool
  (e.g. OBS, Discord screen share) was NOT empirically verified this pass.
- Status: SUPPORTED (API + OS prerequisite met, call executes cleanly); the
  end-to-end exclusion from an external capture app remains unverified.
  v1 accepts always-on-top without exclusion, so this does not block Phase 1.