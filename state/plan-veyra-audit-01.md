# Plan: VEYRA Audit Remediation 01 — Phase 1-2 hardening before Phase 3

## Objective
Fix the defects found in the first full audit of the VEYRA codebase (audit run
2026-08-20 against HEAD `e46fe61`, branch `claude/meeting-transcription-ai-app-k8t8hy`
== `origin/main`). The audit ran the real suite (`npm test`, `npm run typecheck`,
`npm run lint`, `npm run build`) and read every source file under `app/src`,
`app/tests`, `scripts/`, `config/` and `state/`.

The headline finding: **the interactive app does not transcribe anything.**
`startMicCapture` is never called from any component, `WlkServer` is never
instantiated in `src/main/index.ts`, and the STT adapters are only `connect()`ed
inside the `VEYRA_TEST_AUDIO` branch. Phase 2 was verified green exclusively
through `src/main/stt/e2e.ts`, which builds its own server + adapter + WAV feed
and therefore bypasses the application wiring entirely. `state/demo-p2.md`
instructs the human to `npm run dev` and speak, and asserts "the wlk server is
started at boot" — that path is not wired and cannot pass. This plan closes that
gap first, then fixes the transcript-correctness defects the `finals >= 1`
acceptance criterion was too loose to catch, then the reliability/UX defects,
then prepares the LLM seam for Phase 3-4.

Scope is remediation of EXISTING Phase 1-2 code plus seam preparation. Building
Phase 3 (context ingestion), Phase 4 (Gemini answers) and Phase 5 (history,
packaging) remains OUT of scope — those are their own plans. No Gemini API code
is written here; step 17 only reshapes the declared interface so Phase 4 does not
have to break it.

### Severity ledger (what this plan fixes, in order)
- **P0 — app is non-functional interactively**: findings 1-4 (steps 2-5).
- **P1 — transcript correctness**: findings 5-8 (steps 6-9).
- **P1 — settings round-trip broken**: findings 9-11 (steps 10-11).
- **P2 — reliability**: findings 12-19 (steps 1, 12-15).
- **P2 — UI/UX**: findings 20-26 (steps 16).
- **P3 — Phase 3/4 readiness**: findings 27-28 (step 17).

### Approach decisions (with rejected alternatives)
1. **Session lifecycle ownership** — **A: a main-process `CaptureSession` module (CHOSEN)**
   vs B: wire start/stop ad hoc inside `index.ts`. A: one object owns
   wlk spawn → adapter connect → capture start → teardown, in that order, with a
   single state machine (`idle|starting|listening|stopping|error`) that both
   windows can observe. B is how the code drifted into having no lifecycle at
   all; rejected.
2. **wlk server topology** — **A: one wlk process, two WS sessions (CHOSEN, verify first)**
   vs B: two wlk processes on different ports. A is what the code assumes today
   but has never been proven (the code comments still say concurrency is
   UNKNOWN). Step 7 proves it empirically before anything depends on it; if the
   second session is rejected, fall back to B (the factory change in step 6
   makes port/source injectable, so B is a config change, not a rewrite).
3. **Final-segment identity** — **A: key committed segments by wlk's own
   `lines[]` index + `start` timestamp (CHOSEN)** vs B: dedupe by text equality.
   A uses the real fixture fields (`speaker`, `text`, `start`, `end`,
   `detected_language` — verified present in `tests/fixtures/wlk-messages.json`
   index 12) so an in-place revision updates its segment instead of appending a
   new one. B breaks when a speaker legitimately repeats a sentence; rejected.
4. **Speaker attribution** — **A: wlk diarization (`lines[].speaker`) as primary,
   capture source as the tiebreaker (CHOSEN)** vs B: keep source-only labeling.
   A uses data the parser currently throws away and fixes the speaker-bleed case
   (system audio leaking into the mic gets labeled `me` today). B is what ships
   now and is wrong whenever both parties are audible on one track; rejected.
5. **Test environment independence** — **A: inject the wlk binary path, resolve
   lazily (CHOSEN)** vs B: create a dummy venv in CI. A removes the
   constructor-time filesystem dependency so unit tests run on any machine. B
   fakes the environment to satisfy a design flaw; rejected.

### Anti-hallucination registry (UNKNOWN / PENDING — do not invent)
- **wlk concurrent-WS-session support: UNKNOWN.** Asserted nowhere, assumed by
  `startLoopbackBridge`. Step 7 measures it. Do not claim dual-track works until
  that step's artifact says so.
- **Real dual-track latency: UNKNOWN.** Every recorded number (1552/1682 ms) is
  single-track, WAV-fed, `tiny`, one machine. Step 15 re-measures with both
  tracks live; the new number is written as measured, never carried over.
- **Live-mic behavior: NEVER EXERCISED.** No human has spoken into this app.
  Step 18 is that first test and it is a human checkpoint, not an agent step.
- **Overlay capture-exclusion: PENDING** (`state/overlay-capture-note.md` — API
  call succeeds, real exclusion from OBS/Zoom unverified). Step 16 does not
  claim to resolve it.
- **macOS/Linux: UNVERIFIED.** All four `scripts/*.ps1` are PowerShell; macOS
  loopback is documentation-only. Step 14 adds the portable path but cannot
  verify macOS on this machine — mark PENDING, do not claim it works.
- **Gemini model string: UNKNOWN.** Phase 4. Step 17 must not hardcode one.

## Steps

- [x] 1. **Make the unit suite environment-independent (fixes the 6 red tests).** (needs: -)
  `npm test` currently reports `6 failed | 100 passed`; every failure is
  `wlk-server: venv wlk missing at .../.wlk-venv/bin/wlk`, thrown from
  `wlkBinPath()` at `src/main/stt/wlk-server.ts:97` via the `WlkServer`
  constructor (`:156`) and via `buildWlkCommand`'s default parameter (`:111`).
  The venv is gitignored, so these tests pass only on the machine that ran
  `setup-wlk.ps1` and fail on every fresh clone and in CI. Fix: make resolution
  lazy — the constructor stores `opts.wlkBin` without resolving, and `start()`
  resolves (and existence-checks) at spawn time; give `buildWlkCommand` a
  required explicit binary argument at its call sites, or a lazily-resolved one.
  Update `tests/wlk-server.test.ts` to inject a fake path. Verify: `npm test`
  reports 0 failures with `.wlk-venv` absent (confirm with
  `test ! -e app/.wlk-venv` first). Commit.

- [x] 2. **Extract a `CaptureSession` lifecycle owner (main).** (needs: 1) New
  `src/main/capture/capture-session.ts`. One class owning the full ordered
  lifecycle that no code performs today: `start(settings)` → spawn `WlkServer`
  with `settings.sttModel` → `await adapter.connect()` for each active track →
  signal the renderer to begin capture → `stop()` tears down in reverse
  (capture stop, adapter close, `server.shutdown()`). Expose a state machine
  `idle|starting|listening|stopping|error` plus `lastError`. Pure lifecycle
  logic (ordering, guards, idempotency) must be unit-testable with injected
  fakes for server/adapter — no Electron import in the testable core. Tests
  `app/tests/capture-session.test.ts`: start→listening, double-start rejects,
  stop before start is a no-op, adapter-connect failure lands in `error` with
  `lastError` set and the server shut down (no orphan process). Verify:
  `npm test` passes. Commit.

- [x] 3. **Wire the session into main and delete the dead bridge paths.** (needs: 2) In
  `src/main/index.ts`, replace `startCaptureBridge`/`startLoopbackBridge` with
  `CaptureSession`. The `ipcMain.on('pcm')`/`'pcm-loopback'` handlers stay
  (same `createPcmSink` trust-boundary validation) but route to the session's
  adapters, and must no-op with a throttled warning when the session is not
  `listening` instead of throwing `send() before connect()` per chunk (today
  every chunk would log an error ~10x/second). Add `ipcMain.handle('session:start')`,
  `'session:stop'`, `'session:state'`, and broadcast state changes to both
  windows on a `session-state` channel. Keep `VEYRA_TEST_AUDIO` and
  `VEYRA_LOOPBACK_CHECK` working unchanged — the harness paths must not regress.
  Verify: `npm test`, `npm run build`, and the step-21 e2e harness still exits 0.
  Commit.

- [x] 4. **Call the capture code that is currently orphaned (renderer).** (needs: 3)
  `startMicCapture` (`src/renderer/src/capture/mic-capture.ts:55`) has **zero
  call sites in the entire repo** — verified by grep across `src/` and `tests/`.
  `startLoopbackCapture` is called only under `window.api.loopbackCheckMode`
  (`App.tsx:24`). Add `src/renderer/src/capture/use-capture.ts`: on
  `session-state` → `listening`, start mic capture with the saved
  `settings.audioDeviceId` (skipping the `LOOPBACK_DEVICE_ID` sentinel — it must
  never reach `getUserMedia`) and start loopback capture; on `stopping`/`idle`,
  stop both handles and release the tracks. Surface the `onFallback`
  (`scriptprocessor`) mode so the UI can show it. Verify: `npm test` passes;
  `npm run build` passes. Commit.

- [x] 5. **Add the Start/Stop control and status indicator (UI).** (needs: 4) There is no
  way to begin a session in the app today. In `SettingsScreen` (or a new header
  bar shared by both windows) add a primary Start/Stop listening button bound to
  `session:start`/`session:stop`, plus a status chip driven by `session-state`:
  `Idle` / `Starting model…` / `Listening` / `Error: <message>`. The overlay
  shows the same state — replace its unconditional `Listening…` placeholder
  (`TranscriptPanel.tsx:41`), which currently lies whenever nothing is running.
  Model download on first `base`/`small` run takes minutes: `starting` must say
  so rather than appear hung. Tests: reducer/state-mapping unit tests for the
  status chip. Verify: `npm test`. Commit.

- [x] 6. **Make the STT factory injectable.** (needs: 1) `createSttAdapter` in
  `src/shared/stt/stt-adapter.ts` takes no options and always constructs
  `new WhisperLiveKitSttAdapter()` (`createLazyLocalAdapter`, `:71`), so both
  the mic and loopback adapters are built with `source: 'mic'` and the default
  URL, and `settings.sttModel` reaches nothing. Thread `{source, url, model}`
  through the factory and the lazy facade. This is the seam approach decision 2's
  fallback (a second wlk on another port) depends on. Update
  `tests/stt-adapter.test.ts` to assert options reach the constructed adapter.
  Verify: `npm test`. Commit.

- [ ] 7. **Prove or disprove concurrent wlk WS sessions.** (needs: 6) The code comment at
  `src/main/index.ts:211` still records this as UNKNOWN while the dual-track
  design depends on it. Write `scripts/probe-wlk-concurrent.mjs` (portable Node,
  mirroring `probe-wlk.mjs`): start one wlk, open TWO `/asr` sockets, stream the
  test WAV into both, record whether both receive transcription messages. Write
  `state/wlk-concurrency.json` `{concurrentSessions: true|false, session1Messages,
  session2Messages, note}`. If FALSE: switch the loopback track to a second
  `WlkServer` on port 8001 using the step-6 factory options, and record the
  change in the same artifact. Never assume the answer — write what was measured.
  Commit script + artifact.

- [x] 8. **Fix duplicate and lost final segments (the biggest correctness bug).** (needs: 1)
  `normalizeWlkMessage` (`src/shared/stt/context-parser.ts`) emits a `final`
  from `lastNonEmptyLineText(parsed.lines)` on **every** status message whose
  last line has text. wlk's `lines[]` is cumulative AND revised in place —
  verified in the real fixture: index 11 is `" testing 1, 2, 3. This is the Vero
  meeting transcription"` and index 12 is the SAME segment extended to
  `"… transcription test"`. The adapter advances `seq` on each (`whisper-livekit.ts:207`)
  and the reducer APPENDS each (`transcript-reducer.ts:69-70`), so one sentence
  becomes many committed lines. This is why the accepted e2e artifact reads
  `finals=46` against `partials=24` for a single short WAV: `state/phase2-demo.json`.
  A `finals >= 1` criterion could not catch it.
  Fix per approach decision 3: change the parser to return `TranscriptEvent[]`
  (zero or more) and emit one event **per `lines[]` entry**, each carrying a
  stable segment identity from wlk's own fields (`start` timestamp + index) plus
  `speaker`, `start`, `end`, `detected_language`. Extend `TranscriptEvent` in
  `src/shared/types.ts` with `segmentId: string` and the optional wlk fields.
  Downstream, a repeat of the same `segmentId` REPLACES its line instead of
  appending. Update `tests/context-parser.test.ts` to assert against the real
  fixture: replaying all 14 messages must yield exactly **one** committed
  segment whose final text is `"testing 1, 2, 3. This is the Vero meeting
  transcription test"` — not two, not 46. Verify: `npm test`. Commit.

- [ ] 9. **Fix cross-track seq collision and segment-keyed reducer state.** (needs: 8) Each
  adapter instance owns a private `seq` starting at 0
  (`whisper-livekit.ts:142`), so the mic track and the loopback track both emit
  seq 0, 1, 2… The reducer matches pending partials by seq ALONE
  (`transcript-reducer.ts:53`, `:60`, `:69`) with no source/speaker in the
  predicate, so a loopback partial overwrites the mic's in-flight line and a
  loopback final deletes it. `TranscriptPanel`'s overlay key
  `` `${l.kind}-${l.seq}` `` collides for the same reason (duplicate React keys),
  and the panel uses array-index keys (`key={i}`) on a live-mutating list.
  Fix: key all reducer lookups on the step-8 `segmentId` (which is per-source by
  construction), keep `source` on every line, and use `segmentId` as the React
  key in both variants. Add a cap: keep at most N committed lines in the overlay
  tail and virtualize or window the panel list so an hour-long meeting does not
  grow an unbounded array that re-renders in full on every partial. Tests
  `tests/transcript-reducer.test.ts`: interleaved mic+loopback streams with
  colliding seq values produce two independent lines; a revision replaces rather
  than appends; the cap evicts oldest-first. Verify: `npm test`. Commit.

- [ ] 10. **Use wlk diarization for speaker labels.** (needs: 8) `labelForSource`
  (`src/shared/stt/speaker-label.ts`) maps `mic → me`, everything else →
  `other`, and the parser docstring explicitly drops the real `speaker` field.
  The fixture proves wlk supplies it (`lines[0].speaker === 1`). Because the mic
  also picks up the far end through the speakers (mic requests
  `echoCancellation: true` but AEC does not remove a co-located human or a
  loud speaker reliably), source-only labeling mislabels the interviewer as
  `me` — the exact failure mode that makes the Phase 4 answers wrong. Fix:
  prefer wlk's `speaker` when present, resolve it to `me`/`other` using the
  capture source as the tiebreaker (the mic track's dominant speaker id is
  `me`), and keep `labelForSource` as the fallback when diarization is absent.
  Tests `tests/speaker-label.test.ts`: diarization present wins; absent falls
  back; unknown stays conservative (`other`). Verify: `npm test`. Commit.

- [ ] 11. **Fix the settings round-trip (currently write-only).** (needs: 5)
  `registerIpcHandlers` registers `settings:load` (`settings-store.ts`), but the
  preload exposes no `loadSettings` and `SettingsScreen` initializes from
  `initialSettings` unconditionally (`SettingsScreen.tsx:24`) — so a saved Gemini
  key, model and device are invisible after restart and the user reasonably
  concludes the save failed. Expose `window.api.loadSettings()`, hydrate the
  reducer on mount, and show the key as a masked "saved" state rather than an
  empty password box. Also: `onSave` (`:64`) has no `.catch`, so the documented
  `safeStorage encryption unavailable; refusing to persist apiKey` throw becomes
  a silent unhandled rejection — add error state and surface it. Reset the
  `saved` flag on the next edit (today "Settings saved" persists forever). Tests:
  hydration on mount, save-failure surfaces an error, flag resets. Verify:
  `npm test`. Commit.

- [ ] 12. **Surface STT/session errors to the user.** (needs: 5, 3) Adapter errors are
  swallowed into `console.error` in main (`index.ts:110`, `:239`) where no user
  will ever see them; a failed wlk spawn or a dropped socket presents as an app
  that simply shows nothing. Route `adapter.onError` and `CaptureSession` errors
  through the step-3 `session-state` broadcast into the step-5 status chip, with
  the message text. Verify: `npm test`; simulate a spawn failure (point `WLK_BIN`
  at a nonexistent path) and confirm the UI reports it rather than hanging in
  `starting`. Commit.

- [ ] 13. **Add wlk crash/disconnect recovery.** (needs: 12) Nothing restarts the server or
  reconnects the socket today: `WlkServer.start()` polls once at boot, the
  `child.on('exit')` handler only nulls the reference (`wlk-server.ts:185-189`),
  and `NodeWsTransport` has no reconnect (`whisper-livekit.ts:101`) — a mid-meeting
  crash silently ends transcription with no user-visible signal. Add bounded
  exponential-backoff restart (cap the attempts, surface `error` state when
  exhausted) and socket reconnect that preserves the transcript already
  committed. Tests with injected fakes: exit triggers restart; repeated failure
  gives up and reports; reconnect does not duplicate committed segments.
  Verify: `npm test`. Commit.

- [ ] 14. **Portable setup scripts + cross-platform capture path.** (needs: 1) All four
  scripts are PowerShell-only (`setup-wlk.ps1`, `synth-speech.ps1`,
  `check-loopback.ps1`, and `probe-wlk.mjs`'s documented invocation), so a
  macOS or Linux contributor cannot install wlk or run any verification; the
  `README`/plan claim a Mac + Windows product. Add portable equivalents
  (Node `.mjs` or `sh`) for setup and the loopback check, keep the `.ps1`
  versions, and pick the right one per platform. Confirm `wlkBinPath`'s
  posix branch (`.wlk-venv/bin/wlk`) actually resolves after a posix install.
  macOS loopback (BlackHole) stays PENDING — document, do not claim.
  Verify: `scripts/setup-wlk.mjs` completes on this Linux container and
  `wlk --help` exits 0. Commit.

- [ ] 15. **Anti-aliased downsampling + real dual-track latency re-measure.** (needs: 9, 7)
  `downsample` (`src/shared/audio/format.ts`) is naive linear interpolation with
  no low-pass prefilter, so 48 kHz → 16 kHz folds everything above 8 kHz back
  into the band as aliasing noise — it degrades STT accuracy on exactly the
  consonants that carry intelligibility. Add a simple FIR/biquad low-pass before
  decimation; keep the function pure and shared. Then re-run the e2e harness
  with BOTH tracks live (mic WAV + loopback tone) and write
  `state/latency-audit-01.json` with the measured `firstPartialMs` per track and
  the dual-track total. The existing 1682 ms is single-track and does not
  characterize the real product path. Never carry the old number forward.
  Tests: `tests/format.test.ts` gains an alias-rejection assertion (a tone above
  Nyquist must attenuate, not fold). Verify: `npm test`; artifact written with
  real numbers. Commit.

- [ ] 16. **Overlay and layout UX pass.** (needs: 5) Concrete defects found:
  (a) the overlay is `frame: false` with no `-webkit-app-region: drag` region
  and `resizable: false` (`windows.ts:60-71`) — the user cannot move or resize
  it, and it is never positioned, so it opens centered while `state/demo-p2.md`
  tells the user to expect it at the bottom of the screen;
  (b) `body { user-select: none }` (`main.css`) makes the transcript
  unselectable — copying a suggested answer is the core action of this product
  and it is impossible today;
  (c) `.settings` is `min-height: 100vh` and `TranscriptPanel` renders after it
  in `.main-screen`, pushing the transcript entirely below the fold;
  (d) the transcript list never auto-scrolls, so new lines appear out of view;
  (e) device labels come back empty from `enumerateDevices()` before mic
  permission is granted (`SettingsScreen.tsx:41-45`), leaving raw deviceId
  hashes in the select — request permission (or re-enumerate after the first
  `getUserMedia`) before populating.
  Fix all five: add a drag region and persist overlay position/size, make
  transcript text selectable with a copy affordance, put the transcript
  above/beside settings, pin-to-bottom on new lines unless the user scrolled up,
  and re-enumerate devices post-permission. Verify: `npm run build`; confirm
  each in the step-18 live pass. Commit.

- [ ] 17. **Reshape the LLM seam for Phase 3-4 (declare only, still no Gemini).** (needs: 1)
  `LlmAdapter.streamSuggestions(ctx)` (`src/shared/llm/llm-adapter.ts`) yields
  whole `Suggestion` objects, takes only `{events, meetingId}`, and has no
  cancellation. Phase 4's own criterion is "sub-3-4 s to first suggestion
  **token**", which a whole-object stream cannot express, and a live copilot must
  cancel an in-flight generation the moment the speaker continues. Phase 3's
  persona/CV/JD context has nowhere to live in `TranscriptContext`. Reshape now,
  while there are no implementations to break: token-level streaming
  (`AsyncIterable<SuggestionDelta>` with a terminal complete event), an
  `AbortSignal` parameter, and a `PersonaContext` field (resume, job description,
  notes, docs) on `TranscriptContext`. Keep it interface-only — no provider code,
  no model string (still UNKNOWN, must come from settings/env in Phase 4).
  Update `tests/llm-adapter.test.ts`: a mock streams deltas, honors an abort, and
  accepts a persona. Verify: `npm test`. Commit.

- [ ] 18. **VERIFICATION GATE + first live-mic pass (human checkpoint).** (needs: 5, 9, 10, 11, 13, 15, 16, 17)
  Agent half: `npm test` (0 failures, and confirm the count grew — the audit
  baseline is 106 tests), `npm run typecheck`, `npm run lint` (0 errors; also
  clear the 18 prettier warnings with `--fix`), `npm run build`, then the e2e
  harness. Assert `state/phase2-demo.json` afresh: `partials >= 1`,
  **`finals` equals the true committed-segment count for the test WAV (1), not
  46** — this is the step-8 regression guard — `firstPartialMs < 2000`,
  `loopbackEnergyCaptured === true`. Rewrite `state/demo-p2.md` so it describes
  what the app actually does (Start button, status chip, real overlay behavior);
  the current text describes a boot-time server start that does not exist.
  Write `state/audit-01-verify.md` with one PASS/FAIL line per assert.
  Human half (cannot be delegated): `npm run dev`, press Start, speak, confirm
  `me` lines; play system audio, confirm `other` lines; confirm the overlay can
  be moved and the transcript copied. Nothing here is claimed as done until the
  human reports back. Commit.

## Files Touched
- New: `app/src/main/capture/capture-session.ts`,
  `app/src/renderer/src/capture/use-capture.ts`,
  `app/tests/capture-session.test.ts`, `app/tests/use-capture.test.ts`,
  `scripts/probe-wlk-concurrent.mjs`, `scripts/setup-wlk.mjs`,
  `scripts/check-loopback.mjs`
- Modified (main): `src/main/index.ts`, `src/main/stt/wlk-server.ts`,
  `src/main/stt/whisper-livekit.ts`, `src/main/stt/e2e.ts`,
  `src/main/settings-store.ts`, `src/main/windows.ts`
- Modified (shared): `src/shared/types.ts`, `src/shared/stt/context-parser.ts`,
  `src/shared/stt/stt-adapter.ts`, `src/shared/stt/speaker-label.ts`,
  `src/shared/audio/format.ts`, `src/shared/llm/llm-adapter.ts`
- Modified (preload): `src/preload/index.ts`, `src/preload/index.d.ts`
- Modified (renderer): `src/renderer/src/App.tsx`,
  `src/renderer/src/settings/SettingsScreen.tsx`,
  `src/renderer/src/transcript/TranscriptPanel.tsx`,
  `src/renderer/src/transcript/transcript-reducer.ts`,
  `src/renderer/src/transcript/use-transcript.ts`,
  `src/renderer/src/capture/mic-capture.ts`,
  `src/renderer/src/capture/loopback-capture.ts`,
  `src/renderer/src/assets/main.css`
- Modified (tests): `wlk-server`, `stt-adapter`, `context-parser`,
  `transcript-reducer`, `speaker-label`, `format`, `llm-adapter`,
  `settings-store` test files
- State artifacts (new/rewritten): `state/wlk-concurrency.json`,
  `state/latency-audit-01.json`, `state/audit-01-verify.md`,
  `state/demo-p2.md` (rewritten to match reality)

## Requires Tools
git, node (>= 22 — the global `WebSocket` both `wlk-server.ts` and
`whisper-livekit.ts` depend on), npm, python, pip, wlk (installed into
`app/.wlk-venv` by step 14's portable script), powershell (Windows only —
no longer required for any step after step 14).

## Risks
- **Step 8 changes the parser's return type** (`TranscriptEvent` →
  `TranscriptEvent[]`), which touches the adapter, the reducer and every
  transcript test. It is the highest-churn step and the one most likely to need
  two dispatches; it is also the one that makes the transcript correct, so it
  cannot be skipped or softened.
- **Step 7 may invalidate the dual-track design.** If wlk rejects the second
  concurrent session, step 7's fallback (second server, port 8001) doubles CPU
  and model memory — on a `tiny` CPU-only machine that may push latency past the
  2 s criterion. Record the measurement; if it fails, escalate rather than
  quietly loosening the criterion.
- **Steps 12-13 (error surfacing, restart) can mask real failures** if backoff
  is too generous. Cap attempts and always surface the terminal error.
- **Step 15's low-pass filter changes the audio fed to wlk**, so transcription
  output will shift. Re-baseline the fixture expectations if text changes; do
  not force the old strings.
- **`npm audit` reports 2 high-severity advisories** (`extract-zip` path
  traversal, reached through `electron` 39.8.10); the fix is `electron@43`, a
  major bump that would invalidate the step-19 loopback finding (the Electron 39
  native `getDisplayMedia` + `audio: 'loopback'` path, and the electron-audio-loopback
  README's version bounds). Out of scope here — raise as its own dependency
  upgrade plan with a loopback re-verification attached. Do not bump Electron
  inside this plan.
- **Budget** (`config/budget.yml`): `per_dispatch_usd_cap` 0.15,
  `max_retries` 2, `max_parallel_worktrees` 3. One step = one dispatch; a step
  REJECTed twice escalates to `inbox/`.
- **Step 18's human half is a blocking checkpoint.** The live-mic path has never
  run. Nothing in this plan may be reported as complete on the strength of the
  e2e harness alone — that is precisely the gap that let a non-functional app
  pass a Phase 2 gate.

## Done Criteria
Every criterion is a command or an artifact — grep-counted, zero LLM judgment.

1. `cd app && npm test` exits 0 with **0 failed** tests, run on a clone with **no
   `.wlk-venv` present** (`test ! -e app/.wlk-venv` before the run). Baseline was
   `6 failed | 100 passed`; the passing count must exceed 100.
2. `npm run typecheck` exits 0. `npm run lint` exits 0 with **0 warnings**
   (baseline: 18 prettier warnings). `npm run build` exits 0.
3. `grep -rn "startMicCapture" app/src` shows at least one call site outside its
   own definition file (baseline: none — the function was dead code).
4. `grep -rn "new WlkServer\|WlkServer(" app/src/main` shows the server being
   constructed on the interactive path, not only in `e2e.ts`.
5. `state/wlk-concurrency.json` exists and records a measured
   `concurrentSessions` boolean with per-session message counts.
6. Replaying `app/tests/fixtures/wlk-messages.json` through the parser yields
   exactly **one** committed segment with final text
   `"testing 1, 2, 3. This is the Vero meeting transcription test"` — asserted in
   `tests/context-parser.test.ts`.
7. `state/phase2-demo.json` re-run shows `finals` equal to the true segment count
   for the test WAV (**1**, not 46), `partials >= 1`, `firstPartialMs < 2000`,
   `loopbackEnergyCaptured === true`.
8. `state/latency-audit-01.json` exists with dual-track measured numbers.
9. `tests/transcript-reducer.test.ts` contains an interleaved mic+loopback case
   with colliding seq values proving two independent lines survive.
10. `grep -n "user-select: none" app/src/renderer/src/assets/main.css` no longer
    matches the transcript surfaces (text is selectable).
11. `state/demo-p2.md` no longer claims "the wlk server is started at boot" and
    describes the Start control.
12. `state/audit-01-verify.md` lists every assert above with PASS/FAIL.
13. Human checkpoint recorded: the live-mic pass (step 18) is confirmed by the
    human in `inbox/`, with the date and what was observed. Absent that record,
    this plan is NOT complete regardless of the artifacts.
