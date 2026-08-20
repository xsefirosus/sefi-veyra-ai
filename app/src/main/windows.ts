import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

// Shared webPreferences: context isolation ON, node integration OFF, preload wired.
// sandbox: false is kept from the electron-vite template (required for the
// @electron-toolkit/preload bridge the template provides).
const baseWebPreferences = {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false
}

// The overlay window renders a DIFFERENT screen than the main window (both
// load the same renderer bundle; plan step 18). The role is passed via
// additionalArguments -- the documented Electron mechanism for per-window
// preload-visible flags -- and resolved by the preload
// (src/preload/transcript-api.ts: resolveWindowRole(process.argv)).
const overlayWebPreferences = {
  ...baseWebPreferences,
  additionalArguments: ['--veyra-window=overlay']
}

function loadRenderer(win: BrowserWindow): void {
  // HMR for renderer based on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

export function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    title: 'VEYRA',
    width: 1100,
    height: 760,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: baseWebPreferences
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  loadRenderer(mainWindow)
  return mainWindow
}

export function createOverlayWindow(): BrowserWindow {
  const overlay = new BrowserWindow({
    title: 'VEYRA Overlay',
    width: 640,
    height: 120,
    alwaysOnTop: true,
    frame: false,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: overlayWebPreferences
  })

  // Attempt to exclude the overlay from screen-share capture. Support finding on
  // this Electron/Windows version is recorded in state/overlay-capture-note.md.
  overlay.setContentProtection(true)

  // Keep the configured window title instead of letting the loaded page <title>
  // override it (the renderer's <title> is 'VEYRA'; the overlay is 'VEYRA Overlay').
  overlay.on('page-title-updated', (event) => event.preventDefault())

  overlay.on('ready-to-show', () => {
    overlay.show()
  })

  loadRenderer(overlay)
  return overlay
}
