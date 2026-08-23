/**
 * wlk spawn manager (plan step 13).
 *
 * Builds and manages the WhisperLiveKit (`wlk`) transcription server process
 * from the app's local venv (app/.wlk-venv, installed by step 12).
 *
 * ## Flag names -- confirmed on 2026-08-20, not invented
 * Run on this machine: `app/.wlk-venv/Scripts/wlk serve --help` -> exit 0:
 *   --host HOST  "The host address to bind the server to."
 *   --port PORT  "The port number to bind the server to."
 *   --model MODEL_SIZE  "Name size of the Whisper model to use (default: tiny)."
 *   Suggested --model values include tiny, base, small (tiny.en/base.en/small.en
 *   also exist; the settings UI only offers the plain three).
 * The same flags and defaults are in the installed package source
 * (app/.wlk-venv/Lib/site-packages/whisperlivekit/parse_args.py):
 *   --host default="localhost" (parse_args.py:10)
 *   --port type=int, default=8000 (parse_args.py:14)
 *
 * ## Port discrepancy resolved (the plan said 9090; the REAL default is 8000)
 * The plan's research digest said "default port 9090" and step 12's log notes
 * "research said 9090, README may say 8000". The INSTALLED whisperlivekit
 * 0.2.24 ships `--port` default 8000 (parse_args.py:14; config.py:28
 * `port: int = 8000`). We pass `--port 8000` explicitly -- the real shipped
 * default. 9090 was never a wlk default; using it would make the spawned
 * command diverge from what wlk actually binds, and the readiness probe would
 * poll a dead port forever.
 *
 * ## WS endpoint path -- confirmed
 * The plan says ws://127.0.0.1:9090/asr. The `/asr` path is real: the installed
 * package registers it at whisperlivekit/basic_server.py:88
 * (`@app.websocket("/asr")`), and the `--api-token` help text references
 * "WebSocket /asr". We probe ws://127.0.0.1:8000/asr (real port, real path).
 *
 * ## Local-by-default
 * `--host 127.0.0.1` is always passed so wlk binds loopback only (never
 * 0.0.0.0), keeping the plan's Done Criteria "only ws://127.0.0.1" rule.
 *
 * ## Spawn-site fixes applied in start() -- flagged by the step-14 probe
 * probe-wlk.mjs's header says "NOTE for step 21 (e2e harness): WlkServer
 * (step 13) spawns wlk WITHOUT this env and will hit the same cublas error;
 * the fix belongs at the spawn site." Two fixes therefore live in start(),
 * NOT in buildWlkCommand (whose exact argv is a tested step-13 contract):
 *  1. `--pcm-input` is appended to the spawned argv. The step-16 adapter
 *     streams RAW s16le PCM (probe framing); without --pcm-input wlk routes
 *     client bytes through ffmpeg (audio_processor.py:118-122) and raw PCM
 *     is mangled. The probe appended the same flag (parse_args.py:260-263).
 *  2. `CUDA_VISIBLE_DEVICES=-1` is set in the child env unless already set.
 *     On this machine faster-whisper's device='auto' picks CUDA (driver
 *     present) but the venv lacks cublas64_12.dll -> startup crash
 *     (verified 2026-08-20, probe header). -1 forces CPU, the plan's v1
 *     mode; an explicit env override is respected.
 */

import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import * as http from 'http'
import { dirname, join, resolve } from 'path'

/** Injectable spawn seam (audit step 13): structural twin of child_process.spawn. */
export type SpawnLike = typeof spawn

export type WlkModel = 'tiny' | 'base' | 'small'

const WLK_MODELS: readonly WlkModel[] = ['tiny', 'base', 'small']

export const WLK_DEFAULT_HOST = '127.0.0.1'
// Real shipped default of the installed whisperlivekit 0.2.24 (parse_args.py:14,
// config.py:28). See the header comment for why this is 8000, not 9090.
export const WLK_DEFAULT_PORT = 8000
export const WLK_WS_PATH = '/asr'
export const WLK_START_TIMEOUT_MS = 180_000

export interface WlkCommand {
  cmd: string
  args: string[]
}

/**
 * Absolute path of the venv wlk executable. Resolution order:
 * 1. WLK_BIN env override (machines where the venv lives elsewhere);
 * 2. `<app root>/.wlk-venv/Scripts/wlk.exe` on win32, `<app root>/.wlk-venv/bin/wlk`
 *    elsewhere, where the app root is the ancestor of this module that owns
 *    package.json (this walk works both from the electron-vite build in
 *    out/main and from vitest's in-place transpile).
 * Fails fast with a setup hint if the venv binary is missing.
 */
export function wlkBinPath(anchor: string = __dirname): string {
  // Audit step 12: the env override gets the SAME existence check as the
  // default resolution below -- an unchecked bogus WLK_BIN used to sail past
  // this function and fail later as an async spawn ENOENT with no user-visible
  // error (the app hung in `starting`). Fail fast here instead.
  const envBin = process.env['WLK_BIN']
  if (envBin) {
    const resolved = resolve(envBin)
    if (!existsSync(resolved)) {
      throw new Error(
        `wlk-server: WLK_BIN venv wlk missing at ${resolved} (fix WLK_BIN or run scripts/setup-wlk.mjs)`
      )
    }
    return resolved
  }
  let dir = anchor
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) break
    dir = dirname(dir)
  }
  if (!existsSync(join(dir, 'package.json'))) {
    throw new Error(`wlk-server: app root (package.json) not found above ${anchor}`)
  }
  const rel = process.platform === 'win32' ? '.wlk-venv/Scripts/wlk.exe' : '.wlk-venv/bin/wlk'
  const bin = join(dir, rel)
  if (!existsSync(bin)) {
    throw new Error(`wlk-server: venv wlk missing at ${bin} (run scripts/setup-wlk.mjs)`)
  }
  return bin
}

/**
 * Pure mapping from the settings model to the wlk argv. The args are the
 * confirmed flags --model <model> --host 127.0.0.1 --port 8000. Anything other
 * than tiny/base/small throws: the settings UI restricts to these three, and an
 * unknown value would silently fall through to wlk's own default instead of
 * failing loudly.
 *
 * `wlkBin` is a REQUIRED explicit argument (plan step 1: no default means no
 * hidden filesystem dependency in the unit suite -- a fresh clone without
 * .wlk-venv must run every test). The caller resolves it: WlkServer.start()
 * does the lazy wlkBinPath() resolution (with its existence check) at spawn
 * time, and scripts/probe-wlk.mjs passes its own WLK_BIN-or-resolved path.
 */
export function buildWlkCommand(model: WlkModel, wlkBin: string): WlkCommand {
  if (!WLK_MODELS.includes(model)) {
    throw new Error(
      `wlk-server: unsupported model "${String(model)}" (expected one of: tiny, base, small)`
    )
  }
  return {
    cmd: wlkBin,
    args: ['--model', model, '--host', WLK_DEFAULT_HOST, '--port', String(WLK_DEFAULT_PORT)]
  }
}

export interface WlkServerOptions {
  wlkBin?: string
  host?: string
  port?: number
  /** How long start() waits for the /asr WebSocket to accept a connection. */
  startTimeoutMs?: number
  /** Delay between connection attempts while polling. */
  pollIntervalMs?: number
  /**
   * Audit step 13: max automatic respawns after the child exits unexpectedly
   * WHILE SERVING (default 3). Exhausting the budget is terminal: onGaveUp()
   * listeners fire once with the reason; no further spawns happen until the
   * caller starts/shuts down deliberately. A failed INITIAL start() keeps the
   * step-12 contract -- it rejects, it never auto-restarts.
   */
  maxRestartAttempts?: number
  /**
   * Audit step 13: base delay of the exponential restart backoff -- the Nth
   * attempt waits baseDelay * 2^(N-1) ms (1s, 2s, 4s ... with the default).
   */
  restartBaseDelayMs?: number
  /**
   * Injectable spawn seam (unit tests only): defaults to child_process.spawn.
   * Fakes must emit 'exit' ASYNCHRONOUSLY (setImmediate) -- the handler reads
   * fields assigned right after spawn() returns.
   */
  spawnImpl?: SpawnLike
  /**
   * Injectable readiness probe (unit tests only): resolves when the server is
   * ready to accept ASR connections, rejects otherwise. Defaults to polling a
   * real WebSocket against this.wsUrl; it must mirror that poll's contract of
   * rejecting while this.child is absent (a dead child can never be ready).
   */
  probeImpl?: () => Promise<void>
  /**
   * Injectable HTTP health check (unit tests only): returns true when
   * GET http://host:port/health is 200. Defaults to a real Node http.get with
   * 2s timeout. Used as fallback when WS handshake fails due to proxy/Chromium
   * interception -- if health is 200 the server is considered ready.
   */
  healthCheckImpl?: () => Promise<boolean>
}

/**
 * Lifecycle owner of one wlk server process: start() spawns the venv wlk and
 * polls its /asr WebSocket until a probe connection is accepted (timeout
 * default 180s), shutdown() kills the child (the whole process tree on win32 --
 * wlk.exe spawns uvicorn as a child, and an orphaned uvicorn keeps the port
 * bound). Idempotent: shutdown() before start() or after an exit is a no-op.
 *
 * Plan step 1 (environment-independent unit suite): the constructor stores
 * opts.wlkBin WITHOUT resolving it (null when absent). Resolution -- and the
 * venv existence check -- happens lazily in start(), at spawn time, so
 * constructing a WlkServer never touches the filesystem and unit tests run on
 * any machine, .wlk-venv or not.
 *
 * Audit step 13 (crash recovery): a child that exits UNEXPECTEDLY while
 * serving is respawned with bounded exponential backoff (maxRestartAttempts x
 * restartBaseDelayMs*2^n). A successful readiness probe resets the attempt
 * budget. Exhausting the budget fires the onGaveUp() listeners once with a
 * terminal error -- CaptureSession routes that into fail(), which lands on the
 * step-12 path (state 'error' broadcast to both status chips). Deliberate
 * shutdown() never triggers a restart; a failed INITIAL start() keeps the
 * step-12 contract (rejects; no auto-restart).
 */
export class WlkServer {
  readonly model: WlkModel
  readonly host: string
  readonly port: number
  readonly wsUrl: string
  private readonly wlkBin: string | null
  private readonly startTimeoutMs: number
  private readonly pollIntervalMs: number
  private readonly maxRestartAttempts: number
  private readonly restartBaseDelayMs: number
  private readonly spawnImpl: SpawnLike
  private readonly probeOverride: (() => Promise<void>) | null
  private readonly healthCheckOverride: (() => Promise<boolean>) | null
  private child: ChildProcess | null = null
  private logTail: string[] = []
  // --- restart state (audit step 13) ---
  /** Deliberate stop requested: cancels pending restarts, blocks new ones. */
  private stopping = false
  /** True once ANY readiness probe has passed; restarts only apply after this. */
  private everReady = false
  /** Restart budget exhausted: terminal until the next start(). */
  private gaveUp = false
  /** Attempts used since the last stable (probe-passed) period. */
  private restartAttempts = 0
  /**
   * A recovery chain (pending backoff timer OR in-flight respawn attempt)
   * owns the next scheduling decision: exit events observed while this is
   * true are ignored, so exactly one chain exists per crash episode.
   */
  private recovering = false
  private restartTimer: NodeJS.Timeout | null = null
  private gaveUpCbs: Array<(err: Error) => void> = []

  constructor(model: WlkModel, opts: WlkServerOptions = {}) {
    this.model = model
    this.host = opts.host ?? WLK_DEFAULT_HOST
    this.port = opts.port ?? WLK_DEFAULT_PORT
    this.wsUrl = `ws://${this.host}:${this.port}${WLK_WS_PATH}`
    // Lazy: resolved (and existence-checked) in start(), never here (step 1).
    this.wlkBin = opts.wlkBin ?? null
    this.startTimeoutMs = opts.startTimeoutMs ?? WLK_START_TIMEOUT_MS
    this.pollIntervalMs = opts.pollIntervalMs ?? 500
    this.maxRestartAttempts = opts.maxRestartAttempts ?? 3
    this.restartBaseDelayMs = opts.restartBaseDelayMs ?? 1000
    this.spawnImpl = opts.spawnImpl ?? spawn
    this.probeOverride = opts.probeImpl ?? null
    this.healthCheckOverride = opts.healthCheckImpl ?? null
  }

  /**
   * Register the terminal handler for restart-budget exhaustion (audit step
   * 13). CaptureSession registers one and routes the error into fail(); the
   * listener list is snapshotted per emission so a listener that unsubscribes
   * mid-emission cannot see its own callback re-entered.
   */
  onGaveUp(cb: (err: Error) => void): void {
    this.gaveUpCbs.push(cb)
  }

  /**
   * Spawn wlk and wait until its /asr WebSocket accepts a probe connection.
   * Audit step 13: an unexpected exit of a READY server is recovered by
   * scheduleRestart(); a failed initial start keeps rejecting to the caller.
   */
  async start(): Promise<void> {
    if (this.child) throw new Error('wlk-server: already started')
    if (typeof WebSocket === 'undefined') {
      throw new Error('wlk-server: global WebSocket unavailable (needs Node >= 22)')
    }
    this.stopping = false
    this.everReady = false
    this.gaveUp = false
    this.recovering = false
    this.restartAttempts = 0
    await this.spawnOnce()
  }

  /** One spawn + readiness wait. Throws on failure; cleanup kills that child. */
  private async spawnOnce(): Promise<void> {
    // Lazy resolution at spawn time (plan step 1): the venv path is looked up
    // -- and existence-checked, wlkBinPath() throws with a setup hint when the
    // binary is missing -- only when the caller did not inject an explicit bin.
    const wlkBin = this.wlkBin ?? wlkBinPath()
    const { cmd, args } = buildWlkCommand(this.model, wlkBin)
    // Raw-PCM framing (see header: the step-16 adapter streams s16le PCM;
    // without --pcm-input wlk routes bytes through ffmpeg). buildWlkCommand's
    // tested contract is untouched -- this is a spawn-site fix, per the
    // step-14 probe note.
    args.push('--pcm-input')
    this.logTail = []
    // BUGFIX: log proxy env once at spawn (proxy/Chromium interception caused WS
    // handshake to fail while HTTP was up -- Uvicorn running but probe timed out).
    // Also set NO_PROXY for child so wlk bypasses any system proxy for loopback.
    {
      const proxyKeys = [
        'HTTP_PROXY',
        'http_proxy',
        'HTTPS_PROXY',
        'https_proxy',
        'NO_PROXY',
        'no_proxy'
      ]
      const proxySnapshot: Record<string, string> = {}
      for (const k of proxyKeys) if (process.env[k]) proxySnapshot[k] = process.env[k] as string
      console.log(
        `[wlk-server] spawning ${cmd} ${args.join(' ')} host=${this.host} port=${this.port} proxy=${JSON.stringify(proxySnapshot)}`
      )
    }
    // Audit step 12: a spawn that cannot even start (bad binary, ENOENT,
    // EACCES) emits 'error' asynchronously -- with no listener Node turns it
    // into an uncaught exception, and the readiness poll below would keep
    // polling until the full timeout because 'exit' never fires. Capture it
    // so waitForAsr() can reject promptly with the real reason.
    let spawnError: Error | null = null
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      CUDA_VISIBLE_DEVICES: process.env.CUDA_VISIBLE_DEVICES ?? '-1',
      // Bypass proxy for loopback: wlk binds 127.0.0.1 and probe uses same.
      NO_PROXY: process.env.NO_PROXY
        ? `${process.env.NO_PROXY},127.0.0.1,localhost`
        : '127.0.0.1,localhost',
      no_proxy: process.env.no_proxy
        ? `${process.env.no_proxy},127.0.0.1,localhost`
        : '127.0.0.1,localhost'
    }
    const child = this.spawnImpl(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // CPU-only (see header): faster-whisper device=auto picks CUDA on this
      // machine but the venv lacks cublas64_12.dll; -1 forces CPU. Respect an
      // explicit CUDA_VISIBLE_DEVICES override if the caller set one.
      env: childEnv
    })
    this.child = child
    child.stdout?.on('data', (d: Buffer) => this.rememberLog(d))
    child.stderr?.on('data', (d: Buffer) => this.rememberLog(d))
    child.on('error', (err) => {
      spawnError = err instanceof Error ? err : new Error(String(err))
    })
    child.on('exit', () => {
      // Stale-guard first: a late exit of a killed/replaced child must not
      // null the CURRENT child's reference (audit step 13).
      if (this.child === child) this.child = null
      if (this.stopping || this.gaveUp || this.recovering || !this.everReady) return
      this.scheduleRestart(
        new Error(`wlk process exited unexpectedly (code=${String(child.exitCode)})`)
      )
    })
    try {
      if (this.probeOverride) await this.probeOverride()
      else await this.waitForAsr(() => spawnError)
    } catch (err) {
      // Kill THIS attempt's child without touching restart policy flags: a
      // failed respawn attempt must stay inside the retry budget (only
      // deliberate shutdown() or a failed INITIAL start() set `stopping`).
      await this.killChild()
      throw err
    }
    this.everReady = true
  }

  /**
   * Schedule one bounded-backoff respawn attempt (audit step 13). The Nth
   * attempt waits restartBaseDelayMs * 2^(N-1); success resets the budget;
   * exhausting maxRestartAttempts fires onGaveUp listeners once. A pending
   * timer is cancelled by shutdown().
   */
  private scheduleRestart(reason: Error): void {
    if (this.stopping || this.gaveUp) return
    if (this.restartAttempts >= this.maxRestartAttempts) {
      this.gaveUp = true
      this.recovering = false
      const err = new Error(
        `wlk-server: crashed and gave up after ${this.maxRestartAttempts} restart attempt(s): ${reason.message}`
      )
      console.error('[wlk-server]', err.message)
      for (const cb of [...this.gaveUpCbs]) {
        try {
          cb(err)
        } catch {
          // listener errors must not break recovery bookkeeping
        }
      }
      return
    }
    const delay = this.restartBaseDelayMs * Math.pow(2, this.restartAttempts)
    this.restartAttempts += 1
    // The chain now owns scheduling: exit events during the backoff wait or
    // the respawn attempt are ignored; the rejection handler below continues.
    this.recovering = true
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (this.stopping || this.gaveUp) return
      void this.spawnOnce().then(
        () => {
          this.recovering = false
          this.restartAttempts = 0 // stable again: full budget for next crash
        },
        (err: unknown) => {
          this.scheduleRestart(err instanceof Error ? err : new Error(String(err)))
        }
      )
    }, delay)
  }

  /**
   * Kill the wlk child (whole tree on win32), cancelling any pending restart.
   * Idempotent; safe before start(). Deliberate stop: never auto-restarts.
   */
  async shutdown(): Promise<void> {
    this.stopping = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    await this.killChild()
  }

  /** Kill the current child only; leaves restart-policy flags untouched. */
  private async killChild(): Promise<void> {
    const child = this.child
    this.child = null
    if (!child || child.pid === undefined) return
    if (process.platform === 'win32') {
      await new Promise<void>((resolveKill) => {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore'
        })
        killer.on('exit', () => resolveKill())
        killer.on('error', () => {
          child.kill()
          resolveKill()
        })
      })
    } else {
      child.kill('SIGTERM')
      await new Promise<void>((resolveKill) => {
        const hard = setTimeout(() => {
          child.kill('SIGKILL')
          resolveKill()
        }, 2000)
        child.once('exit', () => {
          clearTimeout(hard)
          resolveKill()
        })
      })
    }
  }

  private rememberLog(chunk: Buffer): void {
    this.logTail.push(chunk.toString())
    if (this.logTail.length > 50) this.logTail.shift()
  }

  private lastLogs(): string {
    return this.logTail.join('')
  }

  /**
   * Poll the /asr WebSocket until a connection is accepted or the deadline
   * passes. Uses the runtime's global WebSocket (Node >= 22 / Electron main);
   * no extra dependency (minimization ladder rung 4).
   *
   * BUGFIX: capture socket.onerror message into lastProbeError, include last N
   * failures + lastLogs in timeout error, and add HTTP health fallback
   * (GET http://host:port/health with 2s timeout every iteration -- if health
   * returns 200 consider server ready even if WS handshake fails due to
   * proxy/Chromium interception).
   *
   * `getSpawnError` surfaces an asynchronous spawn failure (audit step 12):
   * when the child could not be spawned at all, reject immediately with that
   * error instead of polling a process that will never listen.
   */
  private waitForAsr(getSpawnError: () => Error | null = () => null): Promise<void> {
    const deadline = Date.now() + this.startTimeoutMs
    return new Promise((resolveReady, rejectReady) => {
      let settled = false
      let socket: WebSocket | null = null
      let deadlineTimer: NodeJS.Timeout | null = null
      let retryTimer: NodeJS.Timeout | null = null
      const lastProbeErrors: string[] = []
      const MAX_PROBE_ERRORS = 5
      const pushProbeError = (msg: string): void => {
        const line = msg.slice(0, 600)
        lastProbeErrors.push(line)
        if (lastProbeErrors.length > MAX_PROBE_ERRORS) lastProbeErrors.shift()
      }
      const formatTimeoutError = (): string => {
        const probePart =
          lastProbeErrors.length > 0
            ? `last probe errors (${lastProbeErrors.length}):\n${lastProbeErrors.join('\n')}`
            : 'last probe errors: (none captured -- onerror never fired; proxy/Chromium interception suspected)'
        return `wlk-server: timed out after ${this.startTimeoutMs}ms waiting for ${this.wsUrl}\n${probePart}\nlast logs:\n${this.lastLogs()}`
      }
      // LOG-BASED readiness (primary): WlkServer captures logs via rememberLog into
      // logTail; Uvicorn emits "Uvicorn running" and "Application startup complete"
      // when the server is ready. Electron main WebSocket via Chromium is unreliable
      // behind proxy -- use the log signal as ready without network.
      const isLogReady = (): boolean => {
        const logs = this.lastLogs()
        return logs.includes('Uvicorn running') || logs.includes('Application startup complete')
      }
      const checkHealth = (): Promise<boolean> => {
        if (this.healthCheckOverride) {
          // Still log health override result for diagnostics (spec: health check logs result)
          return this.healthCheckOverride().then((ok) => {
            console.log(`[wlk-server] health check ${ok ? '200 OK' : 'not ready'} for http://${this.host}:${this.port}/health`)
            return ok
          }).catch(() => {
            console.log(`[wlk-server] health check not ready for http://${this.host}:${this.port}/health`)
            return false
          })
        }
        return new Promise((resolve) => {
          const url = `http://${this.host}:${this.port}/health`
          let settledHealth = false
          const done = (ok: boolean): void => {
            if (settledHealth) return
            settledHealth = true
            console.log(`[wlk-server] health check ${ok ? '200 OK' : 'not ready'} for ${url} (status=${ok ? 200 : 'fail'})`)
            resolve(ok)
          }
          try {
            const req = http.get(url, (res) => {
              const ok = res.statusCode === 200
              res.resume()
              // drain then resolve
              res.on('end', () => done(ok))
              // In case no body, end may never fire quickly -- also resolve on response
              if (res.statusCode === 200) {
                // give a tick for end, but also resolve immediately if body empty
                setTimeout(() => done(ok), 50)
              } else {
                done(ok)
              }
            })
            req.on('error', () => done(false))
            req.setTimeout(2000, () => {
              try {
                req.destroy()
              } catch {
                // ignore
              }
              done(false)
            })
          } catch {
            done(false)
          }
        })
      }

      const cleanup = (): void => {
        if (deadlineTimer) {
          clearTimeout(deadlineTimer)
          deadlineTimer = null
        }
        if (retryTimer) {
          clearTimeout(retryTimer)
          retryTimer = null
        }
        if (!socket) return
        socket.onopen = null
        socket.onerror = null
        socket.onclose = null
        try {
          socket.close()
        } catch {
          // already closed -- the probe socket is best-effort
        }
        socket = null
      }

      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        rejectReady(err)
      }

      // Hard deadline: ensure the promise NEVER hangs past startTimeoutMs
      // even if the WebSocket stays in CONNECTING forever without firing
      // onclose/onerror (the original hang that produced "reply was never sent").
      deadlineTimer = setTimeout(() => {
        fail(new Error(formatTimeoutError()))
      }, this.startTimeoutMs)

      const attempt = async (): Promise<void> => {
        if (settled) return
        const spawnError = getSpawnError()
        if (spawnError) {
          // Node's spawn errors carry the path ("spawn <path> ENOENT"), so
          // the user sees WHICH binary could not start.
          fail(new Error(`wlk-server: failed to spawn -- ${spawnError.message}`))
          return
        }
        if (!this.child) {
          fail(
            new Error(
              `wlk-server: process exited before ${this.wsUrl} accepted a connection\n${this.lastLogs()}`
            )
          )
          return
        }
        if (Date.now() >= deadline) {
          fail(new Error(formatTimeoutError()))
          return
        }
        // LOG-BASED readiness (primary): bypass network -- if logTail already
        // contains the Uvicorn startup line, resolve immediately without
        // HTTP/WS. Checked every poll before any network.
        if (isLogReady() && !settled) {
          console.log('[wlk-server] ready via logTail (Uvicorn running / Application startup complete) -> resolve')
          settled = true
          cleanup()
          resolveReady()
          return
        }
        // HTTP health fallback: every iteration try GET /health with 2s timeout.
        // If it returns 200, the HTTP server is up (Uvicorn running) even if
        // the WS handshake is blocked by proxy/Chromium interception.
        try {
          const healthy = await checkHealth()
          if (healthy && !settled) {
            console.log('[wlk-server] health 200 OK -> ready (fallback)')
            settled = true
            cleanup()
            resolveReady()
            return
          }
        } catch {
          // health check is best-effort fallback; WS remains primary
        }
        if (settled) return
        if (!this.child) {
          fail(
            new Error(
              `wlk-server: process exited before ${this.wsUrl} accepted a connection\n${this.lastLogs()}`
            )
          )
          return
        }
        if (Date.now() >= deadline) {
          fail(new Error(formatTimeoutError()))
          return
        }
        try {
          socket = new WebSocket(this.wsUrl)
        } catch (err) {
          fail(err instanceof Error ? err : new Error(String(err)))
          return
        }
        socket.onopen = (): void => {
          if (settled) return
          console.log('[wlk-server] WS /asr accepted/open -> ready')
          settled = true
          cleanup()
          resolveReady()
        }
        socket.onerror = ((ev: unknown): void => {
          // Capture the real error message for timeout diagnostics.
          let msg = 'WS error'
          try {
            if (ev && typeof ev === 'object') {
              const o = ev as Record<string, unknown>
              if (typeof o['message'] === 'string' && (o['message'] as string).length > 0)
                msg = o['message'] as string
              else if (o['error'] && typeof o['error'] === 'object') {
                const inner = o['error'] as Record<string, unknown>
                if (typeof inner['message'] === 'string') msg = inner['message'] as string
                else msg = String(o['error'])
              } else if (typeof o['type'] === 'string') msg = `WS ${o['type']} event`
              else msg = JSON.stringify(o).slice(0, 400)
            } else if (typeof ev === 'string' && ev.length > 0) msg = ev
            else if (ev) msg = String(ev)
          } catch {
            msg = String(ev)
          }
          pushProbeError(msg)
        }) as unknown as (ev: Event) => void
        socket.onclose = (): void => {
          if (settled) return
          // Capture close as a probe error too when onerror never fired
          // (some WS impls fire only onclose with code/reason).
          if (lastProbeErrors.length === 0) {
            try {
              const c = socket as unknown as { code?: number; reason?: string }
              if (c && typeof c.code === 'number')
                pushProbeError(
                  `WS close code=${c.code} reason=${String(c.reason ?? '')}`.slice(0, 400)
                )
            } catch {
              // ignore
            }
          }
          // Cleanup this socket before scheduling the next attempt so a
          // hanging socket does not leak.
          if (socket) {
            socket.onopen = null
            socket.onerror = null
            socket.onclose = null
            try {
              socket.close()
            } catch {
              // ignore
            }
            socket = null
          }
          retryTimer = setTimeout(() => void attempt(), this.pollIntervalMs)
        }
      }

      void attempt()
    })
  }
}
