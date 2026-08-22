# Plan: VEYRA Phase 3 + Quiet Glass UI — persona ingestion, red-accent light/dark theme, visibility controls, answer-suggestion UI

## Objective
Implement the finalized "Quiet Glass" design (published Claude Design canvas,
https://claude.ai/code/artifact/6a778b1a-0506-4bec-a7df-c6a1219e5bf6, page
"Veyra") into the real Electron app on
`claude/meeting-transcription-ai-app-k8t8hy`, on top of the audit-01/audit-02
hardened Phase 1-2 codebase (HEAD `68d1429` at plan-write time). Four pieces,
all agreed with the user across the design session:

1. **Real Phase 3 context ingestion** — resume/CV, job description, notes,
   and open-ended additional-context files, with actual upload + parsing +
   storage. `PersonaContext` has existed as a declared-only type
   (`src/shared/types.ts`) since audit-01 step 17; nothing ingests it yet.
2. **A light-mode-default theme with a dark toggle** — the app is currently
   dark-only (every color in `main.css`/`base.css` is a hardcoded dark value).
   This is a real token-system addition, not a recolor.
3. **A red/rose accent** replacing the current near-white/black button
   styling, and the broader Quiet Glass visual language (rounded cards, pill
   buttons, soft glass overlay) applied to the real components.
4. **Visibility controls that mean something on a live call** — an overlay
   opacity setting and a stealth mode that strips the overlay down to just
   the answer text, plus the growing-overlay interaction
   (Listening → Generating → Ready) wired to the REAL `LlmAdapter` seam
   (audit-01 step 17), proven with a mock adapter through a real IPC/render
   pipeline — not a real Gemini call, which stays explicitly out of scope.

**Explicitly OUT of scope**: an actual Gemini/LLM provider implementation
(Phase 4 proper — no API calls, no model string, `LlmAdapter` stays
interface-only with a mock backing this plan's tests). Packaging/installer
and transcript history persistence (Phase 5) are untouched. This plan does
not touch `CaptureSession`, `wlk-server.ts`, `whisper-livekit.ts`, the
context parser, or the transcript reducer's segment-identity logic — that
code was hardened in audit-01/02 and nothing here should regress it.

### Design source of truth
The published canvas (page "Veyra", artboard `Main.dc.html`) is the visual
spec. Copy its exact values, never re-derive from memory or round them:
- `--bg: oklch(98.2% 0.004 90)`, `--surface: oklch(100% 0 0)`,
  `--border: oklch(91% 0.006 90)`, `--text-1: oklch(24% 0.01 90)`,
  `--text-2: oklch(46% 0.012 90)`, `--text-3: oklch(64% 0.01 90)` (light
  palette).
- `--accent: oklch(56% 0.17 20)`, `--accent-soft: oklch(94% 0.035 20)`,
  `--accent-ink: oklch(32% 0.13 18)` (the red accent).
- Persona card: `border-radius:16px`, `padding:24px`. Pill buttons:
  `border-radius:9999px`. Visibility card's opacity slider and stealth
  toggle markup/copy. Overlay glass treatment:
  `background:oklch(100% 0 0 / 0.7..0.82)`, `backdrop-filter:blur(6px)`.
  Stealth state: no card, `background:oklch(100% 0 0 / 0.22)`, text at
  `oklch(24% 0.01 90 / 0.7)`.
- Dark palette: the app's EXISTING `--ev-c-*` values
  (`main.css`/`base.css`, unchanged) become the `data-theme="dark"` variant —
  they are not being redesigned, only re-scoped behind the toggle.
- Font: Inter (already loaded via system font stack + `@electron-toolkit`;
  no Google Fonts dependency needed — the design canvas used a Google Fonts
  link only because the canvas renders in a browser iframe with no local
  Inter; the Electron app should keep using its existing local font loading,
  do not add a network font dependency to the shipped app).

### Approach decisions (with rejected alternatives)
1. **Theme mechanism** — **A: `data-theme` attribute on `<html>`, CSS custom
   properties per theme (CHOSEN)** vs B: two separate stylesheets swapped at
   runtime. A matches the existing token structure (`--ev-c-*` variables
   already exist; light values just need their own scope) and has no FOUC
   risk since the attribute is set before first paint from a synchronously
   loaded settings value. B is more files and a load-order race for no
   benefit; rejected.
2. **Resume/doc text extraction** — **UNKNOWN, gated by step 1.** The plan's
   working assumption is a pure-JS library per file type (no native rebuild,
   same risk reasoning that rejected `better-sqlite3` in audit-01) — e.g. a
   PDF-text library and a DOCX-text library — but exact package names and
   current maintenance status are NOT verified as of this writing and must
   not be invented. Step 1 confirms real, current package names before
   anything depends on them.
3. **Persona storage** — **A: plain JSON under `userData`, no encryption
   (CHOSEN)** vs B: encrypt like the API key. Resume/JD/notes are not
   secret-tier the way an API key is (the same reasoning `settings-store.ts`
   already applies per-field — only `apiKey` is encrypted, `sttModel`/
   `audioDeviceId` are plaintext). B adds safeStorage complexity for no
   real protection benefit; rejected.
4. **Overlay opacity mechanism** — **A: `BrowserWindow.setOpacity()`
   (CHOSEN)** vs B: CSS `opacity` on the root element. A dims the WHOLE
   window including any native chrome and is the documented Electron API for
   this; B only dims rendered content and composites oddly with the
   existing glass `backdrop-filter`. Note: `setOpacity()` has WEAKER/no
   effect on some Linux window managers (Electron docs) — this is recorded
   as a platform caveat (same class as the existing macOS-loopback and
   Windows-only-scripts caveats already in this repo), not silently assumed
   to work everywhere.
5. **Answer-suggestion pipeline verification** — **A: a `VEYRA_TEST_SUGGESTIONS`
   env-gated mock stream through the REAL IPC/reducer/render path (CHOSEN)**
   vs B: hardcode sample text directly in the renderer for demo purposes. A
   mirrors the existing `VEYRA_TEST_AUDIO` seam exactly and proves the real
   pipeline (main broadcasts `SuggestionDelta` events, the renderer reducer
   accumulates them, the overlay grows) using a `MockLlmAdapter` that
   satisfies the real `LlmAdapter` interface — consistent with this
   codebase's "never fake it" discipline. B would prove nothing about the
   real wiring; rejected.

### Anti-hallucination registry (UNKNOWN / PENDING — do not invent)
- **PDF/DOCX text-extraction library names and current npm status: UNKNOWN.**
  Step 1 resolves this against real, current package registry data — do not
  assume any specific package name is still maintained or exists as
  remembered.
- **Linux `setOpacity()` behavior: UNKNOWN/PENDING**, same evidentiary bar as
  the existing macOS-loopback caveat — verify on whatever platform is
  available at build time, mark PENDING for platforms that can't be tested,
  never claim it works cross-platform without a real check.
- **Real Gemini/LLM behavior: OUT OF SCOPE.** `LlmAdapter` stays
  interface-only. No model string, no API call, anywhere in this plan.
- **Exact design values**: copied verbatim from the published canvas (see
  "Design source of truth" above) — a builder must re-open that artifact
  URL and read the real markup/CSS from `Main.dc.html`, not trust this
  plan's summary as the only source, since the summary may drift from the
  canvas if it's edited later.

## Steps

- [ ] 1. **Confirm real PDF/DOCX text-extraction libraries.** Research
  current (2026), actively-maintained, pure-JS (no native compile step) npm
  packages for extracting plain text from `.pdf` and `.docx` files,
  installable into `app/` without a native rebuild (same bar
  `better-sqlite3` failed in audit-01). Verify against the actual npm
  registry / package READMEs, not memory. Write findings to
  `state/persona-parsing-research.md`: package name, version, license,
  last-publish recency, confirmed pure-JS (no `node-gyp`/prebuilt-binary
  dependency). If no clean pure-JS option exists for one format, record that
  and pick the least-risk alternative (e.g., a WASM-based parser is
  acceptable if it needs no native rebuild; document the tradeoff). `.txt`
  and `.md` need no library — read directly. Commit. (needs: -)

- [ ] 2. **Theme tokens: light (new) + dark (existing, re-scoped).** In
  `app/src/renderer/src/assets/base.css`, split the current `:root` color
  block into `:root[data-theme="light"]` (the new palette — see "Design
  source of truth") and `:root[data-theme="dark"]` (the EXISTING `--ev-c-*`
  values, unchanged, just re-scoped under the attribute selector). Add a
  bare `:root` fallback equal to the light palette (light is default, so an
  unset attribute must still render correctly before hydration). `main.css`
  and every component's inline/class styles that reference `--ev-c-*`
  variables continue to work unchanged since the variable NAMES don't
  change, only which values populate them per theme. Verify: `npm run
  build` passes; visually inspect (via the `run` skill or a build+CDP
  screenshot, matching the method used in the audit-02 live-fire test) that
  `data-theme="light"` and `data-theme="dark"` both render legibly with
  correct contrast. Commit. (needs: -)

- [ ] 3. **Theme setting + toggle.** Extend `Settings`
  (`settings-reducer.ts`) with `theme: 'light' | 'dark'`, default `'light'`.
  Extend `settings-store.ts`'s `isSettings` validator and `load()`/`save()`
  to carry it through (plaintext, no encryption — approach decision 3's
  reasoning applies here too). On app boot, read the persisted theme BEFORE
  first paint (main process passes it via `additionalArguments` or the
  renderer reads it synchronously via a preload-exposed value, avoiding a
  flash of the wrong theme) and set `document.documentElement.dataset.theme`.
  Add the sun/moon toggle control (matching the canvas's pill-shaped
  light/dark switch) to the settings header, dispatching a theme change that
  updates the attribute live and persists via `saveSettings`. Tests:
  `settings-reducer.test.ts` gains the new action; `settings-store.test.ts`
  gains round-trip coverage for `theme`. Verify: `npm test`. Commit.
  (needs: 2)

- [ ] 4. **Red accent tokens + primary button restyle.** Add `--accent`,
  `--accent-soft`, `--accent-ink` to both theme scopes in `base.css` (light:
  the exact oklch triple from "Design source of truth"; dark: derive a
  dark-appropriate red at the same hue, e.g. adjust lightness for the dark
  surface — verify contrast, don't just reuse the light values verbatim).
  Restyle `.session-button` (Start/Stop), `.settings-save`, and
  `.transcript-copy`'s primary state in `main.css` to use `--accent`
  background with white/near-white text, matching the canvas exactly
  (secondary/outline actions like the design's "Regenerate" pattern use
  `--accent`-colored border + `--accent-ink` text on transparent, per how
  the canvas differentiates primary vs. secondary — see the published
  artifact for the exact treatment). Verify: build + visual check. Commit.
  (needs: 2)

- [ ] 5. **Restyle Settings screen to Quiet Glass.** Update
  `SettingsScreen.tsx` + `main.css`: rounded-16px cards (`border-radius`),
  the pill-shaped `session-chip`, and the persona-card visual treatment
  (border, padding, spacing) to match the canvas. Add the inline SVG icon
  set the canvas uses (brand mark, sun/moon, document, upload, eye-off) as
  small local React components or inline SVG constants — no icon font, no
  emoji, stroke-based per the design (already established in the canvas
  markup — copy the exact `<path>` data rather than redrawing). Verify:
  build + visual check against the canvas side by side. Commit. (needs: 3, 4)

- [ ] 6. **Restyle the overlay to the glass treatment.** Update
  `OverlayScreen.tsx`/`TranscriptPanel.tsx`'s overlay variant + `main.css`:
  translucent card (`background: oklch(100% 0 0 / 0.7)`,
  `backdrop-filter: blur(6px)`, rounded corners, soft shadow) replacing the
  current plain dark bar, for the existing Listening-equivalent state
  (partial/final transcript tail). The Generating/Ready glass states are
  built in step 16 once the answer pipeline exists; this step only carries
  the transcript-tail rendering into the new visual language so the overlay
  isn't visually inconsistent while steps 7-15 are in progress. Verify:
  build + visual check. Commit. (needs: 5)

- [ ] 7. **Persona storage.** New `src/main/persona/persona-store.ts`
  mirroring `settings-store.ts`'s shape: `PersonaData {resumeText: string,
  resumeFileName: string | null, jobDescription: string, notes: string,
  additionalDocs: Array<{fileName: string, text: string}>}`, JSON under
  `app.getPath('userData')/veyra-persona.json`, plaintext (approach decision
  3). `load()`/`save()` + `ipcMain.handle('persona:load'/'persona:save')`
  registered alongside the existing settings IPC registration. Tests
  `tests/persona-store.test.ts` mirroring `settings-store.test.ts`'s
  round-trip/corrupt-file/validation coverage. Verify: `npm test`. Commit.
  (needs: 1)

- [ ] 8. **File parsing pipeline.** `src/main/persona/parse-document.ts`:
  given an absolute file path, detect type by extension, extract plain text
  using step 1's confirmed libraries for `.pdf`/`.docx`, direct read for
  `.txt`/`.md`, and throw a clear "unsupported file type" error otherwise
  (never silently return empty text — a parse failure must be visible to
  the user, not a blank persona field). Tests with real small fixture files
  (a minimal `.pdf`, `.docx`, `.txt` committed under
  `app/tests/fixtures/persona/`) proving real extraction, not mocked
  library calls. Verify: `npm test`. Commit. (needs: 1)

- [ ] 9. **Resume + job description + notes UI.** New
  `src/renderer/src/persona/PersonaPanel.tsx` in the settings screen,
  styled per the canvas's "Your background" card: resume upload (Electron
  `dialog.showOpenDialog` via a new `window.api.pickFile()` bridge → main
  reads + parses via step 8 → `persona:save`), job description `<textarea>`,
  notes `<input>`, all persisted through step 7. Hydrate on mount (mirroring
  audit-01 step 11's settings-hydration pattern exactly — this is the same
  class of bug if skipped: don't ship a write-only persona panel). Tests:
  a `persona-reducer.ts` (if state gets non-trivial) or direct
  component-logic tests for hydration or save-error surfacing, matching the
  settings screen's test shape. Verify: `npm test`; manual round-trip
  (upload a real resume, restart, confirm it reloads) at step 18. Commit.
  (needs: 5, 7, 8)

- [ ] 10. **Additional-context files UI.** Extend `PersonaPanel.tsx` with
  the multi-file "Additional context (optional)" section per the canvas:
  a list of attached files (each removable) + an "Add a file" control
  (accent-outlined dashed button, matching the canvas exactly), each file
  going through step 8's parser and appended to `additionalDocs[]`. Tests:
  add/remove file updates persisted state correctly; a corrupt/unsupported
  file surfaces an error instead of silently dropping. Verify: `npm test`.
  Commit. (needs: 9)

- [ ] 11. **Assemble `PersonaContext` for future Phase-4 consumption.** A
  small pure function (`src/shared/stt/... ` or a new
  `src/shared/llm/persona-context.ts`) that maps `PersonaData` (step 7) to
  the existing `PersonaContext` type (`src/shared/types.ts`, declared in
  audit-01 step 17): `resume`, `jobDescription`, `notes` (as a one-element
  array or split on blank lines — pick one and document it), `docs` (the
  additional files' text). NOT wired to any LLM call — this only proves the
  real persona data can be shaped into the real interface Phase 4 will
  consume. Test: given fixture `PersonaData`, assert the mapped
  `PersonaContext` shape. Verify: `npm test`. Commit. (needs: 7)

- [ ] 12. **Overlay opacity setting.** Extend `Settings` +
  `settings-store.ts` with `overlayOpacity: number` (0-100, default e.g. 90 —
  NOT 65; the canvas's "65%" was illustrative copy for the mockup, pick a
  sane real default and document why). Add the opacity slider to a new
  "Visibility" card in `SettingsScreen.tsx`/`PersonaPanel.tsx` per the
  canvas (draggable handle, "Faint"/"Full" labels). On change, IPC to main
  (`ipcMain.handle('overlay:set-opacity')`) which calls
  `overlayWindow.setOpacity(value / 100)` (approach decision 4). Apply the
  persisted value on overlay window creation too (not just on live
  changes). Record the Linux caveat in a code comment + this plan's own
  verification note, per the anti-hallucination registry. Tests: reducer/
  store coverage for the new field. Verify: `npm test`; visual check at
  step 18 that dragging the slider actually dims the real overlay window.
  Commit. (needs: 5)

- [ ] 13. **Stealth mode setting.** Extend `Settings` +
  `settings-store.ts` with `stealthMode: boolean`, default `false`. Add the
  toggle to the Visibility card per the canvas (with its explanatory copy).
  Broadcast the setting to both windows the same way theme/session-state
  already broadcast (a `settings-changed` or reuse of an existing channel —
  pick whichever is more consistent with the existing IPC surface and
  document the choice). Tests: reducer/store coverage. Verify: `npm test`.
  Commit. (needs: 5)

- [ ] 14. **Stealth rendering.** `TranscriptPanel.tsx`'s overlay variant (and
  the future `AnswerPanel` from step 16) conditionally render the minimal
  "state 4" treatment from the canvas when `stealthMode` is true: no card
  background/border/shadow beyond the faint `oklch(100% 0 0 / 0.22)` wash,
  no icons, no labels, no buttons — just the text at reduced opacity
  (`oklch(24% 0.01 90 / 0.7)` in light, an equivalent dark-theme value).
  Normal mode (stealth off) keeps the full glass-card chrome from step 6.
  Tests: a rendering-logic test (e.g. a pure function mapping
  `{stealthMode, theme, content}` → the class/style variant) rather than a
  snapshot test, matching this codebase's existing preference for testing
  logic over markup. Verify: `npm test`; visual check both modes at step 18.
  Commit. (needs: 6, 13)

- [ ] 15. **Answer-suggestion IPC + reducer.** New `SUGGESTION_EVENT_CHANNEL`
  broadcast (mirroring `TRANSCRIPT_EVENT_CHANNEL`'s exact pattern in
  `src/shared/types.ts` and `transcript-broadcast.ts`) carrying
  `SuggestionDelta` events (the real type from audit-01 step 17's
  `llm-adapter.ts` — `{type:'delta', kind, textDelta}` |
  `{type:'complete', suggestion}`). New
  `src/renderer/src/transcript/answer-reducer.ts`: accumulates `delta`
  events into a growing string per in-flight suggestion, replaces with the
  final `Suggestion` object on `complete`, resets on a new suggestion
  starting. Tests: interleaved delta→delta→complete sequences produce the
  right accumulated text and terminal state; an abort mid-stream (no
  `complete` ever arrives) leaves the partial text visible rather than
  hanging or erroring. Verify: `npm test`. Commit. (needs: 1, per the LLM
  seam being audit-01 step 17's existing work — no new "needs" on this
  plan's own steps)

- [ ] 16. **Growing overlay UI.** New `AnswerPanel.tsx` (or extend
  `TranscriptPanel.tsx`'s overlay variant) rendering the answer-reducer's
  state through the THREE visible states from the canvas — Listening (no
  active suggestion: existing transcript tail from step 6), Generating
  (partial delta text, growing card height via CSS transition, the
  drafting-context micro-copy from the canvas), Ready (complete suggestion,
  full card with Copy/Regenerate buttons in the red accent per step 4) —
  plus step 14's stealth treatment as a fourth cross-cutting mode. Card
  height grows via a CSS `height`/`min-height` transition keyed to content
  length, not a hardcoded per-state jump, so it reads as continuous growth
  matching "windows progresses bigger as the answers are being generated."
  Verify: build + visual check with the step-17 mock seam feeding realistic
  delta pacing. Commit. (needs: 6, 14, 15)

- [ ] 17. **`VEYRA_TEST_SUGGESTIONS` verification seam.** Mirroring
  `VEYRA_TEST_AUDIO` exactly: when the env var is set (to a path naming a
  JSON fixture of canned `SuggestionDelta` events with per-event delay
  hints, or a simple built-in canned sequence if a fixture file is
  overkill — pick one and document it), main constructs a
  `MockLlmAdapter`-equivalent that emits those deltas through the REAL
  `SUGGESTION_EVENT_CHANNEL` broadcast on a timer, exercising the real
  reducer and the real `AnswerPanel` end to end. This is how step 16's
  growth interaction gets verified without a live Gemini call (approach
  decision 5) — it must NOT be reachable in a normal run (env-gated, same
  as the audio seam). Verify: run with the env var set, confirm via a
  build+CDP screenshot sequence (the same method used in the audit-02
  live-fire test) that the overlay visibly grows through
  Listening→Generating→Ready. Commit. (needs: 16)

- [ ] 18. **VERIFICATION GATE (human checkpoint).** Agent half: `npm test`,
  `npm run typecheck`, `npm run lint`, `npm run build` all clean; re-run the
  live-fire CDP-driven check from audit-02 (real app under Xvfb, fake mic
  audio) PLUS: toggle theme and screenshot both, upload a real fixture
  resume/JD and confirm reload-persistence, drag the opacity slider and
  confirm the overlay window's real opacity changed, toggle stealth mode
  and screenshot both renderings, run with `VEYRA_TEST_SUGGESTIONS` set and
  screenshot the three growth states. Write
  `state/phase3-quietglass-verify.md` with one PASS/FAIL line per check,
  same discipline as `state/audit-01-verify.md`. Human half (cannot be
  delegated, same rule as audit-01 step 18): a live call scenario — real
  resume/JD in Settings, Start listening, speak, confirm the persona
  actually feels reflected in what's shown (there's no real LLM yet, so
  this is really "confirm nothing about persona ingestion is broken and the
  new visual language doesn't get in the way of a live transcript"), confirm
  opacity and stealth mode both feel usable during an actual video call
  window layout, not just in isolation. Nothing here is claimed complete
  without that human record in `inbox/`. Commit. (needs: 9, 10, 12, 14, 17)

## Files Touched
- New (main): `src/main/persona/persona-store.ts`,
  `src/main/persona/parse-document.ts`
- New (renderer): `src/renderer/src/persona/PersonaPanel.tsx`,
  `src/renderer/src/transcript/answer-reducer.ts`,
  `src/renderer/src/transcript/AnswerPanel.tsx` (or the extended
  `TranscriptPanel.tsx`, per step 16's own call)
- New (shared): `src/shared/llm/persona-context.ts` (or wherever step 11
  lands it)
- New (tests): `tests/persona-store.test.ts`, `tests/parse-document.test.ts`,
  `tests/answer-reducer.test.ts`, plus reducer/store test extensions for
  `theme`, `overlayOpacity`, `stealthMode`
- New (fixtures): `app/tests/fixtures/persona/*.pdf/.docx/.txt`
- New (state): `state/persona-parsing-research.md`,
  `state/phase3-quietglass-verify.md`
- Modified: `base.css`, `main.css`, `settings-reducer.ts`,
  `settings-store.ts`, `SettingsScreen.tsx`, `SessionControls.tsx`,
  `TranscriptPanel.tsx`, `OverlayScreen.tsx`, `windows.ts` (opacity IPC
  handler), `preload/index.ts` + `index.d.ts` (new bridge methods),
  `src/main/index.ts` (new IPC registrations, `VEYRA_TEST_SUGGESTIONS`
  seam), `src/shared/types.ts` (new IPC channel constant if step 15 adds
  one)

## Requires Tools
git, node, npm — same as audit-01/02. Step 1's chosen libraries add npm
dependencies (pure-JS only, per approach decision 2 — no new native-rebuild
requirement, no new Python/venv requirement).

## Risks
- **This plan touches nearly every renderer file** (`SettingsScreen`,
  `SessionControls`, `TranscriptPanel`, `OverlayScreen`, both CSS files) —
  the highest regression surface of any plan on this project so far.
  Steps 2-6 (theme + accent + restyle) should be verified visually at EACH
  step, not just at the final gate, to catch a broken theme scope or a
  contrast failure before it compounds across later steps.
- **Step 1 is a hard external dependency.** If no acceptable pure-JS PDF or
  DOCX library is found, steps 8-10 need a fallback design (e.g., accept
  `.txt`/`.md` only for v1, or a WASM-based parser) — escalate to `inbox/`
  rather than forcing a native-rebuild dependency to unblock the plan.
- **Steps 15-17 build real plumbing for a feature with no real backend.**
  This is intentional (approach decision 5) but means the "Generating/Ready"
  states can ONLY be exercised via the test seam until Phase 4 exists — do
  not let this plan's verification gate quietly skip that seam and call the
  feature done on the strength of steps 1-14 alone.
- **Default values matter**: `overlayOpacity` default and `stealthMode`
  default (false) should not make the app LESS usable out of the box for
  someone who hasn't read about the stealth feature — verify the default
  overlay is fully legible, matching audit-01/02's existing bar for what a
  first-run experience should look like.
- **Budget** (`config/budget.yml`): same caps as before — one step, one
  dispatch, `max_retries` before `inbox/` escalation. Given this plan's size
  (18 steps across UI, storage, and IPC), expect steps 5, 9, and 16 to be
  the most likely candidates for a second dispatch.

## Done Criteria
Every criterion is a command, a file, or a screenshot — not vibes.

1. `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all
   exit 0; test count exceeds the audit-02 baseline of 221.
2. `grep -n "data-theme" app/src/renderer/src/assets/base.css` shows both
   `light` and `dark` scopes defined with real (non-placeholder) values.
3. A real resume file uploaded through the running app is readable back
   from `veyra-persona.json` under `userData` after an app restart.
4. `state/persona-parsing-research.md` names real, verified library
   packages (or documents the fallback decision) — not invented ones.
5. Dragging the opacity slider in a running app measurably changes the
   overlay `BrowserWindow`'s actual opacity (verified via a screenshot pair
   or the Electron API's own readback, not just "the code looks right").
6. Toggling stealth mode changes the overlay's rendered DOM/CSS to the
   minimal treatment — verified via a screenshot pair, light and dark.
7. Running with `VEYRA_TEST_SUGGESTIONS` set produces a visible,
   screenshotted Listening → Generating → Ready progression in the real
   overlay window, through the real IPC/reducer pipeline.
8. `state/phase3-quietglass-verify.md` lists every check above with
   PASS/FAIL.
9. Human checkpoint recorded in `inbox/`, per audit-01's own rule: this
   plan is NOT complete without it, regardless of how green the automated
   checks are.
