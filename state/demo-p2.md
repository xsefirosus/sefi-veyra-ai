# VEYRA Phase 2 — Live Demo Script (human-facing)

Run this on the demo machine (Windows, PowerShell). This is the FIRST live-mic
test of the app: the loopback path was verified with a synthetic 440 Hz tone
(energy check, `state/loopback-check.json`) and mic transcription was verified
by feeding the test WAV through the same adapter path (`state/phase2-demo.json`)
— a real human speaking into a real mic has not been exercised yet.

## 1. Start the app

From the repo root:

```powershell
cd app
npm run dev
```

Two windows appear:

- **Main window** (1100x760, title `VEYRA`) — the settings screen.
- **Overlay** (640x120, frameless, always on top, bottom of the screen) —
  shows `Listening…` until audio arrives.

> STT model defaults to `tiny`. Want better accuracy? In the settings screen,
> pick `base` or `small` and Save **before** starting the demo (the change
> takes effect on the next app launch — the wlk server is started at boot).

## 2. Check the settings screen (main window)

- Header reads **VEYRA**.
- **Gemini API key** — password field (paste a key; it is stored encrypted via
  Windows DPAPI in `userData`, never plaintext, never logged).
- **STT model** — select: `tiny` / `base` / `small`.
- **Audio device** — select: `System default`, your mic(s), and
  `System audio (loopback)`.
- **Save** button — click it to persist.

## 3. Speak — check `me` lines in the overlay

1. In the settings screen, pick your mic (or `System default`) and Save.
2. Windows will ask for microphone permission — **Allow**.
3. Speak normally ("Testing one two three…").

What you should see in the **overlay** (and the transcript panel in the main
window):

- **Partials** appear while you speak — italic/grey, live-revising.
- **Finals** appear a moment later — solid text.
- Each line carries the speaker tag **`me`**.

## 4. Play system audio — check `other` lines

1. Start any audio on the machine (YouTube, a local player, the Windows
   "Test" sound).
2. The loopback capture (dual-track with the mic) transcribes it in the same
   overlay.

What you should see: lines tagged **`other`** appearing alongside your mic
lines. If no `other` lines appear, check that "System audio (loopback)" is the
selected device and the sound is actually playing (the loopback energy path
itself was verified with a tone — see `state/loopback-check.json`).

## 5. What "done" looks like

- Overlay shows live partials → finals for your voice, tagged `me`.
- System audio produces `other`-tagged lines.
- Settings screen shows the VEYRA header, Gemini API key field, and the
  model/device selects, and Save persists.

## Verified numbers for this pass (step 22, 2026-08-20)

Re-ran the step-21 e2e harness (real wlk `tiny`, real test WAV through the
same `adapter.send(int16)` path, loopback merged from `state/loopback-check.json`):

| Assert | Result |
|---|---|
| partials >= 1 | 24 (PASS; step-21 run: 23, delta +1) |
| finals >= 1 | 46 (PASS; step-21 run: 45, delta +1) |
| firstPartialMs < 2000 | 1682 (PASS; step-21 run: 1552, delta +130) |
| loopbackEnergyCaptured === true | true (PASS; unchanged) |

`labelsSeen = ["me"]`. `state/latency-p2.json` written with `pass: true`
(1682 ms < 2000 ms). Model-load time variance explains the small delta between
runs; both runs pass the sub-2s criterion.