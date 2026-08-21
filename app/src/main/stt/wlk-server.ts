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
import { dirname, join, resolve } from 'path'

export type WlkModel = 'tiny' | 'base' | 'small'

const WLK_MODELS: readonly WlkModel[] = ['tiny', 'base', 'small']

export const WLK_DEFAULT_HOST = '127.0.0.1'
// Real shipped default of the installed whisperlivekit 0.2.24 (parse_args.py:14,
// config.py:28). See the header comment for why this is 8000, not 9090.
export const WLK_DEFAULT_PORT = 8000
export const WLK_WS_PATH = '/asr'
export const WLK_START_TIMEOUT_MS = 60_000

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
}

/**
 * Lifecycle owner of one wlk server process: start() spawns the venv wlk and
 * polls its /asr WebSocket until a probe connection is accepted (timeout
 * default 60s), shutdown() kills the child (the whole process tree on win32 --
 * wlk.exe spawns uvicorn as a child, and an orphaned uvicorn keeps the port
 * bound). Idempotent: shutdown() before start() or after an exit is a no-op.
 *
 * Plan step 1 (environment-independent unit suite): the constructor stores
 * opts.wlkBin WITHOUT resolving it (null when absent). Resolution -- and the
 * venv existence check -- happens lazily in start(), at spawn time, so
 * constructing a WlkServer never touches the filesystem and unit tests run on
 * any machine, .wlk-venv or not.
 */
export class WlkServer {
  readonly model: WlkModel
  readonly host: string
  readonly port: number
  readonly wsUrl: string
  private readonly wlkBin: string | null
  private readonly startTimeoutMs: number
  private readonly pollIntervalMs: number
  private child: ChildProcess | null = null
  private logTail: string[] = []

  constructor(model: WlkModel, opts: WlkServerOptions = {}) {
    this.model = model
    this.host = opts.host ?? WLK_DEFAULT_HOST
    this.port = opts.port ?? WLK_DEFAULT_PORT
    this.wsUrl = `ws://${this.host}:${this.port}${WLK_WS_PATH}`
    // Lazy: resolved (and existence-checked) in start(), never here (step 1).
    this.wlkBin = opts.wlkBin ?? null
    this.startTimeoutMs = opts.startTimeoutMs ?? WLK_START_TIMEOUT_MS
    this.pollIntervalMs = opts.pollIntervalMs ?? 500
  }

  /** Spawn wlk and wait until its /asr WebSocket accepts a probe connection. */
  async start(): Promise<void> {
    if (this.child) throw new Error('wlk-server: already started')
    if (typeof WebSocket === 'undefined') {
      throw new Error('wlk-server: global WebSocket unavailable (needs Node >= 22)')
    }
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
    // Audit step 12: a spawn that cannot even start (bad binary, ENOENT,
    // EACCES) emits 'error' asynchronously -- with no listener Node turns it
    // into an uncaught exception, and the readiness poll below would keep
    // polling until the full timeout because 'exit' never fires. Capture it
    // so waitForAsr() can reject promptly with the real reason.
    let spawnError: Error | null = null
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // CPU-only (see header): faster-whisper device=auto picks CUDA on this
      // machine but the venv lacks cublas64_12.dll; -1 forces CPU. Respect an
      // explicit CUDA_VISIBLE_DEVICES override if the caller set one.
      env: { ...process.env, CUDA_VISIBLE_DEVICES: process.env.CUDA_VISIBLE_DEVICES ?? '-1' }
    })
    this.child = child
    child.stdout?.on('data', (d: Buffer) => this.rememberLog(d))
    child.stderr?.on('data', (d: Buffer) => this.rememberLog(d))
    child.on('error', (err) => {
      spawnError = err instanceof Error ? err : new Error(String(err))
    })
    child.on('exit', () => {
      // The process died on its own; the in-flight poll sees child === null and
      // rejects with the captured log tail. A later shutdown() is a no-op.
      this.child = null
    })
    try {
      await this.waitForAsr(() => spawnError)
    } catch (err) {
      await this.shutdown()
      throw err
    }
  }

  /** Kill the wlk child (whole tree on win32). Idempotent. */
  async shutdown(): Promise<void> {
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
   * `getSpawnError` surfaces an asynchronous spawn failure (audit step 12):
   * when the child could not be spawned at all, reject immediately with that
   * error instead of polling a process that will never listen.
   */
  private waitForAsr(getSpawnError: () => Error | null = () => null): Promise<void> {
    const deadline = Date.now() + this.startTimeoutMs
    return new Promise((resolveReady, rejectReady) => {
      let settled = false
      let socket: WebSocket | null = null

      const cleanup = (): void => {
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

      const attempt = (): void => {
        if (settled) return
        const spawnError = getSpawnError()
        if (spawnError) {
          settled = true
          // Node's spawn errors carry the path ("spawn <path> ENOENT"), so
          // the user sees WHICH binary could not start.
          rejectReady(new Error(`wlk-server: failed to spawn -- ${spawnError.message}`))
          return
        }
        if (!this.child) {
          settled = true
          rejectReady(
            new Error(
              `wlk-server: process exited before ${this.wsUrl} accepted a connection\n${this.lastLogs()}`
            )
          )
          return
        }
        if (Date.now() >= deadline) {
          settled = true
          rejectReady(
            new Error(
              `wlk-server: timed out after ${this.startTimeoutMs}ms waiting for ${this.wsUrl}\n${this.lastLogs()}`
            )
          )
          return
        }
        socket = new WebSocket(this.wsUrl)
        socket.onopen = (): void => {
          settled = true
          cleanup()
          resolveReady()
        }
        socket.onerror = (): void => {
          // A failed connect is followed by onclose, where the retry happens.
        }
        socket.onclose = (): void => {
          if (settled) return
          setTimeout(attempt, this.pollIntervalMs)
        }
      }

      attempt()
    })
  }
}
