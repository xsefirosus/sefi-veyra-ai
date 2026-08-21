# Audit-01 verification gate — step 18 AGENT HALF (2026-08-22)

Branch `claude/meeting-transcription-ai-app-k8t8hy`, HEAD at gate start
`3eea0a1`. One PASS/FAIL line per Done Criterion (plan section "Done Criteria",
items 1-12). Criterion 13 (human live-mic pass) is NOT claimed here — it is a
human checkpoint and remains open; plan step 18 stays unchecked.

Instrumentation note (disclosed, not massaged): the first e2e run of this gate
measured `finals=35` because the harness still counted RAW `onFinal` callbacks,
while wlk post-step-8 re-sends cumulative `lines[]` on every status message (one
committed segment fires once per message after it commits — fixture indexes
11-12 are two events for ONE segment; the reducer replaces by segmentId). The
counter was fixed at its root to measure what criterion 7 defines — DISTINCT
committed segments, deduped by the parser's stable segmentId — by passing the
segmentId the adapter already had through the existing callback (optional third
argument; non-breaking, all 217 tests stayed green). The raw count is written
alongside as `finalEventsRaw`. Exactly ONE e2e re-run was performed after the
fix; its numbers are the recorded ones. Latency straddle disclosure: that
pre-fix run measured firstPartialMs=2093 ms (>= 2000); the single post-fix run
measured 1925 ms. CPU-only tiny straddles the 2 s threshold between runs; both
numbers are real measurements from their respective runs, neither chosen nor
discarded to fit the threshold.

1. PASS — `cd app && npm test`: **217 passed / 0 failed** (24 files), with
   `app/.wlk-venv` absent during the run (`Rename-Item` aside;
   `Test-Path app\.wlk-venv` = False before, True restored after). Baseline was
   106 total (6 failed | 100 passed); 217 > 100.
2. PASS — `npm run typecheck` exit 0 (node + web). `npx eslint .` full uncached
   run: exit 0, **0 errors, 0 warnings** (baseline 18 prettier warnings).
   `npm run build` exit 0 (main/preload/renderer bundles emitted).
3. PASS — `startMicCapture` call site outside its definition file:
   `app/src/renderer/src/capture/use-capture.ts:99` → `await startMicCapture({`
   (definition: mic-capture.ts).
4. PASS — server constructed on the interactive path, not only e2e.ts:
   `app/src/main/index.ts:60` `new CaptureSession()` whose default factory is
   `app/src/main/capture/capture-session.ts:81`
   `(model) => new WlkServer(model)`.
5. PASS — `state/wlk-concurrency.json` exists with measured
   `concurrentSessions: true`, `session1Messages: 59`, `session2Messages: 72`
   (measured 2026-08-21, step 7 probe).
6. PASS — `tests/context-parser.test.ts:46` asserts replaying all 14 fixture
   messages yields exactly one committed segment; `:55` asserts its final text
   is `"testing 1, 2, 3. This is the Vero meeting transcription test"`. Green in
   the 217-test run.
7. PASS — `state/phase2-demo.json` regenerated afresh by the e2e harness:
   `partials: 31` (>= 1), `finals: 1` (== true committed-segment count; not 46),
   `firstPartialMs: 1925` (< 2000), `loopbackEnergyCaptured: true`.
   Straddle risk recorded above (2093 ms in the immediately prior run);
   `state/latency-p2.json` carries pass: true for the recorded run only.
8. PASS — `state/latency-audit-01.json` exists with dual-track measured numbers
   (step 15): primary mic 2012 ms / loopback null (tone emits no text events),
   supplemental speech-on-both mic 2776 ms / loopback 2167 ms / total 2776 ms,
   `pass: false` honestly recorded there — dual-track sub-2 s on CPU tiny
   remains OPEN as the known risk; this criterion requires existence + measured
   numbers, which hold.
9. PASS — `tests/transcript-reducer.test.ts:233` "interleaved mic+loopback
   streams with colliding seq values produce two independent lines"; asserts
   both lines survive revision independently. Green in the 217-test run.
10. PASS — body-level `user-select: none` removed from main.css (comment at
    line 11 documents the step-16(b) change); the two remaining matches
    (lines 117, 326) are button/control rules ("control, not content"), so
    transcript surfaces match nothing and text is selectable/copyable.
11. PASS — `state/demo-p2.md` rewritten: contains no boot-time-server claim
    (states the opposite: "Nothing runs until you press Start listening") and
    documents the Start/Stop control, status chip incl. `Error:` state,
    overlay drag/resize/persisted bounds, selectable+copyable transcript with
    Copy button, pin-to-bottom scroll, device re-enumeration.
12. PASS — this file lists every assert above with PASS/FAIL.

## Not claimed here

- Criterion 13 / step-18 human half: live-mic pass (`npm run dev`, press Start,
  speak, confirm `me` lines; system audio → `other`; overlay move + transcript
  copy). PENDING human record in `inbox/`. The plan is NOT complete without it.

## Command log (real outputs, condensed)

```
npm test            -> Test Files 24 passed (24) | Tests 217 passed (217)
npm run typecheck   -> exit 0 (typecheck:node + typecheck:web)
npx eslint .        -> exit 0, no output (0 errors, 0 warnings)
npm run build       -> exit 0 (out/main, out/preload, out/renderer emitted)
e2e (VEYRA_E2E=1)   -> RESULT partials=31 finals=1 finalEventsRaw=40
                       labelsSeen=["me"] firstPartialMs=1925
                       loopbackEnergyCaptured=true ; exit 0
```
