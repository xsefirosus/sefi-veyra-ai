import { ElectronAPI } from '@electron-toolkit/preload'
import type { Settings } from '../renderer/src/settings/settings-reducer'
import type { PersonaData } from '../renderer/src/persona/persona-reducer'
import type { TranscriptEvent } from '../shared/types'
import type { Theme, WindowRole } from './transcript-api'

export interface Api {
  saveSettings: (settings: Settings) => Promise<Settings>
  /** Step 11: load the persisted settings (apiKey decrypted in main via safeStorage). */
  loadSettings: () => Promise<Settings>
  /** Step 17: send one 16 kHz Float32Array PCM chunk to the main-process 'pcm' handler. */
  sendPcm: (chunk: Float32Array) => void
  /** Step 19: send one 16 kHz Float32Array PCM chunk to the main-process 'pcm-loopback' handler (loopback track -> second adapter session). */
  sendLoopbackPcm: (chunk: Float32Array) => void
  /** Step 19: true when VEYRA_LOOPBACK_CHECK=1 (scripts/check-loopback.ps1) — auto-start loopback capture for the energy check. */
  loopbackCheckMode: boolean
  /** Step 18: subscribe to main-process transcript events; returns the unsubscribe fn. */
  onTranscriptEvent: (cb: (event: TranscriptEvent) => void) => () => void
  /** Step 18: 'overlay' for the overlay window, 'main' otherwise. */
  windowRole: WindowRole
  /** Phase 3 step 3: theme from additionalArguments, available synchronously before React mounts. */
  initialTheme: Theme
  /** Step 3: CaptureSession lifecycle */
  startSession: (settings: Settings) => Promise<{ state: string; lastError: string | null }>
  stopSession: () => Promise<{ state: string; lastError: string | null }>
  getSessionState: () => Promise<{ state: string; lastError: string | null }>
  onSessionState: (cb: (state: { state: string; lastError: string | null }) => void) => () => void
  /** Phase 3 step 9: persona persistence + resume picker (main reads + parses via parse-document). */
  loadPersona: () => Promise<PersonaData>
  savePersona: (data: PersonaData) => Promise<PersonaData>
  pickFile: () => Promise<{ fileName: string; text: string } | null>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
