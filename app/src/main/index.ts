import { app, BrowserWindow, desktopCapturer, ipcMain, session } from 'electron'
import { writeFileSync } from 'fs'
import { resolve } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow, createOverlayWindow } from './windows'
import { registerIpcHandlers } from './settings-store'
import { createPcmSink, feedWavToAdapter, toFiniteFloat32 } from './capture/audio-input'
import {
  computeRms,
  energyCapturedFor,
  writeLoopbackCheck
} from './capture/loopback-energy'
import { createSttAdapter } from '../shared/stt/stt-adapter'
import { labelForSource } from '../shared/stt/speaker-label'
import type { TranscriptEvent } from '../shared/types'
import { broadcastTranscriptEvent } from './transcript/transcript-broadcast'
import { float32ToInt16 } from '../shared/audio/format'

// Step 18: the two windows, held at module scope so the capture bridge can
// broadcast transcript events to BOTH (see broadcastTranscript below).
let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null

function broadcastTranscript(event: TranscriptEvent): void {
  broadcastTranscriptEvent([mainWindow, overlayWindow], event)
}

/**
 * Smoke mode (env VEYRA_SMOKE=1): once both windows are ready, wait 1500ms,
 * write {mainWindow:{title,alwaysOnTop}, overlayWindow:{title,alwaysOnTop,bounds}}
 * to VEYRA_SMOKE_OUT (default state/phase1-launch.json, resolved against cwd),
 * then quit — the run is self-terminating.
 */
function armSmoke(mainWindow: BrowserWindow, overlay: BrowserWindow): void {
  let mainReady = false
  let overlayReady = false

  const finish = (): void => {
    if (!mainReady || !overlayReady) return
    setTimeout(() => {
      const payload = {
        mainWindow: {
          title: mainWindow.getTitle(),
          alwaysOnTop: mainWindow.isAlwaysOnTop()
        },
        overlayWindow: {
          title: overlay.getTitle(),
          alwaysOnTop: overlay.isAlwaysOnTop(),
          bounds: overlay.getBounds()
        }
      }
      const out = process.env['VEYRA_SMOKE_OUT'] ?? 'state/phase1-launch.json'
      writeFileSync(resolve(process.cwd(), out), JSON.stringify(payload, null, 2))
      app.quit()
    }, 1500)
  }

  mainWindow.once('ready-to-show', () => {
    mainReady = true
    finish()
  })
  overlay.once('ready-to-show', () => {
    overlayReady = true
    finish()
  })
}

function launchWindows(): void {
  mainWindow = createMainWindow()
  overlayWindow = createOverlayWindow()
  if (process.env['VEYRA_SMOKE'] === '1') armSmoke(mainWindow, overlayWindow)
}

/**
 * Step 17 capture bridge. Two jobs, both routed through the SAME adapter.send
 * path (the step-16 WhisperLiveKitSttAdapter s16le framing):
 *  1. 'pcm' IPC handler: renderer mic chunks (16 kHz Float32Array) -> validated
 *     -> float32ToInt16 -> adapter.send. The renderer is a trust boundary, so
 *     the sink throws on malformed chunks; the error is logged, never swallowed
 *     silently and never allowed to crash the main process.
 *  2. VEYRA_TEST_AUDIO seam (steps 21-22): when the env var names a WAV path,
 *     that file is fed through adapter.send instead of renderer PCM.
 */
async function startCaptureBridge(): Promise<void> {
  const adapter = createSttAdapter('local-whisperlivekit')
  const sink = createPcmSink(adapter)
  ipcMain.on('pcm', (_event, chunk: unknown) => {
    try {
      sink(chunk)
    } catch (err) {
      console.error('[capture] rejected PCM chunk:', err instanceof Error ? err.message : err)
    }
  })

  // Step 18: adapter transcript events -> 'transcript-event' to BOTH windows.
  // The source tag is the capture track (this bridge is the step-17 mic track;
  // step 19 adds the loopback track as its own adapter + source).
  // Step 20: labelForSource maps the capture track to the speaker label before
  // broadcast ('mic' -> 'me'). The reducer also defaults an absent speaker, but
  // main never leaves it absent on this path.
  const source: TranscriptEvent['source'] = 'mic'
  const speaker: TranscriptEvent['speaker'] = labelForSource(source)
  adapter.onPartial((text, seq) => {
    broadcastTranscript({ source, speaker, kind: 'partial', text, seq, ts: Date.now() })
  })
  adapter.onFinal((text, seq) => {
    broadcastTranscript({ source, speaker, kind: 'final', text, seq, ts: Date.now() })
  })
  adapter.onError((err) => {
    console.error('[capture] STT adapter error:', err)
  })

  const testAudio = process.env['VEYRA_TEST_AUDIO']
  if (testAudio) {
    try {
      await adapter.connect()
      const { samples, chunks } = await feedWavToAdapter(testAudio, adapter)
      await adapter.close()
      console.log(
        `[capture] VEYRA_TEST_AUDIO: fed ${samples} samples in ${chunks} chunks from ${testAudio}`
      )
    } catch (err) {
      console.error('[capture] VEYRA_TEST_AUDIO failed:', err instanceof Error ? err.message : err)
    }
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.veyra.app')

  registerIpcHandlers()
  registerDisplayMediaHandler()
  if (process.env['VEYRA_LOOPBACK_CHECK'] === '1') {
    // Step 19 verification (scripts/check-loopback.ps1): capture loopback,
    // measure RMS, write state/loopback-check.json, quit. The wlk adapters are
    // NOT started here -- the check is raw-PCM energy, no transcription.
    void startLoopbackCheck()
  } else {
    void startCaptureBridge()
    void startLoopbackBridge()
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  launchWindows()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) launchWindows()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

/**
 * Step 19, README-followed (electron-audio-loopback README -> Electron 39
 * native path; see loopback-capture.ts header for the citation): the plugin is
 * for Electron 31-39; on 39.8.10 system audio comes from getDisplayMedia
 * audio resolved by this handler (the @chrhartm/electron-mic-speaker-loop
 * pattern the README points 39+ users at). The handler auto-supplies the first
 * screen source -- the renderer discards the video tracks immediately -- plus
 * 'loopback' audio, so loopback capture never shows the native picker.
 * Security note: only OUR local renderer content runs in these windows
 * (contextIsolation, no remote loads), so auto-approving display media does
 * not widen an attacker's surface; the renderer already receives screen
 * sources only when it asks.
 */
function registerDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      if (sources.length === 0) {
        callback({}) // no screen source: omit both streams (the renderer's request fails cleanly)
        return
      }
      callback({ video: sources[0], audio: 'loopback' })
    } catch (err) {
      console.error('[loopback] getSources failed:', err instanceof Error ? err.message : err)
      callback({})
    }
  })
}

/**
 * Step 19 loopback bridge -- the dual-track SECOND wlk session (plan decision
 * 6). Mirror of startCaptureBridge (step 17/18): 'pcm-loopback' IPC chunks ->
 * the SAME createPcmSink validation -> a SECOND adapter instance from the
 * factory (createSttAdapter builds a fresh lazy facade per call, and
 * WhisperLiveKitSttAdapter keeps all state per-instance -- verified in
 * tests/whisper-livekit.test.ts), whose events are tagged source 'loopback' at
 * this capture site (same pattern as the mic bridge's 'mic' tag) and
 * broadcast to BOTH windows.
 *
 * The two adapters both connect to ws://127.0.0.1:8000/asr. Whether wlk
 * accepts two CONCURRENT WS sessions is UNKNOWN (plan risk, recorded); the
 * adapter layer supports two instances; if the server rejects the second
 * session at runtime the plan's fallback (merged single stream) is recorded in
 * state/phase2-demo.json by step 21 -- not resolved in this step because the
 * step-19 verification is raw-PCM energy and never touches wlk.
 */
function startLoopbackBridge(): void {
  const adapter = createSttAdapter('local-whisperlivekit')
  const sink = createPcmSink(adapter)
  ipcMain.on('pcm-loopback', (_event, chunk: unknown) => {
    try {
      sink(chunk)
    } catch (err) {
      console.error('[loopback] rejected PCM chunk:', err instanceof Error ? err.message : err)
    }
  })

  // Step 20: same labeling as the mic bridge, mapping 'loopback' -> 'other'.
  const source: TranscriptEvent['source'] = 'loopback'
  const speaker: TranscriptEvent['speaker'] = labelForSource(source)
  adapter.onPartial((text, seq) => {
    broadcastTranscript({ source, speaker, kind: 'partial', text, seq, ts: Date.now() })
  })
  adapter.onFinal((text, seq) => {
    broadcastTranscript({ source, speaker, kind: 'final', text, seq, ts: Date.now() })
  })
  adapter.onError((err) => {
    console.error('[loopback] STT adapter error:', err)
  })
}

/**
 * Step 19 verification mode (env VEYRA_LOOPBACK_CHECK=1, driven by
 * scripts/check-loopback.ps1): accumulate 'pcm-loopback' chunks through the
 * SAME trust-boundary validator as the mic sink, and LOOPBACK_CHECK_CAPTURE_MS
 * after the first chunk compute the full-scale RMS, write the verdict to
 * VEYRA_LOOPBACK_CHECK_OUT (default state/loopback-check.json), and quit. A
 * hard timeout writes an error verdict so the check script can never hang.
 */
const LOOPBACK_CHECK_CAPTURE_MS = 8000

function startLoopbackCheck(): void {
  const out = process.env['VEYRA_LOOPBACK_CHECK_OUT'] ?? 'state/loopback-check.json'
  const chunks: Int16Array[] = []
  let startedAt = 0
  let finished = false
  let captureTimer: NodeJS.Timeout | null = null

  const finish = (error?: string): void => {
    if (finished) return
    finished = true
    if (captureTimer) clearTimeout(captureTimer)
    const samples = chunks.reduce((n, c) => n + c.length, 0)
    const joined = new Int16Array(samples)
    let off = 0
    for (const c of chunks) {
      joined.set(c, off)
      off += c.length
    }
    const rms = computeRms(joined)
    try {
      writeLoopbackCheck(resolve(process.cwd(), out), {
        energyCaptured: energyCapturedFor(rms),
        rms,
        samples,
        durationMs: startedAt > 0 ? Date.now() - startedAt : 0,
        ...(error ? { error } : {})
      })
    } catch (err) {
      console.error('[loopback-check] write failed:', err instanceof Error ? err.message : err)
    }
    app.quit()
  }

  ipcMain.on('pcm-loopback', (_event, chunk: unknown) => {
    if (finished) return
    try {
      const f32 = toFiniteFloat32(chunk) // trust boundary: renderer is untrusted
      chunks.push(float32ToInt16(f32))
      if (chunks.length === 1) {
        startedAt = Date.now()
        captureTimer = setTimeout(() => finish(), LOOPBACK_CHECK_CAPTURE_MS)
      }
    } catch (err) {
      console.error('[loopback-check] rejected chunk:', err instanceof Error ? err.message : err)
    }
  })

  // Hard stop: the check script polls the JSON; never let it hang on us.
  setTimeout(() => finish('timeout'), LOOPBACK_CHECK_CAPTURE_MS + 30_000)
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
