# macOS loopback capture (BlackHole) — PENDING

Status: **PENDING** — this machine is win32; this document is the plan's macOS
path (plan step 19), written from the plan text only and NOT verified here. Do
not attempt on this machine; verify on a real macOS host before claiming it
works (anti-hallucination registry: PENDING, do not invent).

## Why this exists

On Windows, Electron 39 captures system audio natively (getDisplayMedia audio
+ WASAPI loopback; see app/src/renderer/src/capture/loopback-capture.ts). On
macOS the same getDisplayMedia path captures what the default *output* device
renders, but macOS has no loopback device by default — so system audio must
first be routed into a virtual output that loopback capture can see. The
one-time setup below installs and configures that virtual device.

## One-time setup (per Mac)

1. Install BlackHole 2ch (the 2-channel driver; the free virtual audio
   loopback driver):
   ```bash
   brew install blackhole-2ch
   ```
   (Requires Homebrew; the package installs a Core Audio driver and may need a
   logout/login or reboot to appear in the audio device list.)

2. Open **Audio MIDI Setup** (Applications > Utilities, or Spotlight "Audio
   MIDI Setup").

3. Create a **Multi-Output Device**:
   - Click the `+` in the bottom-left, choose *Create Multi-Output Device*.
   - Tick **Speakers** (or the physical output) AND **BlackHole 2ch**.
   - This routes the same mix to your speakers AND to BlackHole, so you can
     hear system audio while the app captures it.

4. Set the Multi-Output Device as the **default output device** (right-click >
   *Use This Device For Sound Output*, or System Settings > Sound > Output).

5. Grant the app permissions when macOS prompts (first run):
   - **Microphone** permission (system audio capture routes through the
     audio-capture permission in Electron).
   - **Screen Recording** permission may also be required for getDisplayMedia
     (System Settings > Privacy & Security).

## Teardown (optional)

```bash
brew uninstall blackhole-2ch
```
And delete the Multi-Output Device in Audio MIDI Setup.

## Verification (once on a Mac)

Run scripts/check-loopback.ps1's equivalent capture flow on macOS and confirm
energy is captured; until then this document and the macOS path stay PENDING.