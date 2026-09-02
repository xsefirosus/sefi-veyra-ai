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
 *
 * Audit step 13: the optional onError channel reports MID-SESSION transport
 * failures -- a connection that was established and then dropped whose bounded
 * reconnect budget ran out. Startup failures stay on connect()'s rejection
 * path (the step-12 contract); they never reach onError. Fake transports may
 * simply omit the channel (it is optional).
 */
export interface WsTransport {
  connect(url: string): Promise<void>
  send(data: Uint8Array): void
  onMessage(cb: (data: string) => void): void
  close(): Promise<void>
  /** Optional: terminal mid-session failure after reconnect attempts exhaust. */
  onError?(cb: (err: Error) => void): void
}

export interface NodeWsTransportOptions {
  /** Injectable socket factory (unit tests); defaults to the global WebSocket. */
  wsFactory?: (url: string) => WebSocket
  /**
   * Audit step 13: max redial attempts after an ESTABLISHED connection drops
   * unexpectedly (default 5). Exhausting the budget is terminal and fires the
   * transport's onError channel once; deliberate close() never redials.
   */
  maxReconnectAttempts?: number
  /** Base delay of the reconnect backoff -- delay = base * 2^attempt, capped at 8s (default 500ms). */
  reconnectBaseDelayMs?: number
}

/** Ceiling for one backoff wait so a long outage cannot sleep unbounded. */
const MAX_RECONNECT_DELAY_MS = 8000

/**
 * Real transport over the runtime's global WebSocket (see header for the
 * no-dependency decision). Errors:
 * - a failed INITIAL connect rejects connect() (startup failure; step-12 path);
 * - a drop AFTER an established connection triggers bounded exponential-backoff
 *   redials on the SAME url (audit step 13): message callbacks persist across
 *   redials, no incoming message is ever replayed, so the transcript already
 *   committed downstream is neither duplicated nor reset -- the adapter's seq
 *   counter simply continues from where it was;
 * - exhausting the reconnect budget fires onError once (terminal).
 *
 * Budget rationale: defaults give ~15.5s of socket-side retries
 * (500+1000+2000+4000+8000ms), comfortably longer than WlkServer's own crash
 * restart chain (~7s of backoff plus probe time), so a respawned wlk process
 * normally wins the race and sockets recover silently.
 */
export class NodeWsTransport implements WsTransport {
  private readonly wsFactory: ((url: string) => WebSocket) | null
  private readonly maxReconnectAttempts: number
  private readonly reconnectBaseDelayMs: number
  private ws: WebSocket | null = null
  private messageCb: ((data: string) => void) | null = null
  private errorCb: ((err: Error) => void) | null = null
  private url: string | null = null
  private closedByCaller = false
  private reconnectAttempts = 0
  private reconnectTimer: NodeJS.Timeout | null = null

  constructor(opts: NodeWsTransportOptions = {}) {
    this.wsFactory = opts.wsFactory ?? null
    this.maxReconnectAttempts = opts.maxReconnectAttempts ?? 5
    this.reconnectBaseDelayMs = opts.reconnectBaseDelayMs ?? 500
  }

  connect(url: string): Promise<void> {
    if (typeof WebSocket === 'undefined' && !this.wsFactory) {
      return Promise.reject(
        new Error('whisper-livekit: global WebSocket unavailable (needs Node >= 22)')
      )
    }
    this.closedByCaller = false
    this.url = url
    this.reconnectAttempts = 0
    return this.dial(url)
  }

  send(data: Uint8Array): void {
    this.ws?.send(data)
  }

  onMessage(cb: (data: string) => void): void {
    this.messageCb = cb
  }

  /** Terminal mid-session failure channel (audit step 13). */
  onError(cb: (err: Error) => void): void {
    this.errorCb = cb
  }

  close(): Promise<void> {
    // Deliberate stop: cancel any pending redial FIRST so the closing
    // socket's late onclose cannot arm one behind us.
    this.closedByCaller = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
    return Promise.resolve()
  }

  /** One dial cycle: resolve on open, reject pre-open failures. Never retries. */
  private dial(url: string): Promise<void> {
    return new Promise<void>((resolveDial, rejectDial) => {
      let ws: WebSocket
      try {
        ws = this.wsFactory ? this.wsFactory(url) : new WebSocket(url)
      } catch (err) {
        rejectDial(err instanceof Error ? err : new Error(String(err)))
        return
      }
      this.ws = ws
      let opened = false
      let settled = false
      // Hard guard: a WebSocket stuck in CONNECTING must not hang connect()
      // forever (the same hang that produced "reply was never sent" in
      // wlk-server). Fail the dial after 15s so CaptureSession can surface
      // Error and the handler can settle.
      const dialTimer = setTimeout(() => {
        if (settled) return
        settled = true
        try {
          ws.close()
        } catch {
          // best-effort
        }
        if (this.ws === ws) this.ws = null
        rejectDial(new Error(`whisper-livekit: WS connect timed out to ${url}`))
      }, 15_000)
      const clearDialTimer = (): void => clearTimeout(dialTimer)
      ws.onopen = (): void => {
        if (settled) return
        opened = true
        settled = true
        clearDialTimer()
        resolveDial()
      }
      ws.onerror = (): void => {
        if (!opened && !settled) {
          settled = true
          clearDialTimer()
          rejectDial(new Error(`whisper-livekit: WS error connecting to ${url}`))
        }
      }
      ws.onclose = (): void => {
        if (this.ws === ws) this.ws = null
        if (settled && opened) {
          // Established connection dropped mid-session (audit step 13).
          clearDialTimer()
          if (!this.closedByCaller) this.scheduleReconnect()
          return
        }
        if (!settled) {
          settled = true
          clearDialTimer()
          rejectDial(new Error(`whisper-livekit: WS error connecting to ${url}`))
        } else {
          clearDialTimer()
        }
      }
      ws.onmessage = (ev): void => {
        this.messageCb?.(String(ev.data))
      }
    })
  }

  /**
   * Arm one bounded-backoff redial (audit step 13). The Nth attempt waits
   * base*2^(N-1) capped at MAX_RECONNECT_DELAY_MS; a successful redial resets
   * the budget; exhaustion fires onError ONCE with the terminal reason.
   */
  private scheduleReconnect(): void {
    if (this.closedByCaller || !this.url) return
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      const err = new Error(
        `whisper-livekit: connection to ${this.url} lost and reconnect gave up after ${this.maxReconnectAttempts} attempt(s)`
      )
      console.error('[whisper-livekit]', err.message)
      this.errorCb?.(err)
      return
    }
    const delay = Math.min(
      this.reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempts),
      MAX_RECONNECT_DELAY_MS
    )
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.closedByCaller || !this.url) return
      void this.dial(this.url).then(
        () => {
          this.reconnectAttempts = 0 // stable again: full budget for next drop
        },
        () => {
          // Redial refused: continue the SAME chain here -- dial's pre-open
          // close/error paths never schedule on their own, so exactly one
          // scheduling decision exists per attempt.
          this.scheduleReconnect()
        }
      )
    }, delay)
  }
}

export type SttModel = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3'

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
  private partialCb: ((text: string, seq: number, segmentId?: string) => void) | null = null
  private finalCb: ((text: string, seq: number, segmentId?: string) => void) | null = null
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
      opts.model !== 'small' &&
      opts.model !== 'medium' &&
      opts.model !== 'large-v3'
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
    // Audit step 13: a real transport can now fail TERMINALLY mid-session
    // (bounded reconnect budget exhausted). Route it into the adapter's single
    // onError slot -- CaptureSession registered that slot at start(), so the
    // failure lands on the step-12 path (session 'error' + status chip). Fake
    // transports without the channel are unaffected (optional method).
    this.transport.onError?.((err) => this.errorCb?.(err))
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

  // Audit step 18: the optional third argument is the parser's stable
  // segmentId (step 8) -- see SttAdapter in shared/stt/stt-adapter.ts.
  onPartial(cb: (text: string, seq: number, segmentId?: string) => void): void {
    this.partialCb = cb
  }

  onFinal(cb: (text: string, seq: number, segmentId?: string) => void): void {
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
        this.finalCb?.(event.text, event.seq, event.segmentId)
        this.seq += 1 // segment committed; the next event opens the next segment
      } else {
        this.partialCb?.(event.text, event.seq, event.segmentId)
      }
    }
  }
}
