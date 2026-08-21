import { describe, expect, it } from 'vitest'
import {
  CaptureSession,
  type CaptureAdapter,
  type CaptureServer
} from '../src/main/capture/capture-session'

/**
 * Seams under test (plan step 2):
 * - CaptureSession state machine: idle | starting | listening | stopping | error + lastError
 * - start(settings) spawns WlkServer with settings.sttModel, awaits adapter.connect(), transitions to listening
 * - double-start rejects
 * - stop before start is a no-op
 * - adapter failure -> error with server shutdown (no orphan)
 * - stop tears down reverse (adapter.close, server.shutdown)
 *
 * Pure lifecycle logic with injected fakes -- no Electron import.
 */

function fakeServer(
  opts: { startImpl?: () => Promise<void>; shutdownImpl?: () => Promise<void> } = {}
): CaptureServer & {
  startCalls: number
  shutdownCalls: number
} {
  let startCalls = 0
  let shutdownCalls = 0
  return {
    get startCalls() {
      return startCalls
    },
    get shutdownCalls() {
      return shutdownCalls
    },
    async start() {
      startCalls++
      if (opts.startImpl) await opts.startImpl()
    },
    async shutdown() {
      shutdownCalls++
      if (opts.shutdownImpl) await opts.shutdownImpl()
    }
  }
}

function fakeAdapter(
  opts: { connectImpl?: () => Promise<void>; closeImpl?: () => Promise<void> } = {}
): CaptureAdapter & {
  connectCalls: number
  closeCalls: number
  emitError(err: Error): void
  hasErrorCb(): boolean
} {
  let connectCalls = 0
  let closeCalls = 0
  let errorCb: ((err: Error) => void) | null = null
  return {
    get connectCalls() {
      return connectCalls
    },
    get closeCalls() {
      return closeCalls
    },
    async connect() {
      connectCalls++
      if (opts.connectImpl) await opts.connectImpl()
    },
    async close() {
      closeCalls++
      if (opts.closeImpl) await opts.closeImpl()
    },
    onError(cb: (err: Error) => void): void {
      errorCb = cb
    },
    emitError(err: Error): void {
      if (!errorCb) throw new Error('fakeAdapter: no onError registered')
      errorCb(err)
    },
    hasErrorCb(): boolean {
      return errorCb !== null
    }
  }
}

describe('CaptureSession', () => {
  it('start -> listening with server spawned using settings.sttModel', async () => {
    let capturedModel: string | null = null
    const server = fakeServer()
    const adapter = fakeAdapter()
    const session = new CaptureSession({
      createServer: (model) => {
        capturedModel = model
        return server
      },
      createAdapter: () => adapter
    })

    expect(session.state).toBe('idle')
    expect(session.lastError).toBeNull()

    await session.start({ sttModel: 'base' })

    expect(capturedModel).toBe('base')
    expect(server.startCalls).toBe(1)
    expect(adapter.connectCalls).toBe(1)
    expect(session.state).toBe('listening')
    expect(session.lastError).toBeNull()
  })

  it('double-start rejects and second start does not create side effects', async () => {
    const server = fakeServer()
    const adapter = fakeAdapter()
    let createCalls = 0
    const session = new CaptureSession({
      createServer: () => {
        createCalls++
        return server
      },
      createAdapter: () => adapter
    })

    await session.start({ sttModel: 'tiny' })
    expect(session.state).toBe('listening')

    await expect(session.start({ sttModel: 'tiny' })).rejects.toThrow(
      /cannot start while listening/
    )
    // No additional server creation after double-start
    expect(createCalls).toBe(1)
    expect(session.state).toBe('listening')
  })

  it('stop before start is a no-op (idle stays idle, no shutdown)', async () => {
    const server = fakeServer()
    const adapter = fakeAdapter()
    const session = new CaptureSession({
      createServer: () => server,
      createAdapter: () => adapter
    })

    expect(session.state).toBe('idle')
    await expect(session.stop()).resolves.toBeUndefined()
    expect(session.state).toBe('idle')
    expect(server.shutdownCalls).toBe(0)
    expect(adapter.closeCalls).toBe(0)
  })

  it('adapter failure lands in error with lastError set and server shut down (no orphan)', async () => {
    const server = fakeServer()
    const adapter = fakeAdapter({
      connectImpl: async () => {
        throw new Error('adapter connect boom')
      }
    })
    const session = new CaptureSession({
      createServer: () => server,
      createAdapter: () => adapter
    })

    await expect(session.start({ sttModel: 'small' })).rejects.toThrow('adapter connect boom')
    expect(session.state).toBe('error')
    expect(session.lastError?.message).toBe('adapter connect boom')
    expect(server.shutdownCalls).toBe(1)
  })

  it('server start failure lands in error with lastError and no adapter connect', async () => {
    const server = fakeServer({
      startImpl: async () => {
        throw new Error('server spawn failed')
      }
    })
    const adapter = fakeAdapter()
    const session = new CaptureSession({
      createServer: () => server,
      createAdapter: () => adapter
    })

    await expect(session.start({ sttModel: 'tiny' })).rejects.toThrow('server spawn failed')
    expect(session.state).toBe('error')
    expect(session.lastError?.message).toBe('server spawn failed')
    expect(adapter.connectCalls).toBe(0)
    // Server shutdown is still attempted to avoid orphans even when start failed
    expect(server.shutdownCalls).toBe(1)
  })

  it('stop tears down in reverse (adapter close, server shutdown) and returns to idle', async () => {
    const order: string[] = []
    const server = fakeServer({
      shutdownImpl: async () => {
        order.push('server.shutdown')
      }
    })
    const adapter = fakeAdapter({
      closeImpl: async () => {
        order.push('adapter.close')
      }
    })
    const session = new CaptureSession({
      createServer: () => server,
      createAdapter: () => adapter
    })

    await session.start({ sttModel: 'tiny' })
    expect(session.state).toBe('listening')

    await session.stop()
    expect(order).toEqual(['adapter.close', 'server.shutdown'])
    expect(session.state).toBe('idle')
    expect(session.lastError).toBeNull()
  })

  it('stop is idempotent after first stop', async () => {
    const server = fakeServer()
    const adapter = fakeAdapter()
    const session = new CaptureSession({
      createServer: () => server,
      createAdapter: () => adapter
    })
    await session.start({ sttModel: 'tiny' })
    await session.stop()
    expect(session.state).toBe('idle')
    await expect(session.stop()).resolves.toBeUndefined()
    expect(session.state).toBe('idle')
  })
})

describe('CaptureSession error surfacing (audit plan step 12)', () => {
  /**
   * Seams under test:
   * - A runtime adapter onError while listening transitions the session to
   *   `error` with lastError set and emits a state change, so main's
   *   session-state broadcast carries the message to both status chips.
   * - The session registers onError itself (WhisperLiveKitSttAdapter.onError
   *   is a single slot) for every adapter it creates, before connect().
   * - fail() is guarded: ignored outside `listening` (starting-phase errors
   *   belong to start()'s own catch; late errors must not resurrect an error
   *   chip after a clean stop), idempotent once in error.
   * - start() is allowed again from `error` (all refs are cleared there), so
   *   a failed spawn does not permanently brick the Start button.
   */

  it('runtime adapter error while listening lands in error with lastError and emits', async () => {
    const server = fakeServer()
    const adapter = fakeAdapter()
    const session = new CaptureSession({
      createServer: () => server,
      createAdapter: () => adapter
    })
    await session.start({ sttModel: 'tiny' })

    const seen: Array<{ state: string; lastError: Error | null }> = []
    session.onStateChange((state, lastError) => seen.push({ state, lastError }))

    adapter.emitError(new Error('socket dropped'))

    expect(session.state).toBe('error')
    expect(session.lastError?.message).toBe('socket dropped')
    // The broadcast seam: main re-emits exactly this on 'session-state'.
    expect(seen).toEqual([{ state: 'error', lastError: expect.any(Error) }])
  })

  it('dual-track: a loopback adapter error also fails the session', async () => {
    const mic = fakeAdapter()
    const loopback = fakeAdapter()
    const server = fakeServer()
    const session = new CaptureSession({
      createServer: () => server,
      createMicAdapter: () => mic,
      createLoopbackAdapter: () => loopback
    })
    await session.start({ sttModel: 'tiny' })

    loopback.emitError(new Error('loopback ws closed'))

    expect(session.state).toBe('error')
    expect(session.lastError?.message).toBe('loopback ws closed')
  })

  it('registers onError on each adapter before connect()', async () => {
    let connectCalls = 0
    const adapter = fakeAdapter({
      connectImpl: async () => {
        connectCalls++
        // The handler must already be wired when connect() runs, so an async
        // failure racing the transition is not lost.
        expect(adapter.hasErrorCb()).toBe(true)
      }
    })
    const session = new CaptureSession({
      createServer: () => fakeServer(),
      createAdapter: () => adapter
    })
    await session.start({ sttModel: 'tiny' })
    expect(connectCalls).toBe(1)
  })

  it('fail() is ignored outside listening (no resurrected error chip after clean stop)', async () => {
    const server = fakeServer()
    const adapter = fakeAdapter()
    const session = new CaptureSession({
      createServer: () => server,
      createAdapter: () => adapter
    })
    await session.start({ sttModel: 'tiny' })
    await session.stop()

    adapter.emitError(new Error('late socket error'))

    expect(session.state).toBe('idle')
    expect(session.lastError).toBeNull()
  })

  it('fail() is idempotent while in error (second adapter error does not re-emit)', async () => {
    const server = fakeServer()
    const mic = fakeAdapter()
    const loopback = fakeAdapter()
    const session = new CaptureSession({
      createServer: () => server,
      createMicAdapter: () => mic,
      createLoopbackAdapter: () => loopback
    })
    await session.start({ sttModel: 'tiny' })

    const seen: string[] = []
    session.onStateChange((state) => seen.push(state))
    mic.emitError(new Error('mic died'))
    loopback.emitError(new Error('loopback died too'))

    expect(session.state).toBe('error')
    expect(session.lastError?.message).toBe('mic died')
    // Only ONE error emission: the first failure wins; no duplicate broadcasts.
    expect(seen.filter((s) => s === 'error')).toEqual(['error'])
  })

  it('start() is allowed again from error so a failed spawn does not brick Start', async () => {
    let attempts = 0
    const server = fakeServer({
      startImpl: async () => {
        attempts++
        if (attempts === 1) throw new Error('spawn failed')
      }
    })
    const adapter = fakeAdapter()
    const session = new CaptureSession({
      createServer: () => server,
      createAdapter: () => adapter
    })

    await expect(session.start({ sttModel: 'tiny' })).rejects.toThrow('spawn failed')
    expect(session.state).toBe('error')

    // User fixes the environment (or wlk recovers) and presses Start again.
    await session.start({ sttModel: 'tiny' })
    expect(session.state).toBe('listening')
    expect(server.startCalls).toBe(2)
    expect(session.lastError).toBeNull()
  })
})

describe('CaptureSession server give-up wiring (audit plan step 13)', () => {
  /**
   * Seams under test:
   * - CaptureServer.onGiveUp (optional, audit step 13): the session registers
   *   a handler at start(), so a wlk restart budget exhausted MID-MEETING is
   *   routed into fail() -- state 'error' + lastError + the step-12 broadcast
   *   -- instead of vanishing into a console log.
   * - The guard semantics are fail()'s own (step 12): exhaustion outside
   *   `listening` (e.g. a late report after a clean stop) must not resurrect
   *   an error chip over `idle`.
   */

  /** Wraps fakeServer with an onGiveUp registration slot. */
  function fakeServerWithGiveUp(
    base = fakeServer()
  ): CaptureServer & { emitGiveUp(err: Error): void } {
    let cb: ((err: Error) => void) | null = null
    return {
      start: () => base.start(),
      shutdown: () => base.shutdown(),
      onGiveUp: (registered) => {
        cb = registered
      },
      emitGiveUp: (err) => {
        if (!cb) throw new Error('fakeServerWithGiveUp: no onGiveUp registered')
        cb(err)
      }
    }
  }

  it('server give-up while listening lands in error with lastError and emits', async () => {
    const server = fakeServerWithGiveUp()
    const session = new CaptureSession({
      createServer: () => server,
      createAdapter: () => fakeAdapter()
    })
    await session.start({ sttModel: 'tiny' })
    expect(session.state).toBe('listening')

    const seen: Array<{ state: string; lastError: string | null }> = []
    session.onStateChange((state, lastError) =>
      seen.push({ state, lastError: lastError?.message ?? null })
    )

    server.emitGiveUp(new Error('wlk crashed and gave up after 3 restart attempt(s)'))

    expect(session.state).toBe('error')
    expect(session.lastError?.message).toContain('gave up after 3 restart attempt')
    // The broadcast seam: main re-emits exactly this on 'session-state'.
    expect(seen).toEqual([
      { state: 'error', lastError: expect.stringContaining('gave up after 3') }
    ])
  })

  it('a give-up reported after a clean stop does not resurrect the error chip', async () => {
    const server = fakeServerWithGiveUp()
    const session = new CaptureSession({
      createServer: () => server,
      createAdapter: () => fakeAdapter()
    })
    await session.start({ sttModel: 'tiny' })
    await session.stop()

    server.emitGiveUp(new Error('late exhaustion'))

    expect(session.state).toBe('idle')
    expect(session.lastError).toBeNull()
  })

  it('give-up during recovery keeps the session listening until exhaustion', async () => {
    // While WlkServer is still within its restart budget it emits NOTHING --
    // the session stays 'listening'. Only the terminal report fails it.
    const server = fakeServerWithGiveUp()
    const mic = fakeAdapter()
    const loopback = fakeAdapter()
    const session = new CaptureSession({
      createServer: () => server,
      createMicAdapter: () => mic,
      createLoopbackAdapter: () => loopback
    })
    await session.start({ sttModel: 'tiny' })

    const states: string[] = []
    session.onStateChange((state) => states.push(state))
    // No emission == no crash episode surfaced yet; assert by NOT emitting.
    expect(states).toEqual([])

    server.emitGiveUp(new Error('exhausted'))
    expect(session.state).toBe('error')
    expect(states).toEqual(['error'])
  })
})
