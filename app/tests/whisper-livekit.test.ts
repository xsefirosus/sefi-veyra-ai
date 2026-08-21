import { describe, expect, it } from 'vitest'
import {
  NodeWsTransport,
  WhisperLiveKitSttAdapter,
  type WsTransport
} from '../src/main/stt/whisper-livekit'
import { createSttAdapter } from '../src/shared/stt/stt-adapter'
import rawFixture from './fixtures/wlk-messages.json'

/**
 * Seams under test (pre-agreed, plan step 16):
 *   1. SttAdapter contract (step 9) -- connect/send/onPartial/onFinal/onError/close,
 *      exercised through the real WhisperLiveKitSttAdapter class AND the factory.
 *   2. WsTransport injection seam -- FakeWsTransport replays the REAL step-14
 *      fixture (app/tests/fixtures/wlk-messages.json, 14 verbatim server
 *      messages); no real socket is ever touched in tests.
 *   3. context-parser seam (step 15) -- the adapter feeds incoming JSON through
 *      the real normalizeWlkMessage; the assertions below use the parser's
 *      trimmed text and the adapter's stamped seq.
 *   4. wlk-server constants seam (step 13) -- the default URL is built from
 *      WLK_DEFAULT_HOST/PORT/WS_PATH (real port 8000, NOT the plan's 9090;
 *      state/wlk-probe.json confirms ws://127.0.0.1:8000/asr).
 * Scope: step-16 files only. (Source tagging is the parser's job and is
 * already covered by context-parser.test.ts.)
 */

// The step-14 fixture: 14 verbatim JSON strings captured from wlk's
// ws://127.0.0.1:8000/asr stream. Text-bearing evidence: partials at indexes
// 9-10 (buffer_transcription " Testing 1", " Testing 1, 2, 3"), finals at
// 11-12 (lines[].text); control (index 0) and no-text (indexes 1-8, 13)
// messages must produce no events.
const fixture = rawFixture as string[]

/** Injected transport: records connect/send/close and replays the fixture. */
class FakeWsTransport implements WsTransport {
  readonly messages: string[]
  readonly sent: Uint8Array[] = []
  url: string | null = null
  closed = false
  private messageCb: ((data: string) => void) | null = null

  constructor(messages: string[]) {
    this.messages = messages
  }

  onMessage(cb: (data: string) => void): void {
    this.messageCb = cb
  }

  async connect(url: string): Promise<void> {
    this.url = url
    for (const message of this.messages) this.messageCb?.(message)
  }

  send(data: Uint8Array): void {
    this.sent.push(data)
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

describe('WhisperLiveKitSttAdapter', () => {
  it('connects to the real wlk endpoint (WLK_* constants: port 8000, path /asr)', async () => {
    const fake = new FakeWsTransport([])
    const adapter = new WhisperLiveKitSttAdapter({ transport: fake })
    await adapter.connect()
    expect(fake.url).toBe('ws://127.0.0.1:8000/asr')
  })

  it('replays the real step-14 fixture: emits partials then finals with fixture text', async () => {
    const fake = new FakeWsTransport(fixture)
    const adapter = new WhisperLiveKitSttAdapter({ transport: fake })
    const events: Array<{ kind: 'partial' | 'final'; text: string; seq: number }> = []
    adapter.onPartial((text, seq) => events.push({ kind: 'partial', text, seq }))
    adapter.onFinal((text, seq) => events.push({ kind: 'final', text, seq }))

    await adapter.connect()

    // The parser trims fixture text (e.g. " Testing 1" -> "Testing 1") and the
    // adapter stamps segment seqs: both partials are revisions of segment 0,
    // the first final commits segment 0, the second final opens segment 1.
    expect(events).toEqual([
      { kind: 'partial', text: 'Testing 1', seq: 0 },
      { kind: 'partial', text: 'Testing 1, 2, 3', seq: 0 },
      { kind: 'final', text: 'testing 1, 2, 3. This is the Vero meeting transcription', seq: 0 },
      {
        kind: 'final',
        text: 'testing 1, 2, 3. This is the Vero meeting transcription test',
        seq: 1
      }
    ])
    // 4 events from 14 messages: control/no-text messages emit nothing.
    expect(events).toHaveLength(4)
    // seq stays monotonic across produced events.
    for (let i = 1; i < events.length; i++) {
      expect(events[i].seq).toBeGreaterThanOrEqual(events[i - 1].seq)
    }
  })

  it('send() frames Int16Array PCM as s16le bytes, verbatim (step-14 framing)', async () => {
    const fake = new FakeWsTransport([])
    const adapter = new WhisperLiveKitSttAdapter({ transport: fake })
    await adapter.connect()
    adapter.send(new Int16Array([1, 2, 3, -2]))
    expect(fake.sent).toHaveLength(1)
    // 1->01 00, 2->02 00, 3->03 00, -2->FE FF (little-endian s16le).
    expect(Array.from(fake.sent[0])).toEqual([1, 0, 2, 0, 3, 0, 254, 255])
  })

  it('send() before connect() throws', () => {
    const fake = new FakeWsTransport([])
    const adapter = new WhisperLiveKitSttAdapter({ transport: fake })
    expect(() => adapter.send(new Int16Array([0]))).toThrow(/send\(\) before connect\(\)/)
  })

  it('close() sends the end-of-stream empty frame then closes; idempotent', async () => {
    const fake = new FakeWsTransport([])
    const adapter = new WhisperLiveKitSttAdapter({ transport: fake })
    await adapter.connect()
    await adapter.close()
    expect(fake.sent[fake.sent.length - 1].length).toBe(0) // empty binary frame
    expect(fake.closed).toBe(true)
    await expect(adapter.close()).resolves.toBeUndefined() // second close: no-op
  })

  it('close() before connect() is a no-op that settles', async () => {
    const fake = new FakeWsTransport([])
    const adapter = new WhisperLiveKitSttAdapter({ transport: fake })
    await expect(adapter.close()).resolves.toBeUndefined()
    expect(fake.closed).toBe(false) // transport never touched
  })

  it('connect() failure rejects AND fires onError with the error', async () => {
    class FailingTransport implements WsTransport {
      onMessage(cb: (data: string) => void): void {
        void cb // registered by the adapter at construction; never invoked
      }
      async connect(): Promise<void> {
        throw new Error('connection refused')
      }
      send(data: Uint8Array): void {
        void data // unreachable: connect() always throws
      }
      async close(): Promise<void> {
        return Promise.resolve() // unreachable: connect() always throws
      }
    }
    const adapter = new WhisperLiveKitSttAdapter({ transport: new FailingTransport() })
    const errors: Error[] = []
    adapter.onError((err) => errors.push(err))
    await expect(adapter.connect()).rejects.toThrow('connection refused')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe('connection refused')
  })
})

describe('createSttAdapter(local-whisperlivekit) factory (step-9 branch fill)', () => {
  it('returns an adapter with all six SttAdapter methods, synchronously', () => {
    const adapter = createSttAdapter('local-whisperlivekit')
    expect(typeof adapter.connect).toBe('function')
    expect(typeof adapter.send).toBe('function')
    expect(typeof adapter.onPartial).toBe('function')
    expect(typeof adapter.onFinal).toBe('function')
    expect(typeof adapter.onError).toBe('function')
    expect(typeof adapter.close).toBe('function')
  })

  it('factory adapter send() before connect() throws', () => {
    const adapter = createSttAdapter('local-whisperlivekit')
    expect(() => adapter.send(new Int16Array([0]))).toThrow(/send\(\) before connect\(\)/)
  })

  it('factory adapter buffers callback registrations made before connect()', () => {
    const adapter = createSttAdapter('local-whisperlivekit')
    const partials: string[] = []
    adapter.onPartial((text) => partials.push(text))
    adapter.onFinal(() => {})
    adapter.onError(() => {})
    expect(partials).toEqual([]) // buffered, nothing fired yet
    // close() before any connect() settles and clears the buffer.
    return expect(adapter.close()).resolves.toBeUndefined()
  })
})

describe('dual-track (plan step 19): two adapter instances = two independent wlk sessions', () => {
  it('each instance owns its callbacks, seq counter, transport, and close (no cross-talk)', async () => {
    const fakeA = new FakeWsTransport(fixture)
    const fakeB = new FakeWsTransport(fixture)
    const adapterA = new WhisperLiveKitSttAdapter({ transport: fakeA })
    const adapterB = new WhisperLiveKitSttAdapter({ transport: fakeB })
    const eventsA: Array<{ kind: 'partial' | 'final'; text: string; seq: number }> = []
    const eventsB: Array<{ kind: 'partial' | 'final'; text: string; seq: number }> = []
    adapterA.onPartial((text, seq) => eventsA.push({ kind: 'partial', text, seq }))
    adapterA.onFinal((text, seq) => eventsA.push({ kind: 'final', text, seq }))
    adapterB.onPartial((text, seq) => eventsB.push({ kind: 'partial', text, seq }))
    adapterB.onFinal((text, seq) => eventsB.push({ kind: 'final', text, seq }))

    await Promise.all([adapterA.connect(), adapterB.connect()])

    // Same fixture replayed into two instances -> two independent, identical
    // streams; the mic track and the loopback track cannot share state.
    expect(eventsA).toEqual(eventsB)
    expect(eventsA).toHaveLength(4)
    // seq counters advanced independently and identically (fixture-driven).
    expect(eventsA[3].seq).toBe(1)
    expect(eventsB[3].seq).toBe(1)

    // Independent send paths: interleaved sends land on their own transport.
    adapterA.send(new Int16Array([1]))
    adapterB.send(new Int16Array([2]))
    expect(fakeA.sent).toHaveLength(1)
    expect(fakeB.sent).toHaveLength(1)

    // close() closes only its own transport.
    await adapterA.close()
    expect(fakeA.closed).toBe(true)
    expect(fakeB.closed).toBe(false)
  })

  it('the factory returns a NEW instance per call (two sessions, not a singleton)', () => {
    const mic = createSttAdapter('local-whisperlivekit')
    const loopback = createSttAdapter('local-whisperlivekit')
    expect(mic).not.toBe(loopback)
  })
})

/**
 * Minimal socket fake for the REAL NodeWsTransport (audit plan step 13): the
 * transport is constructed with a wsFactory that returns these, so the
 * reconnect machinery itself is what runs -- no global WebSocket is touched.
 * Sockets NEVER open on their own: each test opens or refuses a dial
 * explicitly, which makes every reconnect chain deterministic.
 */
class FakeSocket {
  readonly sent: Uint8Array[] = []
  closeCalled = false
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null

  send(data: Uint8Array): void {
    this.sent.push(data)
  }
  close(): void {
    this.closeCalled = true
    this.onclose?.()
  }
  /** Dial succeeded (post-open lifecycle begins). */
  open(): void {
    this.onopen?.()
  }
  /** Unexpected close AFTER an established connection (the step-13 trigger). */
  drop(): void {
    this.onclose?.()
  }
  /** Failed dial pre-open: error then close, in undici's order. */
  refuse(): void {
    this.onerror?.()
    this.onclose?.()
  }
  message(data: string): void {
    this.onmessage?.({ data })
  }
}

function makeFactory(sockets: FakeSocket[], urls: string[]): (url: string) => WebSocket {
  return (url: string): WebSocket => {
    urls.push(url)
    const s = new FakeSocket()
    sockets.push(s)
    return s as unknown as WebSocket
  }
}

async function until(cond: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`until: timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

const graceWait = (): Promise<void> => new Promise((r) => setTimeout(r, 40))

describe('NodeWsTransport reconnect (audit plan step 13)', () => {
  /**
   * Seams under test:
   * - an unexpected close AFTER an established connection redials the SAME url
   *   with bounded backoff; send()/onMessage reroute to the new socket.
   * - exhausting maxReconnectAttempts fires onError ONCE (terminal).
   * - deliberate close() never redials (also suppresses late close events).
   * - a failed INITIAL connect keeps rejecting connect() and does NOT enter
   *   the reconnect loop (step-12 startup contract).
   */

  it('redials the same url after an established connection drops unexpectedly', async () => {
    const sockets: FakeSocket[] = []
    const urls: string[] = []
    const received: string[] = []
    const t = new NodeWsTransport({
      wsFactory: makeFactory(sockets, urls),
      maxReconnectAttempts: 2,
      reconnectBaseDelayMs: 5
    })
    t.onMessage((d) => received.push(d))

    const connecting = t.connect('ws://127.0.0.1:9999/asr')
    await until(() => sockets.length === 1, 'initial dial')
    sockets[0].open()
    await connecting

    t.send(new Uint8Array([1]))
    expect(sockets[0].sent).toHaveLength(1)

    sockets[0].drop() // mid-session drop
    await until(() => sockets.length === 2 && urls.length === 2, 'redial')
    sockets[1].open()
    // Same endpoint, new socket; send routes there now.
    expect(urls[1]).toBe('ws://127.0.0.1:9999/asr')
    t.send(new Uint8Array([2]))
    expect(sockets[1].sent).toHaveLength(1)
    // The message callback survived the redial untouched.
    sockets[1].message('after-reconnect')
    expect(received).toEqual(['after-reconnect'])
    await t.close()
  })

  it('exhausting the reconnect budget fires onError once, then stops dialing', async () => {
    const sockets: FakeSocket[] = []
    const urls: string[] = []
    const errors: Error[] = []
    const t = new NodeWsTransport({
      wsFactory: makeFactory(sockets, urls),
      maxReconnectAttempts: 2,
      reconnectBaseDelayMs: 5
    })
    t.onError((err) => errors.push(err))

    const connecting = t.connect('ws://127.0.0.1:9999/asr')
    await until(() => sockets.length === 1, 'initial dial')
    sockets[0].open()
    await connecting

    sockets[0].drop()
    // Each redial appears, then refuses -- repeated failure.
    await until(() => sockets.length === 2, 'redial attempt 1')
    sockets[1].refuse()
    await until(() => sockets.length === 3, 'redial attempt 2')
    sockets[2].refuse()
    await until(() => errors.length === 1, 'terminal error')

    expect(errors[0].message).toMatch(/gave up after 2 attempt/)
    await graceWait()
    expect(sockets).toHaveLength(3) // no further dials
    expect(errors).toHaveLength(1) // reported exactly once
  })

  it('close() is deliberate: no redial even from late close events', async () => {
    const sockets: FakeSocket[] = []
    const urls: string[] = []
    const errors: Error[] = []
    const t = new NodeWsTransport({
      wsFactory: makeFactory(sockets, urls),
      maxReconnectAttempts: 2,
      reconnectBaseDelayMs: 5
    })
    t.onError((err) => errors.push(err))

    const connecting = t.connect('ws://127.0.0.1:9999/asr')
    await until(() => sockets.length === 1, 'initial dial')
    sockets[0].open()
    await connecting

    await t.close()
    expect(sockets[0].closeCalled).toBe(true)
    sockets[0].drop() // late close of the already-closed socket
    await graceWait()
    expect(sockets).toHaveLength(1)
    expect(errors).toHaveLength(0)
  })

  it('a failed INITIAL connect rejects without entering the reconnect loop', async () => {
    const sockets: FakeSocket[] = []
    const urls: string[] = []
    const errors: Error[] = []
    const t = new NodeWsTransport({
      wsFactory: makeFactory(sockets, urls),
      maxReconnectAttempts: 3,
      reconnectBaseDelayMs: 5
    })
    t.onError((err) => errors.push(err))

    const connecting = t.connect('ws://127.0.0.1:9999/asr')
    await until(() => sockets.length === 1, 'initial dial')
    sockets[0].refuse()
    await expect(connecting).rejects.toThrow(/WS error connecting/)
    await graceWait()
    expect(sockets).toHaveLength(1)
    expect(errors).toHaveLength(0)
  })
})

describe('reconnect preserves committed transcript segments (audit plan step 13)', () => {
  /**
   * The duplication hazard, concretely: index.ts builds segmentId as
   * `${kind}:${source}:${seq}`. If a reconnect reset the adapter's seq to 0,
   * post-reconnect finals would REUSE committed segmentIds and the step-9
   * reducer would REPLACE old lines with new audio's text (silent data loss).
   * This drives the REAL NodeWsTransport over fake sockets through the REAL
   * adapter with the REAL fixture and proves:
   * - committed finals before the drop are NOT re-emitted after reconnect;
   * - the seq counter continues monotonically across the reconnect boundary;
   * - post-reconnect finals carry fresh wlk segmentIds (new start timestamp).
   */
  const CONTINUATION_PARTIAL = JSON.stringify({
    status: 'active_transcription',
    lines: [],
    buffer_transcription: ' recovered after the drop',
    buffer_diarization: '',
    buffer_translation: ''
  })
  const CONTINUATION_FINAL = JSON.stringify({
    status: 'active_transcription',
    lines: [
      {
        speaker: 2,
        text: ' recovered after the drop',
        start: '0:00:07.10',
        end: '0:00:08.20',
        detected_language: 'en'
      }
    ],
    buffer_transcription: '',
    buffer_diarization: '',
    buffer_translation: ''
  })

  it('seq continues and committed segments are not replayed after reconnect', async () => {
    const sockets: FakeSocket[] = []
    const urls: string[] = []
    const transport = new NodeWsTransport({
      wsFactory: makeFactory(sockets, urls),
      maxReconnectAttempts: 2,
      reconnectBaseDelayMs: 5
    })
    const adapter = new WhisperLiveKitSttAdapter({ transport })
    const events: Array<{ kind: string; text: string; seq: number }> = []
    adapter.onPartial((text, seq) => events.push({ kind: 'partial', text, seq }))
    adapter.onFinal((text, seq) => events.push({ kind: 'final', text, seq }))

    const connecting = adapter.connect()
    await until(() => sockets.length === 1, 'initial dial')
    sockets[0].open()
    await connecting

    // Real fixture: two partials (segment 0 revisions) + first final commits it.
    sockets[0].message(fixture[9])
    sockets[0].message(fixture[10])
    sockets[0].message(fixture[11])
    expect(events.map((e) => [e.kind, e.seq])).toEqual([
      ['partial', 0],
      ['partial', 0],
      ['final', 0]
    ])

    sockets[0].drop() // wlk died; transport reconnects underneath the adapter
    await until(() => sockets.length === 2, 'transport redial')
    sockets[1].open()

    // Fresh wlk session: continuation partial + final on the NEW socket.
    sockets[1].message(CONTINUATION_PARTIAL)
    sockets[1].message(CONTINUATION_FINAL)

    expect(events).toEqual([
      { kind: 'partial', text: 'Testing 1', seq: 0 },
      { kind: 'partial', text: 'Testing 1, 2, 3', seq: 0 },
      { kind: 'final', text: 'testing 1, 2, 3. This is the Vero meeting transcription', seq: 0 },
      { kind: 'partial', text: 'recovered after the drop', seq: 1 },
      { kind: 'final', text: 'recovered after the drop', seq: 1 }
    ])
    // No committed segment was emitted twice: every (kind,text,seq) unique.
    const keys = events.map((e) => `${e.kind}:${e.text}:${e.seq}`)
    expect(new Set(keys).size).toBe(keys.length)
    await adapter.close()
  })

  it('adapter-level onError surfaces terminal reconnect failure to the session seam', async () => {
    const sockets: FakeSocket[] = []
    const urls: string[] = []
    const transport = new NodeWsTransport({
      wsFactory: makeFactory(sockets, urls),
      maxReconnectAttempts: 1,
      reconnectBaseDelayMs: 5
    })
    const adapter = new WhisperLiveKitSttAdapter({ transport })
    const errors: Error[] = []
    adapter.onError((err) => errors.push(err))

    const connecting = adapter.connect()
    await until(() => sockets.length === 1, 'initial dial')
    sockets[0].open()
    await connecting

    sockets[0].drop()
    await until(() => sockets.length === 2, 'redial')
    sockets[1].refuse()

    await until(() => errors.length === 1, 'adapter error')
    expect(errors[0].message).toMatch(/gave up after 1 attempt/)
  })
})
