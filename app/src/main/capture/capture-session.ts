/**
 * CaptureSession lifecycle owner (plan steps 2-3).
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
 *
 * Step 3: dual-track -- one wlk process, two WS sessions (mic + loopback).
 * Legacy single-adapter mode (createAdapter injected, as in unit tests) is
 * preserved for backward compatibility; the default (no injected factory)
 * creates two adapters via createSttAdapter({source, model}).
 */

import { createSttAdapter } from '../../shared/stt/stt-adapter'
import { WlkServer, type WlkModel } from '../stt/wlk-server'

export type CaptureSessionState = 'idle' | 'starting' | 'listening' | 'stopping' | 'error'

export interface CaptureServer {
  start(): Promise<void>
  shutdown(): Promise<void>
  /**
   * Audit step 13: fires ONCE when the server's bounded restart budget is
   * exhausted (crash recovery gave up). Optional so legacy fakes satisfy the
   * type; the real WlkServer implements it via onGaveUp().
   */
  onGiveUp?(cb: (err: Error) => void): void
}

export interface CaptureAdapter {
  connect(): Promise<void>
  close(): Promise<void>
  // SttAdapter surface -- optional so legacy fakes (tests) still satisfy the type,
  // but real adapters (WhisperLiveKitSttAdapter) carry these.
  send?(pcm: Int16Array): void
  onPartial?(cb: (text: string, seq: number) => void): void
  onFinal?(cb: (text: string, seq: number) => void): void
  onError?(cb: (err: Error) => void): void
}

export interface CaptureSessionOptions {
  /** Factory for the wlk server; defaults to real WlkServer(model). */
  createServer?: (model: WlkModel) => CaptureServer
  /** Legacy single-adapter factory (used by unit tests). When present, single-adapter mode is used. */
  createAdapter?: () => CaptureAdapter
  /** Factory for the mic track adapter; defaults to createSttAdapter({source:'mic', model}). */
  createMicAdapter?: (model: WlkModel) => CaptureAdapter
  /** Factory for the loopback track adapter; defaults to createSttAdapter({source:'loopback', model}). */
  createLoopbackAdapter?: (model: WlkModel) => CaptureAdapter
}

export interface CaptureSettings {
  sttModel: WlkModel
}

export class CaptureSession {
  private _state: CaptureSessionState = 'idle'
  private _lastError: Error | null = null
  private server: CaptureServer | null = null
  // Legacy single adapter
  private _adapter: CaptureAdapter | null = null
  // Dual-track adapters
  private _micAdapter: CaptureAdapter | null = null
  private _loopbackAdapter: CaptureAdapter | null = null
  private readonly createServer: (model: WlkModel) => CaptureServer
  private readonly createAdapterLegacy: (() => CaptureAdapter) | null
  private readonly createMicAdapter: (model: WlkModel) => CaptureAdapter
  private readonly createLoopbackAdapter: (model: WlkModel) => CaptureAdapter
  private readonly useLegacy: boolean
  private stateListeners: Array<(state: CaptureSessionState, lastError: Error | null) => void> = []

  constructor(opts: CaptureSessionOptions = {}) {
    this.createServer =
      opts.createServer ?? ((model: WlkModel) => new WlkServer(model) as unknown as CaptureServer)
    if (opts.createAdapter) {
      this.useLegacy = true
      this.createAdapterLegacy = opts.createAdapter
      // Dummy factories -- never called in legacy mode
      this.createMicAdapter = () => {
        throw new Error('capture-session: createMicAdapter not used in legacy mode')
      }
      this.createLoopbackAdapter = () => {
        throw new Error('capture-session: createLoopbackAdapter not used in legacy mode')
      }
    } else {
      this.useLegacy = false
      this.createAdapterLegacy = null
      this.createMicAdapter =
        opts.createMicAdapter ??
        ((model: WlkModel) =>
          createSttAdapter('local-whisperlivekit', {
            source: 'mic',
            model
          }) as unknown as CaptureAdapter)
      this.createLoopbackAdapter =
        opts.createLoopbackAdapter ??
        ((model: WlkModel) =>
          createSttAdapter('local-whisperlivekit', {
            source: 'loopback',
            model
          }) as unknown as CaptureAdapter)
    }
  }

  get state(): CaptureSessionState {
    return this._state
  }

  get lastError(): Error | null {
    return this._lastError
  }

  /** Mic adapter (or the sole legacy adapter). Null before start(). */
  get micAdapter(): CaptureAdapter | null {
    if (this.useLegacy) return this._adapter
    return this._micAdapter
  }

  /** Loopback adapter. Null in legacy single-adapter mode or before start(). */
  get loopbackAdapter(): CaptureAdapter | null {
    if (this.useLegacy) return null
    return this._loopbackAdapter
  }

  /** Legacy accessor -- the sole adapter in single-adapter mode */
  get adapter(): CaptureAdapter | null {
    return this._adapter
  }

  /** Subscribe to state changes; returns unsubscribe fn. */
  onStateChange(cb: (state: CaptureSessionState, lastError: Error | null) => void): () => void {
    this.stateListeners.push(cb)
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== cb)
    }
  }

  private emitStateChange(): void {
    for (const cb of this.stateListeners) {
      try {
        cb(this._state, this._lastError)
      } catch {
        // listener errors must not break lifecycle
      }
    }
  }

  private setState(s: CaptureSessionState): void {
    this._state = s
    this.emitStateChange()
  }

  /**
   * Start a capture session. Validates trust boundary, spawns the wlk server
   * with the requested model, then connects the STT adapter(s). Guards against
   * double-start: only allowed from `idle` -- or from `error`, where the
   * previous attempt's refs were all cleared (audit step 12: a failed spawn
   * must not permanently brick the Start control).
   */
  async start(settings: CaptureSettings): Promise<void> {
    if (this._state !== 'idle' && this._state !== 'error') {
      throw new Error(`capture-session: cannot start while ${this._state}`)
    }
    if (!settings || typeof settings.sttModel !== 'string') {
      throw new Error('capture-session: settings.sttModel is required')
    }
    const model = settings.sttModel
    if (model !== 'tiny' && model !== 'base' && model !== 'small') {
      throw new Error(`capture-session: unsupported sttModel "${String(model)}"`)
    }

    this.setState('starting')
    this._lastError = null

    let server: CaptureServer | null = null
    let legacyAdapter: CaptureAdapter | null = null
    let mic: CaptureAdapter | null = null
    let loopback: CaptureAdapter | null = null

    try {
      server = this.createServer(model)
      this.server = server
      // Audit step 13: restart-budget exhaustion is a terminal server failure.
      // Route it into fail() so it lands on the step-12 path (state 'error' +
      // lastError -> session-state broadcast -> status chip). While recovery
      // is still in flight the session stays 'listening'; only the terminal
      // give-up fails the session.
      server.onGiveUp?.((err) => this.fail(err))
      await server.start()

      if (this.useLegacy) {
        legacyAdapter = this.createAdapterLegacy!()
        this._adapter = legacyAdapter
        // Audit step 12: route runtime adapter errors into the state machine
        // BEFORE connect(), so a socket failure racing the transition (or
        // dropping later mid-listening) reaches the session-state broadcast
        // instead of vanishing. WhisperLiveKitSttAdapter.onError is a single
        // slot -- this wiring is THE owner; callers must not re-register.
        legacyAdapter.onError?.((err) => this.fail(err))
        await legacyAdapter.connect()
      } else {
        mic = this.createMicAdapter(model)
        this._micAdapter = mic
        mic.onError?.((err) => this.fail(err))
        await mic.connect()
        loopback = this.createLoopbackAdapter(model)
        this._loopbackAdapter = loopback
        loopback.onError?.((err) => this.fail(err))
        await loopback.connect()
      }

      this.setState('listening')
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      // Best-effort teardown of anything that was partially started (no orphan process).
      if (loopback) {
        try {
          await loopback.close()
        } catch {
          // ignore
        }
      }
      if (mic) {
        try {
          await mic.close()
        } catch {
          // ignore
        }
      }
      if (legacyAdapter) {
        try {
          await legacyAdapter.close()
        } catch {
          // ignore
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
      this._adapter = null
      this._micAdapter = null
      this._loopbackAdapter = null
      this.server = null
      this._state = 'error'
      this._lastError = error
      this.emitStateChange()
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

    this.setState('stopping')

    const legacyAdapter = this._adapter
    const mic = this._micAdapter
    const loopback = this._loopbackAdapter
    const server = this.server

    try {
      // Close adapters in reverse of connect order (loopback first, then mic/legacy)
      if (loopback) {
        await loopback.close()
      }
      if (mic) {
        await mic.close()
      }
      if (legacyAdapter) {
        await legacyAdapter.close()
      }
      if (server) {
        await server.shutdown()
      }
      this._adapter = null
      this._micAdapter = null
      this._loopbackAdapter = null
      this.server = null
      this._lastError = null
      this.setState('idle')
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this._state = 'error'
      this._lastError = error
      this._adapter = null
      this._micAdapter = null
      this._loopbackAdapter = null
      this.server = null
      this.emitStateChange()
      throw error
    }
  }

  /**
   * Report a runtime adapter/transport error (audit step 12): transition
   * `listening` -> `error` with lastError and emit a state change, so main's
   * onStateChange subscription broadcasts {state:'error', lastError} to both
   * windows and the status chip shows "Error: <message>".
   *
   * Guards:
   * - Only acts from `listening`. Errors during `starting` are owned by
   *   start()'s own catch (which also tears down partial state); late errors
   *   after a clean stop must not resurrect an error chip over `idle`.
   * - Idempotent: the FIRST error wins; later ones do not re-emit duplicate
   *   broadcasts. Recovery/restart-with-backoff is audit step 13.
   */
  fail(err: unknown): void {
    if (this._state !== 'listening') return
    const error = err instanceof Error ? err : new Error(String(err))
    console.error('[capture] session error:', error.message)
    this._lastError = error
    this._state = 'error'
    this.emitStateChange()
  }
}
