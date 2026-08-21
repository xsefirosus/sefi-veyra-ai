import { describe, expect, it } from 'vitest'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import {
  buildWlkCommand,
  wlkBinPath,
  WLK_DEFAULT_HOST,
  WLK_DEFAULT_PORT,
  WLK_WS_PATH,
  WlkServer,
  type WlkModel
} from '../src/main/stt/wlk-server'

/**
 * Step 13 seams under test (updated by step 1 of the audit-01 plan):
 * - buildWlkCommand: the pure model -> argv mapping. Flag names and the real
 *   default port were confirmed on 2026-08-20 from `wlk serve --help` and the
 *   installed whisperlivekit 0.2.24 source (parse_args.py:8-14: --model,
 *   --host, --port; port default 8000; /asr from basic_server.py:88). The plan
 *   text said 9090; the installed server's real default is 8000, which is what
 *   the builder must emit.
 * - Step 1 (audit-01): the binary argument is REQUIRED and the suite injects a
 *   fake path, so no test touches the filesystem -- a fresh clone without
 *   app/.wlk-venv runs the whole suite green.
 * - WlkServer lifecycle WITHOUT spawning: the constructor must NOT resolve the
 *   venv path (that happens lazily in start()); constructor wiring plus
 *   shutdown() before start() being a safe no-op. The live spawn/poll seam is
 *   exercised by step 14 (probe-wlk.mjs) and step 21 (e2e), which need the
 *   real wlk server and a model download -- it is not spun up in the unit
 *   suite.
 */

/** Fake binary path -- buildWlkCommand never touches the filesystem, so any
 *  string shaped like a wlk binary satisfies the contract. */
const FAKE_WLK_BIN = '/fake/venv/bin/wlk'

describe('buildWlkCommand', () => {
  it('maps tiny, base and small to the venv wlk with the confirmed flags', () => {
    for (const model of ['tiny', 'base', 'small'] as const) {
      const { cmd, args } = buildWlkCommand(model, FAKE_WLK_BIN)
      expect(cmd).toBe(FAKE_WLK_BIN)
      // Exact argv: the flags were confirmed from `wlk serve --help` /
      // parse_args.py, and the port is the installed server's real default
      // (8000), not the plan's unverified research figure (9090).
      expect(args).toEqual([
        '--model',
        model,
        '--host',
        WLK_DEFAULT_HOST,
        '--port',
        String(WLK_DEFAULT_PORT)
      ])
    }
    expect(WLK_DEFAULT_HOST).toBe('127.0.0.1')
    expect(WLK_DEFAULT_PORT).toBe(8000)
    expect(WLK_WS_PATH).toBe('/asr')
  })

  it('rejects any model other than tiny/base/small', () => {
    const badModels: WlkModel[] = ['medium', 'large-v3', 'tiny.en', 'garbage'] as WlkModel[]
    for (const bad of badModels) {
      expect(() => buildWlkCommand(bad, FAKE_WLK_BIN)).toThrow(/unsupported model/)
    }
  })

  it('rejects an empty model value', () => {
    expect(() => buildWlkCommand('' as WlkModel, FAKE_WLK_BIN)).toThrow(/unsupported model/)
  })
})

describe('WlkServer lifecycle (no spawn)', () => {
  it('wires constructor defaults and exposes the probe URL', () => {
    const server = new WlkServer('tiny')
    expect(server.host).toBe('127.0.0.1')
    expect(server.port).toBe(8000)
    expect(server.wsUrl).toBe('ws://127.0.0.1:8000/asr')
  })

  it('constructs without resolving the venv binary (lazy, step 1)', () => {
    // Must not throw on a machine with no app/.wlk-venv: resolution is
    // deferred to start().
    expect(() => new WlkServer('tiny')).not.toThrow()
    expect(() => new WlkServer('tiny', { wlkBin: FAKE_WLK_BIN })).not.toThrow()
  })

  it('shutdown() before start() is a safe no-op', async () => {
    const server = new WlkServer('tiny')
    await expect(server.shutdown()).resolves.toBeUndefined()
  })

  it('start() twice without a shutdown rejects', async () => {
    // Cannot spawn a real wlk in the unit suite (model download), so simulate
    // the already-started guard by seeding the private child reference.
    const server = new WlkServer('tiny')
    ;(server as unknown as { child: unknown }).child = {} as never
    await expect(server.start()).rejects.toThrow(/already started/)
  })
})

describe('WlkServer spawn-failure surfacing (audit plan step 12)', () => {
  /**
   * Seams under test:
   * - WLK_BIN env override gets the same existence check as the default venv
   *   resolution, so a bogus path fails FAST at start() with the path in the
   *   message -- before any spawn attempt.
   * - start() rejects promptly instead of hanging in the readiness poll: the
   *   session must land in `error` (surfaced on the status chip), never sit
   *   in `starting` for the full 60 s timeout.
   *
   * This IS the plan's spawn-failure simulation: a real WlkServer resolving a
   * nonexistent WLK_BIN exercises the same code path as pressing Start in the
   * app (CaptureSession.start -> WlkServer.start -> wlkBinPath).
   */
  it('start() rejects fast with the missing path when WLK_BIN points nowhere', async () => {
    const prev = process.env['WLK_BIN']
    process.env['WLK_BIN'] = resolve(join(tmpdir(), 'veyra-no-such-wlk-dir', 'wlk'))
    try {
      const server = new WlkServer('tiny')
      const t0 = Date.now()
      await expect(server.start()).rejects.toThrow(/WLK_BIN[\s\S]*missing/)
      // "Not hung in starting": the rejection must be near-instant. A failure
      // that only surfaces via the 60 s readiness timeout would exceed this.
      expect(Date.now() - t0).toBeLessThan(5000)
    } finally {
      if (prev === undefined) delete process.env['WLK_BIN']
      else process.env['WLK_BIN'] = prev
    }
  })

  it('wlkBinPath() itself throws with the path for a missing WLK_BIN override', () => {
    const prev = process.env['WLK_BIN']
    process.env['WLK_BIN'] = resolve(join(tmpdir(), 'veyra-no-such-wlk-dir', 'wlk'))
    try {
      expect(() => wlkBinPath(resolve(tmpdir()))).toThrow(/WLK_BIN/)
    } finally {
      if (prev === undefined) delete process.env['WLK_BIN']
      else process.env['WLK_BIN'] = prev
    }
  })
})

describe('wlkBinPath platform branch (audit plan step 14)', () => {
  /**
   * Seams under test (step 14):
   * - wlkBinPath()'s per-platform venv layout: win32 ->
   *   `.wlk-venv/Scripts/wlk.exe`, posix -> `.wlk-venv/bin/wlk`. The posix
   *   branch is what scripts/setup-wlk.mjs builds on macOS/Linux, so the two
   *   must agree on the exact relative path.
   * - The setup hint on a missing binary points at the PORTABLE installer
   *   (scripts/setup-wlk.mjs) -- the old text named only setup-wlk.ps1, which
   *   does not run on macOS/Linux.
   *
   * Verified here: the path SELECTION and existence check against temp trees
   * shaped like both layouts. A real posix venv install (macOS/Linux) is
   * PENDING -- this machine is win32; per the anti-hallucination registry,
   * do not claim macOS works until it runs there.
   */

  /** Spoof process.platform for the duration of fn() (restored after). */
  function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
    const prev = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
    try {
      return fn()
    } finally {
      if (prev && 'value' in prev) {
        Object.defineProperty(process, 'platform', { value: prev.value, configurable: true })
      }
    }
  }

  /** Temp app root with package.json + ONE venv layout (the given platform's). */
  function makeFakeAppRoot(platform: NodeJS.Platform): string {
    const root = mkdtempSync(join(tmpdir(), 'veyra-wlkbin-'))
    const bin =
      platform === 'win32'
        ? join(root, '.wlk-venv', 'Scripts', 'wlk.exe')
        : join(root, '.wlk-venv', 'bin', 'wlk')
    mkdirSync(dirname(bin), { recursive: true })
    writeFileSync(bin, '')
    writeFileSync(join(root, 'package.json'), '{}')
    return root
  }

  it.each(['linux', 'darwin'] as const)(
    'resolves .wlk-venv/bin/wlk on %s (posix branch)',
    (platform) => {
      const root = makeFakeAppRoot(platform)
      try {
        expect(withPlatform(platform, () => wlkBinPath(root))).toBe(
          join(root, '.wlk-venv', 'bin', 'wlk')
        )
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  )

  it('resolves .wlk-venv/Scripts/wlk.exe on win32', () => {
    const root = makeFakeAppRoot('win32')
    try {
      expect(withPlatform('win32', () => wlkBinPath(root))).toBe(
        join(root, '.wlk-venv', 'Scripts', 'wlk.exe')
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('on posix, a missing bin/wlk throws with the portable-setup hint and no win32 fallback', () => {
    // Only the WIN32 layout exists in this tree: the posix branch must NOT
    // fall back to it -- it fails fast pointing at the portable installer.
    const root = makeFakeAppRoot('win32')
    try {
      expect(() =>
        withPlatform('linux', () => wlkBinPath(root))
      ).toThrow(/setup-wlk\.mjs[\s\S]*missing|missing[\s\S]*setup-wlk\.mjs/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
