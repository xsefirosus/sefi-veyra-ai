import { ElectronAPI } from '@electron-toolkit/preload'
import type { Settings } from '../renderer/src/settings/settings-reducer'
import type { TranscriptEvent } from '../shared/types'
import type { WindowRole } from './transcript-api'

export interface Api {
  saveSettings: (settings: Settings) => Promise<Settings>
  /** Step 17: send one 16 kHz Float32Array PCM chunk to the main-process 'pcm' handler. */
  sendPcm: (chunk: Float32Array) => void
  /** Step 18: subscribe to main-process transcript events; returns the unsubscribe fn. */
  onTranscriptEvent: (cb: (event: TranscriptEvent) => void) => () => void
  /** Step 18: 'overlay' for the overlay window, 'main' otherwise. */
  windowRole: WindowRole
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
