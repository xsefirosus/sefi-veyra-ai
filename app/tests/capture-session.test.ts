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
} {
  let connectCalls = 0
  let closeCalls = 0
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
