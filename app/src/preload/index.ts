import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { Settings } from '../renderer/src/settings/settings-reducer'
import type { PersonaData } from '../renderer/src/persona/persona-reducer'
import type { TranscriptEvent } from '../shared/types'
import { resolveInitialTheme, resolveWindowRole, subscribeTranscriptEvents } from './transcript-api'

// Custom APIs for renderer
const api = {
  // Step 8: settings:save persists via the main-process settings-store —
  // apiKey is safeStorage-encrypted in veyra-settings.json under userData.
  saveSettings: (settings: Settings): Promise<Settings> =>
    ipcRenderer.invoke('settings:save', settings),
  // Step 11: the read half of the round-trip — persisted settings (apiKey
  // decrypted in main via safeStorage) so the form can hydrate after restart.
  loadSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:load'),
  // Step 3: CaptureSession lifecycle -- renderer requests start/stop and observes state
  startSession: (settings: Settings): Promise<{ state: string; lastError: string | null }> =>
    ipcRenderer.invoke('session:start', settings),
  stopSession: (): Promise<{ state: string; lastError: string | null }> =>
    ipcRenderer.invoke('session:stop'),
  getSessionState: (): Promise<{ state: string; lastError: string | null }> =>
    ipcRenderer.invoke('session:state'),
  onSessionState: (
    cb: (state: { state: string; lastError: string | null }) => void
  ): (() => void) => {
    const listener = (_event: unknown, payload: unknown): void => {
      cb(payload as { state: string; lastError: string | null })
    }
    ipcRenderer.on('session-state', listener)
    return () => {
      ipcRenderer.removeListener('session-state', listener)
    }
  },
  // Step 17: mic capture ships 16 kHz Float32Array chunks to main over the
  // 'pcm' channel; main validates + converts to int16 and calls adapter.send.
  sendPcm: (chunk: Float32Array): void => ipcRenderer.send('pcm', chunk),
  // Step 19: loopback capture ships 16 kHz Float32Array chunks over the
  // 'pcm-loopback' channel -> main's SECOND adapter session (dual-track,
  // source 'loopback'). Same payload contract as sendPcm.
  sendLoopbackPcm: (chunk: Float32Array): void => ipcRenderer.send('pcm-loopback', chunk),
  // Step 19: true under scripts/check-loopback.ps1 (VEYRA_LOOPBACK_CHECK=1) --
  // the renderer auto-starts loopback capture and main writes the energy
  // verdict to state/loopback-check.json, then quits. Read here (preload, with
  // Node env access) so the renderer bundle never sees the env var.
  loopbackCheckMode: process.env['VEYRA_LOOPBACK_CHECK'] === '1',
  // Step 18: transcript events broadcast by main to BOTH windows; returns an
  // unsubscribe fn for React effect cleanup.
  onTranscriptEvent: (cb: (event: TranscriptEvent) => void): (() => void) =>
    subscribeTranscriptEvents(ipcRenderer, cb),
  // Step 18: which window this renderer belongs to ('overlay' vs 'main'),
  // resolved from the window's additionalArguments (windows.ts).
  windowRole: resolveWindowRole(process.argv),
  // Phase 3 step 3: persisted theme read synchronously from additionalArguments
  // (windows.ts: themeArgument) so the renderer can set data-theme BEFORE
  // first paint, avoiding any flash of the wrong theme.
  initialTheme: resolveInitialTheme(process.argv),
  // Phase 3 step 9: persona persistence + resume file picker (main reads + parses via parse-document)
  loadPersona: (): Promise<PersonaData> => ipcRenderer.invoke('persona:load'),
  savePersona: (data: PersonaData): Promise<PersonaData> =>
    ipcRenderer.invoke('persona:save', data),
  pickFile: (): Promise<{ fileName: string; text: string } | null> =>
    ipcRenderer.invoke('dialog:pickFile'),
  // Phase 3 step 12: overlay opacity — slider value 0-100 -> main overlayWindow.setOpacity(value/100)
  setOverlayOpacity: (value: number): Promise<number> =>
    ipcRenderer.invoke('overlay:set-opacity', value)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
