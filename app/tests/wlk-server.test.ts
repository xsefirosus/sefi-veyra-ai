import { describe, expect, it } from 'vitest'
import {
  buildWlkCommand,
  WLK_DEFAULT_HOST,
  WLK_DEFAULT_PORT,
  WLK_WS_PATH,
  WlkServer,
  type WlkModel
} from '../src/main/stt/wlk-server'

/**
 * Step 13 seams under test:
 * - buildWlkCommand: the pure model -> argv mapping. Flag names and the real
 *   default port were confirmed on 2026-08-20 from `wlk serve --help` and the
 *   installed whisperlivekit 0.2.24 source (parse_args.py:8-14: --model,
 *   --host, --port; port default 8000; /asr from basic_server.py:88). The plan
 *   text said 9090; the installed server's real default is 8000, which is what
 *   the builder must emit.
 * - WlkServer lifecycle WITHOUT spawning: constructor wiring plus shutdown()
 *   before start() being a safe no-op. The live spawn/poll seam is exercised
 *   by step 14 (probe-wlk.mjs) and step 21 (e2e), which need the real wlk
 *   server and a model download -- it is not spun up in the unit suite.
 */

describe('buildWlkCommand', () => {
  it('maps tiny, base and small to the venv wlk with the confirmed flags', () => {
    for (const model of ['tiny', 'base', 'small'] as const) {
      const { cmd, args } = buildWlkCommand(model)
      expect(cmd).toMatch(/wlk(\.exe)?$/)
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
      expect(() => buildWlkCommand(bad)).toThrow(/unsupported model/)
    }
  })

  it('rejects an empty model value', () => {
    expect(() => buildWlkCommand('' as WlkModel)).toThrow(/unsupported model/)
  })
})

describe('WlkServer lifecycle (no spawn)', () => {
  it('wires constructor defaults and exposes the probe URL', () => {
    const server = new WlkServer('tiny')
    expect(server.host).toBe('127.0.0.1')
    expect(server.port).toBe(8000)
    expect(server.wsUrl).toBe('ws://127.0.0.1:8000/asr')
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