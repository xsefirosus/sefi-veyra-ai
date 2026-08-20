/**
 * STT adapter seam (plan step 9).
 *
 * One interface, three providers. `local-whisperlivekit` is the only provider
 * implemented this pass; the two cloud providers are declared so the seam
 * exists, but `createSttAdapter` throws for them (a later phase implements
 * them behind this same interface — a swap is a seam change, not a rewrite).
 *
 * The local adapter lives in the main process (src/main/stt/whisper-livekit.ts,
 * step 16) and is loaded with a lazy dynamic import so this shared module never
 * imports main-process code at load time. Step 16 fills the
 * `local-whisperlivekit` branch below with that import; until the file exists,
 * that branch throws with a step-16 message.
 */

export type SttProvider = 'local-whisperlivekit' | 'cloud-deepgram' | 'cloud-assemblyai'

/**
 * Streaming speech-to-text adapter contract.
 *
 * PCM (16-bit mono, 16 kHz) goes in via send(); transcript events come out
 * through the callbacks. `seq` is the adapter's monotonically increasing
 * segment sequence number: a partial with a given seq is the live revision of
 * that segment, and the final with that seq is its committed text.
 */
export interface SttAdapter {
  connect(): Promise<void>
  send(pcm: Int16Array): void
  onPartial(cb: (text: string, seq: number) => void): void
  onFinal(cb: (text: string, seq: number) => void): void
  onError(cb: (err: Error) => void): void
  close(): Promise<void>
}

const NOT_IMPLEMENTED_MESSAGE = 'not implemented in this pass'

export function createSttAdapter(provider: SttProvider): SttAdapter {
  if (provider === 'local-whisperlivekit') {
    // Step 16 implements WhisperLiveKitSttAdapter (src/main/stt/whisper-livekit.ts)
    // and fills this branch with a lazy dynamic import of it.
    throw new Error(`local-whisperlivekit ${NOT_IMPLEMENTED_MESSAGE} (local adapter is implemented in step 16)`)
  }
  // Every non-local provider is a cloud seam this pass: throwing here is the
  // declared contract until a later phase implements them. If a new provider is
  // ever added to the SttProvider union it must be handled before this line.
  throw new Error(`${provider} ${NOT_IMPLEMENTED_MESSAGE}`)
}
