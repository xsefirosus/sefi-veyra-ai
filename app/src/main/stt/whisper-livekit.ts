/**
 * WhisperLiveKitSttAdapter (plan step 16): the `local-whisperlivekit` provider
 * behind the step-9 SttAdapter seam. Lives in the main process; the shared
 * factory (src/shared/stt/stt-adapter.ts) loads it with a lazy dynamic import.
 *
 * ## WS transport decision -- global WebSocket, NO `ws` dependency (verified)
 * The plan's "check whether the app's Node runtime already exposes a global
 * WebSocket" resolved to YES on this machine, verified 2026-08-20:
 *   - system Node v24.15.0:  `typeof WebSocket` === 'function'
 *   - Electron 39 main process (ELECTRON_RUN_AS_NODE=1): Node v22.22.1,
 *     `typeof WebSocket` === 'function'
 * Node >= 22 ships a stable undici-based global WebSocket, and step 13's
 * wlk-server.ts already relies on it (minimization ladder rung 4: native
 * platform feature). Adding the `ws` package would duplicate that runtime
 * feature for zero benefit, so the transport here uses the same global --
 * consistently, in one place (NodeWsTransport).
 *
 * ## Endpoint -- the REAL port is 8000, not the plan's 9090
 * The plan text says ws://127.0.0.1:9090/asr; the installed whisperlivekit
 * 0.2.24 ships --port default 8000 (parse_args.py:14, config.py:28) and /asr
 * is the real WS path (basic_server.py:88) -- established in step 13 and
 * re-confirmed by the step-14 probe (state/wlk-probe.json: wsUrl
 * ws://127.0.0.1:8000/asr). The adapter imports the WLK_* constants from
 * wlk-server.ts (single source of truth, exactly as the probe does) so this
 * URL can never drift from the spawned server.
 *
 * ## PCM framing -- exactly as the step-14 probe streamed it
 * The probe (scripts/probe-wlk.mjs) sent raw s16le 16 kHz mono bytes as WS
 * binary frames and ended the stream with an empty binary frame
 * (audio_processor.py:878-890). send(pcm) here transmits the Int16Array's
 * underlying bytes verbatim as one binary frame -- typed-array memory is
 * little-endian on every supported platform, so the Int16Array IS the s16le
 * stream (the probe's fixed 3200-byte chunk size was transport pacing; the
 * caller's chunk size is the frame size here). close() sends the same empty
 * end-of-stream frame the probe did before closing the socket.
 *
 * ## seq semantics -- the adapter owns the segment sequence counter
 * normalizeWlkMessage (step 15) passes seq through caller-stamped; the adapter
 * is that caller. seq numbers SEGMENTS (step-9 contract: "a partial with a
 * given seq is the live revision of that segment, and the final with that seq
 * is its committed text" -- the step-18 reducer also keys pending partials by
 * seq, so partial + committing final MUST share it):
 *   - a partial carries the CURRENT segment's seq (revisions of the in-flight
 *     segment);
 *   - the final that commits that segment carries the SAME seq;
 *   - the counter advances by 1 ONLY when a final is produced (the committed
 *     segment is closed; the next event opens the next segment);
 *   - null-producing messages (control/empty, observed in the fixture) never
 *     advance it -- seq stays monotonic across produced events.
 */

import { normalizeWlkMessage } from '../../shared/stt/context-parser'
import type { SttAdapter } from '../../shared/stt/stt-adapter'
import { WLK_DEFAULT_HOST, WLK_DEFAULT_PORT, WLK_WS_PATH } from './wlk-server'

/**
 * Injectable WebSocket seam (plan step 16): {connect(url), send(data),
 * onMessage(cb), close()}. The adapter never touches a real socket directly --
 * tests inject a FakeWsTransport that replays the step-14 fixture.
 */
export interface WsTransport {
  connect(url: string): Promise<void>
  send(data: Uint8Array): void
  onMessage(cb: (data: string) => void): void
  close(): Promise<void>
}

/**
 * Real transport over the runtime's global WebSocket (see header for the
 * no-dependency decision). Errors: a failed connect rejects connect(); the
 * transport has no runtime error channel (the plan's WsTransport shape), so
 * the adapter's onError is registered for interface compliance only.
 */
export class NodeWsTransport implements WsTransport {
  private ws: WebSocket | null = null
  private messageCb: ((data: string) => void) | null = null

  connect(url: string): Promise<void> {
    if (typeof WebSocket === 'undefined') {
      return Promise.reject(
        new Error('whisper-livekit: global WebSocket unavailable (needs Node >= 22)')
      )
    }
    return new Promise((resolve, reject) => {
      let ws: WebSocket
      try {
        ws = new WebSocket(url)
      } catch (err) {
        reject(err)
        return
      }
      this.ws = ws
      let opened = false
      ws.onopen = (): void => {
        opened = true
        resolve()
      }
      ws.onerror = (): void => {
        if (!opened) reject(new Error(`whisper-livekit: WS error connecting to ${url}`))
      }
      ws.onclose = (): void => {
        if (this.ws === ws) this.ws = null
      }
      ws.onmessage = (ev): void => {
        this.messageCb?.(String(ev.data))
      }
    })
  }

  send(data: Uint8Array): void {
    this.ws?.send(data)
  }

  onMessage(cb: (data: string) => void): void {
    this.messageCb = cb
  }

  close(): Promise<void> {
    this.ws?.close()
    this.ws = null
    return Promise.resolve()
  }
}

export type SttModel = 'tiny' | 'base' | 'small'

export interface WhisperLiveKitSttAdapterOptions {
  /** Injectable socket seam; defaults to the real NodeWsTransport. */
  transport?: WsTransport
  /** wlk /asr endpoint; defaults to the WLK_* constants (real port 8000). */
  url?: string
  /** Capture track tag passed to the context parser ('mic' | 'loopback'). */
  source?: 'mic' | 'loopback'
  /** STT model identifier threaded from settings (tiny|base|small). */
  model?: SttModel
}

export class WhisperLiveKitSttAdapter implements SttAdapter {
  private readonly transport: WsTransport
  readonly url: string
  readonly source: 'mic' | 'loopback'
  readonly model: SttModel
  private partialCb: ((text: string, seq: number) => void) | null = null
  private finalCb: ((text: string, seq: number) => void) | null = null
  private errorCb: ((err: Error) => void) | null = null
  /** Segment sequence counter -- see the header for the advance rule. */
  private seq = 0
  private connected = false
  private closed = false

  constructor(opts: WhisperLiveKitSttAdapterOptions = {}) {
    if (opts.source !== undefined && opts.source !== 'mic' && opts.source !== 'loopback') {
      throw new Error(`whisper-livekit: unsupported source "${String(opts.source)}"`)
    }
    if (
      opts.model !== undefined &&
      opts.model !== 'tiny' &&
      opts.model !== 'base' &&
      opts.model !== 'small'
    ) {
      throw new Error(`whisper-livekit: unsupported model "${String(opts.model)}"`)
    }
    if (opts.url !== undefined && typeof opts.url === 'string' && !/^wss?:\/\//.test(opts.url)) {
      throw new Error(`whisper-livekit: invalid url "${opts.url}" (expected ws:// or wss://)`)
    }
    this.transport = opts.transport ?? new NodeWsTransport()
    this.url = opts.url ?? `ws://${WLK_DEFAULT_HOST}:${WLK_DEFAULT_PORT}${WLK_WS_PATH}`
    this.source = opts.source ?? 'mic'
    this.model = opts.model ?? 'tiny'
    this.transport.onMessage((data) => this.handleMessage(data))
  }

  async connect(): Promise<void> {
    if (this.closed) throw new Error('whisper-livekit: adapter is closed')
    if (this.connected) throw new Error('whisper-livekit: already connected')
    try {
      await this.transport.connect(this.url)
      this.connected = true
    } catch (err) {
      // The only error source in the WsTransport seam: connect() failing. The
      // promise rejects AND the error callback fires (listener + promise API).
      this.errorCb?.(err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }

  send(pcm: Int16Array): void {
    if (!this.connected) {
      throw new Error('whisper-livekit: send() before connect() (call connect() first)')
    }
    if (this.closed) throw new Error('whisper-livekit: adapter is closed')
    // Step-14 framing: the Int16Array's bytes ARE the s16le stream; send them
    // verbatim as one binary frame (see header).
    this.transport.send(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength))
  }

  onPartial(cb: (text: string, seq: number) => void): void {
    this.partialCb = cb
  }

  onFinal(cb: (text: string, seq: number) => void): void {
    this.finalCb = cb
  }

  onError(cb: (err: Error) => void): void {
    this.errorCb = cb
  }

  /** Send the end-of-stream empty frame (probe step 14) then close. Idempotent. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.connected) {
      this.transport.send(new Uint8Array(0)) // end of stream (audio_processor.py:878-890)
      this.connected = false
      await this.transport.close()
    }
    // Never connected: the transport was never touched; close is a no-op.
  }

  private handleMessage(data: string): void {
    if (this.closed) return
    const events = normalizeWlkMessage(data, this.source, this.seq)
    for (const event of events) {
      if (event.kind === 'final') {
        this.finalCb?.(event.text, event.seq)
        this.seq += 1 // segment committed; the next event opens the next segment
      } else {
        this.partialCb?.(event.text, event.seq)
      }
    }
  }
}
