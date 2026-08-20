import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { Settings } from '../renderer/src/settings/settings-reducer'
import type { TranscriptEvent } from '../shared/types'
import { resolveWindowRole, subscribeTranscriptEvents } from './transcript-api'

// Custom APIs for renderer
const api = {
  // Step 8: settings:save persists via the main-process settings-store —
  // apiKey is safeStorage-encrypted in veyra-settings.json under userData.
  saveSettings: (settings: Settings): Promise<Settings> =>
    ipcRenderer.invoke('settings:save', settings),
  // Step 17: mic capture ships 16 kHz Float32Array chunks to main over the
  // 'pcm' channel; main validates + converts to int16 and calls adapter.send.
  sendPcm: (chunk: Float32Array): void => ipcRenderer.send('pcm', chunk),
  // Step 18: transcript events broadcast by main to BOTH windows; returns an
  // unsubscribe fn for React effect cleanup.
  onTranscriptEvent: (cb: (event: TranscriptEvent) => void): (() => void) =>
    subscribeTranscriptEvents(ipcRenderer, cb),
  // Step 18: which window this renderer belongs to ('overlay' vs 'main'),
  // resolved from the window's additionalArguments (windows.ts).
  windowRole: resolveWindowRole(process.argv)
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
