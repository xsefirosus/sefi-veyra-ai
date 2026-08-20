import { app, BrowserWindow, ipcMain } from 'electron'
import { writeFileSync } from 'fs'
import { resolve } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow, createOverlayWindow } from './windows'
import { registerIpcHandlers } from './settings-store'
import { createPcmSink, feedWavToAdapter } from './capture/audio-input'
import { createSttAdapter } from '../shared/stt/stt-adapter'

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
  const mainWindow = createMainWindow()
  const overlay = createOverlayWindow()
  if (process.env['VEYRA_SMOKE'] === '1') armSmoke(mainWindow, overlay)
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
  void startCaptureBridge()

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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
