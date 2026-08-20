import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { Settings } from '../renderer/src/settings/settings-reducer'

// Custom APIs for renderer
const api = {
  // Step 7: settings:save stores to an in-memory map in main. Disk persistence
  // (safeStorage-encrypted) is plan step 8; this handler is replaced there.
  saveSettings: (settings: Settings): Promise<Settings> =>
    ipcRenderer.invoke('settings:save', settings)
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
