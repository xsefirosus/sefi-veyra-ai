import { app, BrowserWindow, desktopCapturer, ipcMain, session } from 'electron'
import { writeFileSync } from 'fs'
import { resolve } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow, createOverlayWindow } from './windows'
import { registerIpcHandlers } from './settings-store'
import { registerIpcHandlers as registerPersonaHandlers } from './persona/persona-store'
import { registerDialogHandler } from './persona/dialog'
import { createPcmSink, feedWavToAdapter, toFiniteFloat32 } from './capture/audio-input'
import { computeRms, energyCapturedFor, writeLoopbackCheck } from './capture/loopback-energy'
import { CaptureSession } from './capture/capture-session'
import { WLK_START_TIMEOUT_MS } from './stt/wlk-server'
import { createSttAdapter } from '../shared/stt/stt-adapter'
import { labelForSource } from '../shared/stt/speaker-label'
import type { TranscriptEvent } from '../shared/types'
import {
  adapterEventToTranscriptEvent,
  broadcastTranscriptEvent
} from './transcript/transcript-broadcast'
import { handleTestSuggestions } from './llm/mock-suggestions'
import { float32ToInt16 } from '../shared/audio/format'

// Step 18: the two windows, held at module scope so the capture bridge can
// broadcast transcript events to BOTH (see broadcastTranscript below).
let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null

function broadcastTranscript(event: TranscriptEvent): void {
  broadcastTranscriptEvent([mainWindow, overlayWindow], event)
}

// Step 3: CaptureSession owns the full ordered lifecycle (wlk spawn -> adapter
// connect -> capture start -> teardown). One state machine
// idle|starting|listening|stopping|error that both windows observe on
// 'session-state'.
let captureSession: CaptureSession | null = null
let micSink: ((chunk: unknown) => void) | null = null
let loopbackSink: ((chunk: unknown) => void) | null = null

const SESSION_STATE_CHANNEL = 'session-state'
const NOT_LISTENING_WARN_THROTTLE_MS = 2000
let lastNotListeningWarnMs = 0

function warnNotListening(source: string): void {
  const now = Date.now()
  if (now - lastNotListeningWarnMs > NOT_LISTENING_WARN_THROTTLE_MS) {
    lastNotListeningWarnMs = now
    console.warn(
      `[capture] pcm ${source} dropped: session not listening (state=${captureSession?.state ?? 'idle'})`
    )
  }
}

function broadcastSessionState(): void {
  const state = captureSession?.state ?? 'idle'
  const lastError = captureSession?.lastError?.message ?? null
  const payload = { state, lastError }
  for (const w of [mainWindow, overlayWindow] as const) {
    if (w && !w.isDestroyed()) {
      w.webContents.send(SESSION_STATE_CHANNEL, payload)
    }
  }
}

function ensureCaptureSession(): CaptureSession {
  if (captureSession) return captureSession
  captureSession = new CaptureSession()
  captureSession.onStateChange(() => broadcastSessionState())
  return captureSession
}

function wireAdapterEvents(
  adapter: {
    onPartial?: (cb: (text: string, seq: number, segmentId?: string) => void) => void
    onFinal?: (cb: (text: string, seq: number, segmentId?: string) => void) => void
  },
  source: TranscriptEvent['source']
): void {
  const speaker = labelForSource(source)
  // Audit step 8 fix (see transcript-broadcast.ts header): use the adapter's
  // REAL segmentId, not a source:seq fabrication -- that fake id is what
  // silently broke the duplicate/lost-final-segment fix on this wiring.
  adapter.onPartial?.((text, seq, segmentId) => {
    broadcastTranscript(
      adapterEventToTranscriptEvent(source, speaker, 'partial', text, seq, segmentId)
    )
  })
  adapter.onFinal?.((text, seq, segmentId) => {
    broadcastTranscript(
      adapterEventToTranscriptEvent(source, speaker, 'final', text, seq, segmentId)
    )
  })
  // Audit step 12: adapter errors are NOT wired here. CaptureSession
  // registered its own onError at start() and routes failures into the state
  // machine (fail() -> 'error' + lastError -> broadcastSessionState), and
  // WhisperLiveKitSttAdapter.onError is a single slot -- registering here
  // would clobber that routing and swallow the error into this callback again.
}

function wireSessionAdapters(session: CaptureSession): void {
  micSink = null
  loopbackSink = null
  const mic = session.micAdapter
  const loopback = session.loopbackAdapter
  if (mic) {
    // Cast to include SttAdapter surface for createPcmSink
    micSink = createPcmSink(mic as unknown as Parameters<typeof createPcmSink>[0])
    wireAdapterEvents(mic, 'mic')
  }
  if (loopback) {
    loopbackSink = createPcmSink(loopback as unknown as Parameters<typeof createPcmSink>[0])
    wireAdapterEvents(loopback, 'loopback')
  }
}

function setupPcmHandlers(): void {
  ipcMain.on('pcm', (_event, chunk: unknown) => {
    if (!captureSession || captureSession.state !== 'listening' || !micSink) {
      warnNotListening('mic')
      return
    }
    try {
      micSink(chunk)
    } catch (err) {
      console.error('[capture] rejected PCM chunk:', err instanceof Error ? err.message : err)
    }
  })

  ipcMain.on('pcm-loopback', (_event, chunk: unknown) => {
    if (!captureSession || captureSession.state !== 'listening' || !loopbackSink) {
      warnNotListening('loopback')
      return
    }
    try {
      loopbackSink(chunk)
    } catch (err) {
      console.error('[loopback] rejected PCM chunk:', err instanceof Error ? err.message : err)
    }
  })
}

function setupSessionIpc(): void {
  const session = ensureCaptureSession()
  // Defensive handler timeout: WLK_START_TIMEOUT_MS (300s) is the server's own
  // deadline, but the handler must ALWAYS settle even if a lower layer hangs
  // (stuck WebSocket, stuck adapter.connect). Add a buffer so the server's
  // own rejection wins when it fires, but a stuck promise cannot produce
  // "reply was never sent" -- the renderer always gets a settlement.
  // Derived: 300_000 + 5_000 = 305_000 -- stays proportional to any future
  // WLK_START_TIMEOUT_MS change by construction.
  const HANDLER_TIMEOUT_MS = WLK_START_TIMEOUT_MS + 5_000

  ipcMain.handle('session:start', async (_event, settings: unknown) => {
    // Trust boundary: validate settings shape before delegating
    const s = settings as { sttModel?: unknown }
    if (!s || typeof s.sttModel !== 'string') {
      throw new Error('session:start: settings.sttModel is required')
    }
    if (
      s.sttModel !== 'tiny' &&
      s.sttModel !== 'base' &&
      s.sttModel !== 'small' &&
      s.sttModel !== 'medium' &&
      s.sttModel !== 'large-v3'
    ) {
      throw new Error(`session:start: unsupported sttModel "${String(s.sttModel)}"`)
    }
    // sefi: handler-level watchdog -- ceiling is HANDLER_TIMEOUT_MS, upgrade path
    // is to surface progress (download %) instead of a hard timeout.
    const startTask = (async (): Promise<{ state: string; lastError: null }> => {
      await session.start(s as { sttModel: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3' })
      wireSessionAdapters(session)
      broadcastSessionState()
      return { state: session.state, lastError: null }
    })()
    const timeoutTask = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `session:start timed out after ${HANDLER_TIMEOUT_MS}ms waiting for wlk (model download may take minutes; check logs or retry)`
            )
          ),
        HANDLER_TIMEOUT_MS
      )
    })
    try {
      return await Promise.race([startTask, timeoutTask])
    } catch (err) {
      // If the race timed out, best-effort teardown so the chip can leave
      // STARTING and Stop remains usable (captureSession.stop is idempotent
      // and safe from any state). If startTask later settles, its catch already
      // transitions to error and broadcasts; this teardown does not interfere.
      if (err instanceof Error && err.message.includes('timed out after')) {
        try {
          await session.stop()
        } catch {
          // teardown is best-effort; the error is already being surfaced
        }
      }
      broadcastSessionState()
      throw err
    }
  })

  ipcMain.handle('session:stop', async () => {
    if (!captureSession) return { state: 'idle', lastError: null }
    try {
      await captureSession.stop()
      micSink = null
      loopbackSink = null
      broadcastSessionState()
      return { state: captureSession.state, lastError: null }
    } catch (err) {
      broadcastSessionState()
      throw err
    }
  })

  ipcMain.handle('session:state', async () => {
    return {
      state: captureSession?.state ?? 'idle',
      lastError: captureSession?.lastError?.message ?? null
    }
  })
}

/**
 * VEYRA_TEST_AUDIO seam (steps 21-22): when the env var names a WAV path,
 * that file is fed through adapter.send instead of renderer PCM. Kept
 * unchanged from the step-17 bridge so the harness path does not regress.
 * Independent of the CaptureSession (own adapter, own lifecycle).
 */
async function handleTestAudio(): Promise<void> {
  const testAudio = process.env['VEYRA_TEST_AUDIO']
  if (!testAudio) return
  const adapter = createSttAdapter('local-whisperlivekit')
  const source: TranscriptEvent['source'] = 'mic'
  const speaker: TranscriptEvent['speaker'] = labelForSource(source)
  // Audit step 8 fix -- same defect and same fix as wireAdapterEvents above:
  // use the adapter's real segmentId, not a source:seq fabrication.
  adapter.onPartial((text, seq, segmentId) => {
    broadcastTranscript(
      adapterEventToTranscriptEvent(source, speaker, 'partial', text, seq, segmentId)
    )
  })
  adapter.onFinal((text, seq, segmentId) => {
    broadcastTranscript(
      adapterEventToTranscriptEvent(source, speaker, 'final', text, seq, segmentId)
    )
  })
  adapter.onError((err) => {
    console.error('[capture] STT adapter error:', err)
  })
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

function setupOverlayOpacityIpc(): void {
  // Step 12: Visibility slider -> main -> BrowserWindow.setOpacity(value/100).
  // Trust boundary: renderer is untrusted; validate 0-100 integer.
  // Linux caveat: BrowserWindow.setOpacity() has weaker/no effect on some Linux
  // window managers (Electron docs). This is a platform caveat, not a bug — same
  // class as the existing macOS-loopback and Windows-only-scripts caveats. The
  // call is still made; the WM may ignore it.
  ipcMain.handle('overlay:set-opacity', (_event, value: unknown): number => {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 100
    ) {
      throw new Error('overlay:set-opacity payload failed validation: expected integer 0-100')
    }
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      try {
        overlayWindow.setOpacity(value / 100)
      } catch (err) {
        console.warn(
          '[overlay] setOpacity failed:',
          err instanceof Error ? err.message : String(err)
        )
      }
    }
    return value
  })
}

function launchWindows(): void {
  mainWindow = createMainWindow()
  overlayWindow = createOverlayWindow()
  if (process.env['VEYRA_SMOKE'] === '1') armSmoke(mainWindow, overlayWindow)
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.veyra.app')

  registerIpcHandlers()
  registerPersonaHandlers()
  registerDialogHandler()
  registerDisplayMediaHandler()
  setupOverlayOpacityIpc()
  if (process.env['VEYRA_LOOPBACK_CHECK'] === '1') {
    // Step 19 verification (scripts/check-loopback.ps1): capture loopback,
    // measure RMS, write state/loopback-check.json, quit. The wlk adapters are
    // NOT started here -- the check is raw-PCM energy, no transcription.
    void startLoopbackCheck()
  } else {
    setupPcmHandlers()
    setupSessionIpc()
    if (process.env['VEYRA_TEST_AUDIO']) {
      void handleTestAudio()
    }
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  launchWindows()

  // Phase 3 step 17: VEYRA_TEST_SUGGESTIONS verification seam — mirrors
  // VEYRA_TEST_AUDIO exactly. When env var set (any truthy value -> built-in
  // canned sequence; or a JSON fixture path -> those deltas), main constructs
  // a MockSuggestionAdapter that emits SuggestionDelta events through the REAL
  // SUGGESTION_EVENT_CHANNEL broadcast on timer, exercising the real reducer
  // and AnswerPanel end to end. Env-gated, unreachable in normal runs.
  // Note: win32 has no Xvfb for CDP screenshot automation; verify manually
  // or note the platform caveat at the final gate (same class as Linux
  // setOpacity caveat) — do not claim Xvfb screenshots on win32.
  if (process.env['VEYRA_TEST_SUGGESTIONS']) {
    handleTestSuggestions(() => [mainWindow, overlayWindow])
  }

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
