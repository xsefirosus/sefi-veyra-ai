import { app, BrowserWindow, screen, shell } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { dirname } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  MIN_OVERLAY_HEIGHT,
  MIN_OVERLAY_WIDTH,
  resolveOverlayBounds,
  watchOverlayBounds,
  type OverlayBounds
} from './overlay-bounds'
import { load as loadSettings } from './settings-store'

// Shared webPreferences: context isolation ON, node integration OFF, preload wired.
// sandbox: false is kept from the electron-vite template (required for the
// @electron-toolkit/preload bridge the template provides).
function themeArgument(): string {
  try {
    const theme = loadSettings().theme
    return `--veyra-theme=${theme === 'dark' ? 'dark' : 'light'}`
  } catch {
    return '--veyra-theme=light'
  }
}

function baseWebPreferences(): Electron.WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    additionalArguments: [themeArgument()]
  }
}

function overlayWebPreferences(): Electron.WebPreferences {
  return {
    ...baseWebPreferences(),
    additionalArguments: [themeArgument(), '--veyra-window=overlay']
  }
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
    webPreferences: baseWebPreferences()
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

/*
 * Plan step 16(a): the overlay is user-movable (renderer drag region) and
 * resizable now, and its position/size persist across restarts in
 * userData/veyra-overlay-bounds.json -- validated on read by overlay-bounds.ts,
 * with a bottom-center default for first run or a lost window (monitor change).
 */
const OVERLAY_BOUNDS_FILE = 'veyra-overlay-bounds.json'

function overlayBoundsPath(): string {
  return join(app.getPath('userData'), OVERLAY_BOUNDS_FILE)
}

function readPersistedOverlayRaw(): unknown {
  try {
    return JSON.parse(readFileSync(overlayBoundsPath(), 'utf8'))
  } catch {
    // First run / corrupt file -> default placement (resolveOverlayBounds).
    return null
  }
}

function saveOverlayBounds(bounds: OverlayBounds): void {
  try {
    const file = overlayBoundsPath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(bounds), 'utf8')
  } catch (err) {
    console.warn('[overlay] persisting bounds failed:', err instanceof Error ? err.message : err)
  }
}

export function createOverlayWindow(): BrowserWindow {
  // Requires app ready -- createOverlayWindow runs from launchWindows().
  const workAreas = screen.getAllDisplays().map((d) => d.workArea)
  const primaryWorkArea = screen.getPrimaryDisplay().workArea
  const initial = resolveOverlayBounds(readPersistedOverlayRaw(), workAreas, primaryWorkArea)

  const overlay = new BrowserWindow({
    title: 'VEYRA Overlay',
    x: initial.x,
    y: initial.y,
    width: initial.width,
    height: initial.height,
    minWidth: MIN_OVERLAY_WIDTH,
    minHeight: MIN_OVERLAY_HEIGHT,
    alwaysOnTop: true,
    frame: false,
    skipTaskbar: true,
    resizable: true,
    show: false,
    webPreferences: overlayWebPreferences()
  })

  // Persist moves/resizes across restarts (debounced; flushed on close).
  watchOverlayBounds(overlay, saveOverlayBounds)

  // Attempt to exclude the overlay from screen-share capture. Support finding on
  // this Electron/Windows version is recorded in state/overlay-capture-note.md.
  overlay.setContentProtection(true)

  // Step 12: apply persisted overlay opacity on creation (not just on live slider
  // changes). Default 90 — see settings-store.ts for rationale.
  // Linux caveat: BrowserWindow.setOpacity() has weaker/no effect on some Linux
  // window managers (Electron docs). This is a platform caveat, not a bug — same
  // class as the existing macOS-loopback and Windows-only-scripts caveats. The
  // call is still made; the WM may ignore it.
  try {
    const persisted = loadSettings().overlayOpacity
    const clamped = Math.round(Math.min(100, Math.max(0, persisted ?? 90)))
    overlay.setOpacity(clamped / 100)
  } catch {
    try {
      overlay.setOpacity(0.9)
    } catch {
      // setOpacity can throw on some WMs; never crash window creation.
    }
  }

  // Keep the configured window title instead of letting the loaded page <title>
  // override it (the renderer's <title> is 'VEYRA'; the overlay is 'VEYRA Overlay').
  overlay.on('page-title-updated', (event) => event.preventDefault())

  overlay.on('ready-to-show', () => {
    overlay.show()
  })

  loadRenderer(overlay)
  return overlay
}
