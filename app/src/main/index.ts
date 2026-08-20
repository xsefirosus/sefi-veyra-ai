import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'
import { resolve } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow, createOverlayWindow } from './windows'

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

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.veyra.app')

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