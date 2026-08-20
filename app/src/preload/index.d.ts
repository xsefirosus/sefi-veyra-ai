import { ElectronAPI } from '@electron-toolkit/preload'
import type { Settings } from '../renderer/src/settings/settings-reducer'

export interface Api {
  saveSettings: (settings: Settings) => Promise<Settings>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
