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
 * `local-whisperlivekit` branch below with a lazy facade over that import:
 * the factory stays synchronous and resolves the real adapter on the first
 * connect() call.
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
    // Step 16 (src/main/stt/whisper-livekit.ts), loaded lazily -- see below.
    return createLazyLocalAdapter()
  }
  // Every non-local provider is a cloud seam this pass: throwing here is the
  // declared contract until a later phase implements them. If a new provider is
  // ever added to the SttProvider union it must be handled before this line.
  throw new Error(`${provider} ${NOT_IMPLEMENTED_MESSAGE}`)
}

/**
 * Lazy local-adapter facade (step 16). The real adapter lives in the main
 * process (src/main/stt/whisper-livekit.ts); it is imported DYNAMICALLY on the
 * first factory call -- never at module load, so this shared module does not
 * pull main-process code into a renderer bundle. The factory itself stays
 * synchronous (step-9 contract, asserted by the step-9 tests), so the returned
 * facade:
 *   - resolves and constructs the real adapter the first time connect() is
 *     awaited, and delegates connect() to it;
 *   - buffers onPartial/onFinal/onError registrations made before that first
 *     connect() and replays them onto the real adapter once it exists
 *     (callbacks are typically registered before connect());
 *   - throws on send() before connect() (the real adapter would too);
 *   - close() before any connect() is a no-op.
 */
function createLazyLocalAdapter(): SttAdapter {
  let real: SttAdapter | null = null
  let loading: Promise<SttAdapter> | null = null
  const pending: Array<(adapter: SttAdapter) => void> = []

  const getReal = (): Promise<SttAdapter> => {
    loading ??= import('../../main/stt/whisper-livekit').then(
      (mod) => new mod.WhisperLiveKitSttAdapter()
    )
    return loading
  }

  return {
    async connect(): Promise<void> {
      const adapter = await getReal()
      while (pending.length > 0) {
        const op = pending.shift()
        op?.(adapter)
      }
      real = adapter
      await adapter.connect()
    },
    send(pcm: Int16Array): void {
      if (real) {
        real.send(pcm)
      } else {
        throw new Error('stt-adapter: send() before connect() (call connect() first)')
      }
    },
    onPartial(cb: (text: string, seq: number) => void): void {
      if (real) real.onPartial(cb)
      else pending.push((adapter) => adapter.onPartial(cb))
    },
    onFinal(cb: (text: string, seq: number) => void): void {
      if (real) real.onFinal(cb)
      else pending.push((adapter) => adapter.onFinal(cb))
    },
    onError(cb: (err: Error) => void): void {
      if (real) real.onError(cb)
      else pending.push((adapter) => adapter.onError(cb))
    },
    async close(): Promise<void> {
      pending.length = 0
      if (real) await real.close()
    }
  }
}
