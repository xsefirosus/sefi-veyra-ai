import { ElectronAPI } from '@electron-toolkit/preload'
import type { Settings } from '../renderer/src/settings/settings-reducer'

export interface Api {
  saveSettings: (settings: Settings) => Promise<Settings>
  /** Step 17: send one 16 kHz Float32Array PCM chunk to the main-process 'pcm' handler. */
  sendPcm: (chunk: Float32Array) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
