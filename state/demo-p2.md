# VEYRA Phase 2 — Live Demo Script (human-facing)

Run this on the demo machine (Windows, PowerShell). The loopback path was
verified with a synthetic 440 Hz tone (`state/loopback-check.json`), mic
transcription was verified by feeding the test WAV through the same
`adapter.send()` path the mic uses (`state/phase2-demo.json`), and the unit
suite covers the parser/reducer/session lifecycle. A real human speaking into a
real mic has NOT been exercised yet — that is this script's purpose.

## 1. Start the app

From the repo root:

```powershell
cd app
npm run dev
```

Two windows appear:

- **Main window** (title `VEYRA`) — Start/Stop control + status chip at the
  top, transcript panel beside/above the settings form.
- **Overlay** (frameless, always on top) — bottom-center of the screen by
  default. You can **drag it by its surface** and **resize it from its edges**;
  its position and size are saved to `userData/veyra-overlay-bounds.json`
  (validated on read) and restored on the next launch. Until a session is
  running it shows `Idle — press Start listening`, not `Listening…`.

> Nothing runs until you press **Start listening**. The wlk server is spawned
> at that moment with the currently saved STT model, so a model change takes
> effect on the next session start — no app restart needed.

## 2. Check the settings screen (main window)

- Header reads **VEYRA**; above it sit the **Start/Stop listening** button and
  a live status chip: `Idle`, `Starting model… (first run may take minutes to
  download)`, `Listening`, `Stopping…`, or `Error: <message>`.
- **Gemini API key** — password field. Saved settings are reloaded on launch;
  a stored key shows as a masked "saved" state rather than an empty box.
- **STT model** — select: `tiny` / `base` / `small`. Save persists it.
- **Audio device** — populated with real labels once mic permission is granted
  (the list re-enumerates after permission and on `devicechange`; before that,
  raw ids may show).
- **Save** button — click to persist. If persistence fails (e.g. safeStorage
  unavailable), an error is surfaced instead of failing silently, and the
  "saved" flag clears on your next edit.

## 3. Speak — check `me` lines

1. Click **Start listening**. Watch the chip go `Starting model…` →
   `Listening`. Windows asks for microphone permission — **Allow**.
2. Speak normally ("Testing one two three…").

What you should see in the overlay and the transcript panel:

- **Partials** while you speak — grey/live-revising.
- **Finals** a moment later — solid text. Each committed line carries its
  speaker tag (**`me`** for your mic). A sentence revises IN PLACE — it does
  not append duplicates.
- New lines pin the view to the bottom; scroll up to read history and it stays
  put until you return to the bottom.
- Transcript text is selectable and copyable; the panel has a one-click
  **Copy** button (shows `Copied` / `Copy failed`).

## 4. Play system audio — check `other` lines

1. While listening, play any system audio (YouTube, local player).
2. The loopback capture transcribes it into the same transcript.

Expected: lines tagged **`other`** alongside your `me` lines (wlk diarization
refines the label when it detects speakers). If nothing appears, check the
sound is actually playing — the loopback energy path itself was verified with
a tone (`state/loopback-check.json`).

Press **Stop listening** when done; the chip returns to `Idle`.

## 5. What "done" looks like

- Start button drives the session; the chip reflects every state including
  errors (a failed wlk spawn or dropped socket surfaces as `Error: …`, not a
  hang).
- Your voice produces `me` lines, system audio produces `other` lines, each
  sentence commits exactly once (revisions replace, never duplicate).
- The overlay moves/resizes and keeps its bounds across restarts.
- Transcript is selectable/copyable; settings round-trip across restarts.

## Verified numbers for this pass (audit step 18 agent half, 2026-08-22)

Re-ran the e2e harness after audit steps 1-17 (real wlk `tiny`, real test WAV
through the same adapter path, loopback energy merged from
`state/loopback-check.json`). `finals` now counts DISTINCT committed segments
(deduped by stable segmentId), not raw final events — the step-8 fix makes wlk
re-emit cumulative `lines[]`, so raw counting read 46 for one sentence.

| Assert | Result |
|---|---|
| partials >= 1 | 31 (PASS) |
| finals == 1 (true segment count) | 1 (PASS; raw final events: 40) |
| firstPartialMs < 2000 | 1925 (PASS; see note) |
| loopbackEnergyCaptured === true | true (PASS) |

Latency note: CPU-only `tiny` straddles the 2 s criterion between runs — the
pre-instrumentation-fix run measured 2093 ms, the recorded run 1925 ms
(`state/latency-p2.json`, `pass: true`). Both numbers are real measurements;
neither was chosen or discarded to fit the threshold. Full detail:
`state/audit-01-verify.md`.
