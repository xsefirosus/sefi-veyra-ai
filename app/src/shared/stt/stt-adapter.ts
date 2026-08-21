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

export type SttModel = 'tiny' | 'base' | 'small'

export interface SttAdapterOptions {
  /** Capture track tag; defaults to 'mic'. */
  source?: 'mic' | 'loopback'
  /** wlk /asr endpoint; defaults to ws://127.0.0.1:8000/asr. */
  url?: string
  /** STT model identifier (tiny|base|small); defaults to 'tiny'. */
  model?: SttModel
}

function validateAdapterOptions(opts: SttAdapterOptions): void {
  if (opts.source !== undefined && opts.source !== 'mic' && opts.source !== 'loopback') {
    throw new Error(`stt-adapter: unsupported source "${String(opts.source)}"`)
  }
  if (
    opts.model !== undefined &&
    opts.model !== 'tiny' &&
    opts.model !== 'base' &&
    opts.model !== 'small'
  ) {
    throw new Error(`stt-adapter: unsupported model "${String(opts.model)}"`)
  }
  if (opts.url !== undefined && typeof opts.url === 'string' && !/^wss?:\/\//.test(opts.url)) {
    throw new Error(`stt-adapter: invalid url "${opts.url}" (expected ws:// or wss://)`)
  }
}

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

export function createSttAdapter(provider: SttProvider, opts: SttAdapterOptions = {}): SttAdapter {
  validateAdapterOptions(opts)
  if (provider === 'local-whisperlivekit') {
    // Step 16 (src/main/stt/whisper-livekit.ts), loaded lazily -- see below.
    // Step 6: thread {source, url, model} through factory and lazy facade so
    // per-track adapters (mic vs loopback) and per-model wlk servers can be
    // selected, and the step-7 fallback (second wlk on another port) is a config
    // change rather than a rewrite.
    return createLazyLocalAdapter(opts)
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
function createLazyLocalAdapter(opts: SttAdapterOptions = {}): SttAdapter {
  let real: SttAdapter | null = null
  let loading: Promise<SttAdapter> | null = null
  const pending: Array<(adapter: SttAdapter) => void> = []

  const getReal = (): Promise<SttAdapter> => {
    loading ??= import('../../main/stt/whisper-livekit').then(
      (mod) =>
        new mod.WhisperLiveKitSttAdapter({ source: opts.source, url: opts.url, model: opts.model })
    )
    return loading
  }

  const facade: SttAdapter = {
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

  // Expose threaded options on the facade for test inspection and for callers
  // that need to observe per-track configuration without awaiting connect().
  // The real adapter receives the same opts at construction (see getReal).
  Object.defineProperties(facade, {
    source: { value: opts.source ?? 'mic', enumerable: true },
    url: { value: opts.url, enumerable: true, writable: true },
    model: { value: opts.model ?? 'tiny', enumerable: true }
  })

  return facade
}
