# VEYRA Audit 02 — full end-to-end audit of the audit-01 remediation

Date: 2026-08-22. Scope: everything landed since audit-01
(`state/plan-veyra-audit-01.md`, steps 1-17 built by OpenCode/sefi-agents,
step 18's agent half verified in `state/audit-01-verify.md`), reviewed fresh
against the actual code — not the plan's claims, not the checkboxes. Branch
`claude/meeting-transcription-ai-app-k8t8hy`, synced to `origin/main` at
`d0f4274` (no drift since).

## Method

1. Re-ran the full gate from clean: `npm test`, `npm run typecheck`,
   `npm run lint`, `npm run build` — all green (217/217 tests) before any
   code review began.
2. Live-fired the actual interactive app (not the `e2e.ts` harness): rebuilt
   against the synced source, launched real Electron under Xvfb with
   `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture`,
   drove it over its own DevTools protocol (real Settings screen, real Start
   button click, real IPC, real `CaptureSession`) — screenshots sent to the
   user separately. This is what surfaced the network-egress finding below
   and is what led to re-reading the broadcast wiring closely enough to find
   the segmentId defect.
3. Read every file touched by audit-01's 17 steps against what the plan
   claimed each step fixed, cross-checking test coverage against the actual
   runtime wiring (not just "a test exists").

## Findings

### 1. CRITICAL (fixed this pass) — the step-8 duplicate-final-segment fix did not apply to the real app

Audit-01's flagship finding was that one spoken sentence produced 46
committed transcript lines instead of 1, because wlk resends a cumulative,
revised `lines[]` entry across messages and nothing gave a revision a stable
identity. Step 8 fixed this at the root: `context-parser.ts` computes a
stable `segmentId` (`"<start>:<lines-index>"`) that stays the same across a
segment's revisions, `whisper-livekit.ts`'s adapter threads it through as an
optional third callback argument, and the reducer replaces-in-place by
`segmentId` instead of appending. `tests/context-parser.test.ts`,
`tests/transcript-reducer.test.ts`, and the standalone `e2e.ts` harness (which
correctly reads the third callback argument — `e2e.ts:165`) all prove this
works. `state/audit-01-verify.md` reported it PASS on that evidence.

**But `src/main/index.ts` — the wiring the real interactive app and the
`VEYRA_TEST_AUDIO` demo seam actually use — never adopted the fix.** Both
`wireAdapterEvents` (the live Start-button path) and `handleTestAudio` (the
demo/harness-adjacent path) declared their callbacks as `(text, seq) => …`
— two parameters, silently dropping the adapter's real third argument — and
instead fabricated `` `final:${source}:${seq}` `` themselves. This compiles
and typechecks cleanly (a narrower-arity function is structurally assignable
to a wider callback type in TypeScript; no error, no warning), and no
existing test exercised it, because `main/index.ts` has no Electron-free unit
test and the only thing that validates end-to-end segment identity is
`e2e.ts`'s own separate wiring.

The consequence: the adapter's `seq` advances once per **final callback
firing**, not once per **distinct committed segment** — so a revision of the
same segment (wlk re-sending the extended `lines[]` entry) got a **new**
fabricated id every time, the reducer's `segmentId` lookup missed, and the
line was appended instead of replaced. **A real user running `npm run dev`
and speaking would have seen the exact "one sentence becomes many lines" bug
audit-01 was built to fix — the fix existed in the codebase but was
unreachable from the only path that matters.**

**Fixed in this pass**: extracted the correct construction (`segmentId ??
fallback`, matching `e2e.ts`'s approach) into one shared, pure, tested
function — `adapterEventToTranscriptEvent` in
`src/main/transcript/transcript-broadcast.ts` — and pointed both call sites
at it, so this bug class can't reappear by duplication. Added 4 new tests
(`tests/transcript-broadcast.test.ts`) proving: the real `segmentId` is used
verbatim; two revisions of the same segment get the same id even as `seq`
advances; the fallback only applies when no `segmentId` is supplied; the rest
of the event shape is preserved. `221/221` tests pass (up from 217),
typecheck/lint/build all clean.

### 2. MINOR (documented, not fixed) — `state/latency-audit-01.json`'s `finals` counts predate the counting-methodology fix

`state/audit-01-verify.md` documents that the step-18 gate's `e2e.ts` finals
counter was originally wrong — it counted raw `onFinal` callback firings
(which double- or triple-counts a revised segment) instead of distinct
`segmentId`s — and was fixed on 2026-08-22 during that gate.

`state/latency-audit-01.json` (step 15's dual-track latency measurement) was
captured **2026-08-21**, a day before that fix, using whatever counting the
harness had at the time. Its `mic.finals: 36` / `supplemental.mic.finals: 28`
/ `supplemental.loopback.finals: 28` are very likely raw-callback counts, not
distinct-segment counts, and were never regenerated after the fix was found.
The `firstPartialMs` latency numbers in that file are unaffected (they don't
depend on final-counting), but anyone reading `finals` there expecting it to
mean the same thing as `phase2-demo.json`'s `finals` will be misled. Left
as-is rather than silently rewritten — a regenerated measurement should be a
real re-run on real hardware, not a guess at what the old run "should" have
shown.

### 3. TRIVIAL (not fixed) — dead fallback branch in the reducer's final-commit path

`transcript-reducer.ts`'s `final` case computes `adjustedIdx` as a fallback
for `finalIdx` when re-searching the filtered array, but `finalIdx` is
provably always found in that branch (a partial and a final can never be the
same array element, so filtering out the pending partial never removes the
final being searched for) — `adjustedIdx` is unreachable. Harmless, correct
either way, just unnecessary. Not worth a churn-only commit; noting for
whoever next touches that function.

### 4. Environment findings from the live-fire test (informational, not app defects)

- **HuggingFace network block is sandbox-specific, not a VEYRA defect.**
  This container's egress policy denies `huggingface.co` (confirmed via the
  proxy's own status endpoint — repeated policy-level 403s, not a flake),
  which is where `faster-whisper` pulls model weights on first use. Manually
  running `wlk serve` reproduced the exact `ProxyError` traceback. No model
  can ever download in this sandbox; this has no bearing on real-machine
  behavior.
- **Linux venv install path confirmed working** (`scripts/setup-wlk.mjs` on
  this container) — previously marked PENDING for macOS/Linux in audit-01's
  anti-hallucination registry. `wlk --help` and `wlk serve --help` both
  matched what `wlk-server.ts` expects (host/port/model/pcm-input flags,
  port 8000 default) on a fresh Linux install, whisperlivekit 0.2.24 — same
  version as the original Windows install.
- **Open, unconfirmed anomaly**: during the live-fire test, the UI surfaced
  a raw `"Error invoking remote method 'session:start': reply was never
  sent"` roughly 50 seconds into a stuck "Starting model…" state — before
  `WlkServer`'s own 60-second `WLK_START_TIMEOUT_MS` would have naturally
  rejected it. Traced the code path (`session:start`'s handler is correctly
  try/caught; `waitForAsr`'s deadline check is time-based and
  process-state-independent) and found nothing that obviously explains an
  early, silent IPC failure. This sandbox's software-rendering/no-GPU
  Electron (GPU-process init errors were present in the log from launch) is
  a plausible confound but unconfirmed. **Flagging for the human live-mic
  pass**: if this exact message reproduces on a real machine, it's a real
  defect worth its own investigation; if it doesn't, this was sandbox noise.

## What's still open

- Dual-track (mic + loopback simultaneously) latency does not meet the
  sub-2s criterion on CPU-only `tiny` (`state/latency-audit-01.json`:
  2776ms/2167ms in the supplemental speech-on-both-tracks run) — recorded
  honestly as `pass: false` in audit-01, still true, not addressed here.
- The human live-mic checkpoint (criterion 13 of audit-01's Done Criteria)
  is still open — this audit does not close it. If anything, finding #1
  makes it more important: it's the first real chance to confirm the
  duplicate-segment fix actually holds now that the wiring bug is fixed.
- Claude Design UI work is a separate, following effort — not started here.
