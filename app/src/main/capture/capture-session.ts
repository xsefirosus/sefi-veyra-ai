/**
 * CaptureSession lifecycle owner (plan step 2).
 *
 * One object owns the ordered lifecycle that was previously missing:
 *   start(settings) -> spawn WlkServer with settings.sttModel
 *                   -> await adapter.connect() for each active track
 *                   -> state = listening
 *   stop()          -> tears down in reverse: adapter.close(), server.shutdown()
 *                   -> state = idle
 *
 * State machine: idle | starting | listening | stopping | error + lastError.
 * Pure lifecycle logic (ordering, guards, idempotency) is unit-testable with
 * injected fakes for server/adapter -- no Electron import in this module.
 */

import { createSttAdapter } from '../../shared/stt/stt-adapter'
import { WlkServer, type WlkModel } from '../stt/wlk-server'

export type CaptureSessionState = 'idle' | 'starting' | 'listening' | 'stopping' | 'error'

export interface CaptureServer {
  start(): Promise<void>
  shutdown(): Promise<void>
}

export interface CaptureAdapter {
  connect(): Promise<void>
  close(): Promise<void>
}

export interface CaptureSessionOptions {
  /** Factory for the wlk server; defaults to real WlkServer(model). */
  createServer?: (model: WlkModel) => CaptureServer
  /** Factory for the STT adapter; defaults to createSttAdapter('local-whisperlivekit'). */
  createAdapter?: () => CaptureAdapter
}

export interface CaptureSettings {
  sttModel: WlkModel
}

export class CaptureSession {
  private _state: CaptureSessionState = 'idle'
  private _lastError: Error | null = null
  private server: CaptureServer | null = null
  private adapter: CaptureAdapter | null = null
  private readonly createServer: (model: WlkModel) => CaptureServer
  private readonly createAdapter: () => CaptureAdapter

  constructor(opts: CaptureSessionOptions = {}) {
    this.createServer =
      opts.createServer ?? ((model: WlkModel) => new WlkServer(model) as unknown as CaptureServer)
    this.createAdapter = opts.createAdapter ?? (() => createSttAdapter('local-whisperlivekit'))
  }

  get state(): CaptureSessionState {
    return this._state
  }

  get lastError(): Error | null {
    return this._lastError
  }

  /**
   * Start a capture session. Validates trust boundary, spawns the wlk server
   * with the requested model, then connects the STT adapter(s). Guards against
   * double-start: only allowed from `idle`.
   */
  async start(settings: CaptureSettings): Promise<void> {
    if (this._state !== 'idle') {
      throw new Error(`capture-session: cannot start while ${this._state}`)
    }
    if (!settings || typeof settings.sttModel !== 'string') {
      throw new Error('capture-session: settings.sttModel is required')
    }
    const model = settings.sttModel
    if (model !== 'tiny' && model !== 'base' && model !== 'small') {
      throw new Error(`capture-session: unsupported sttModel "${String(model)}"`)
    }

    this._state = 'starting'
    this._lastError = null

    let server: CaptureServer | null = null
    let adapter: CaptureAdapter | null = null

    try {
      server = this.createServer(model)
      this.server = server
      await server.start()

      adapter = this.createAdapter()
      this.adapter = adapter
      await adapter.connect()

      this._state = 'listening'
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      // Best-effort teardown of anything that was partially started (no orphan process).
      if (adapter) {
        try {
          await adapter.close()
        } catch {
          // ignore teardown errors -- preserve original failure
        }
      }
      if (server) {
        try {
          await server.shutdown()
        } catch {
          // ignore
        }
      }
      // Clear refs so a later stop() is a no-op and start() can be retried from error->idle via stop()
      // but keep state as error per spec.
      this._state = 'error'
      this._lastError = error
      throw error
    }
  }

  /**
   * Stop the session, tearing down in reverse order (adapter.close, server.shutdown).
   * Idempotent: stop before start (idle) is a no-op. Safe to call from error
   * to reset to idle.
   */
  async stop(): Promise<void> {
    if (this._state === 'idle') return
    // If already stopping, treat as no-op (idempotent).
    if (this._state === 'stopping') return

    this._state = 'stopping'

    const adapter = this.adapter
    const server = this.server

    try {
      if (adapter) {
        await adapter.close()
      }
      if (server) {
        await server.shutdown()
      }
      this.adapter = null
      this.server = null
      this._state = 'idle'
      this._lastError = null
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this._state = 'error'
      this._lastError = error
      // Preserve refs for diagnostic? Clear them to avoid leaks.
      this.adapter = null
      this.server = null
      throw error
    }
  }
}
