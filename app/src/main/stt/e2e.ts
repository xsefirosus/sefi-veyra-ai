/**
 * e2e.ts -- plan step 21: latency + e2e harness (REAL wlk, REAL audio).
 *
 * ## What this is
 * The Phase-2 end-to-end check that does NOT need the GUI. When run with
 * env VEYRA_E2E=1 (and VEYRA_TEST_AUDIO naming the step-14 WAV, default
 * app/assets/test-speech.wav), it:
 *   1. starts wlk (tiny) via step 13's WlkServer -- the REAL spawn-site fix
 *      is in wlk-server.ts (--pcm-input + CUDA_VISIBLE_DEVICES=-1, per the
 *      step-14 probe note);
 *   2. connects step 16's WhisperLiveKitSttAdapter with source 'mic';
 *   3. feeds the WAV through step 17's feedWavToAdapter -- the SAME
 *      adapter.send(int16) path the renderer mic uses;
 *   4. collects partial/final events; on the first partial records
 *      firstPartialMs = (ts of first partial event) - (ts of first PCM send);
 *   5. sends the end-of-stream empty frame, then KEEPS the socket open until
 *      the final flush settles (finals are emitted only after EOS -- the
 *      step-14 probe waited for ready_to_stop before closing; the adapter's
 *      close() sends EOS and closes immediately, which would drop the flush);
 *   6. merges state/loopback-check.json (step 19) -> loopbackEnergyCaptured;
 *   7. writes state/phase2-demo.json {partials, finals, labelsSeen,
 *      firstPartialMs, loopbackEnergyCaptured} and state/latency-p2.json
 *      {firstPartialMs, model:'tiny', criterion:'sub-2s spoken-to-partial',
 *      pass: firstPartialMs < 2000}, then shuts wlk down and quits.
 *
 * NEVER fakes a number: if firstPartialMs >= 2000 (or no partial arrived at
 * all -> null) the real value is written with pass: false.
 *
 * ## How it is run (plain Node, no Electron GUI)
 *   app: npm i -D tsx          (dev-only runner: Node's own type stripping
 *                               cannot resolve the app's extensionless
 *                               relative imports -- verified 2026-08-20)
 *   root: $env:VEYRA_E2E="1"
 *         & "app/node_modules/.bin/tsx.cmd" "app/src/main/stt/e2e.ts"
 * The harness uses only Node-runnable modules (child_process, fs, the global
 * WebSocket) -- wlk-server.ts, whisper-livekit.ts and audio-input.ts have no
 * electron imports -- so no GUI is launched.
 *
 * ## Exit code
 * 0 when both JSON files were written AND partials > 0 (plan step-21 assert);
 * 1 otherwise (with the real numbers logged -- never a fabricated pass).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { WlkServer } from './wlk-server'
import { WhisperLiveKitSttAdapter } from './whisper-livekit'
import { feedWavToAdapter } from '../capture/audio-input'
import { labelForSource } from '../../shared/stt/speaker-label'

/** How long to wait after EOS for the final flush to settle (no new events). */
const SETTLE_MS = 2500
/** Hard cap for the whole post-EOS flush wait (probe used 30s post-stream). */
const FLUSH_DEADLINE_MS = 30_000
/** Latency criterion: sub-2s spoken-to-partial (plan step 21). */
const CRITERION_MS = 2000

/**
 * Repo root = the ancestor of this module whose parent contains the `state/`
 * directory the plan's artifacts live in. Resolves state/ and the default
 * WAV path against the repo root, not process.cwd(), so the harness behaves
 * identically from any working directory.
 */
function repoRoot(): string {
  let dir = dirname(__filename)
  while (!existsSync(join(dir, 'state'))) {
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error('e2e: repo root (state/) not found above ' + __filename)
    }
    dir = parent
  }
  return dir
}

export interface E2eResult {
  partials: number
  finals: number
  labelsSeen: string[]
  firstPartialMs: number | null
  loopbackEnergyCaptured: boolean | null
  demoPath: string
  latencyPath: string
}

/**
 * Run the e2e once and write both state artifacts. Exported so step 22 (final
 * verification) can re-run it; the VEYRA_E2E=1 guard below auto-runs it when
 * invoked as a script. Throws on hard failures (wlk never ready, WAV missing,
 * loopback-check.json missing) -- the caller decides what that means.
 */
export async function runE2e(): Promise<E2eResult> {
  const root = repoRoot()
  const wavPath = resolve(
    process.env['VEYRA_TEST_AUDIO'] ?? join(root, 'app', 'assets', 'test-speech.wav')
  )
  if (!existsSync(wavPath)) {
    throw new Error(`e2e: WAV missing at ${wavPath} (run scripts/synth-speech.ps1)`)
  }

  // Step 19 merge source -- read, never invent. The file exists when step 19
  // passed; a missing file is a hard failure, not a faked false.
  const loopbackPath = join(root, 'state', 'loopback-check.json')
  let loopbackEnergyCaptured: boolean | null = null
  if (existsSync(loopbackPath)) {
    const parsed: unknown = JSON.parse(readFileSync(loopbackPath, 'utf8'))
    if (typeof parsed === 'object' && parsed !== null) {
      loopbackEnergyCaptured = (parsed as { energyCaptured?: unknown }).energyCaptured === true
    }
  } else {
    throw new Error(`e2e: ${loopbackPath} missing (run step 19 first)`)
  }

  const server = new WlkServer('tiny')
  const adapter = new WhisperLiveKitSttAdapter({ source: 'mic' })

  let partials = 0
  let finals = 0
  const labels = new Set<string>()
  let tFirstSend: number | null = null
  let firstPartialMs: number | null = null
  let lastEventAt = 0

  try {
    await server.start()
    adapter.onPartial(() => {
      partials += 1
      lastEventAt = Date.now()
      labels.add(labelForSource('mic'))
      if (firstPartialMs === null && tFirstSend !== null) {
        // plan: t of first partial event - t of first PCM send
        firstPartialMs = lastEventAt - tFirstSend
      }
    })
    adapter.onFinal(() => {
      finals += 1
      lastEventAt = Date.now()
      labels.add(labelForSource('mic'))
    })
    adapter.onError((err) => {
      console.error('[e2e] adapter error:', err.message)
    })
    await adapter.connect()

    tFirstSend = Date.now()
    const { samples, chunks } = await feedWavToAdapter(wavPath, adapter)
    console.log(`[e2e] fed ${samples} samples in ${chunks} chunks (first send t=${tFirstSend})`)

    // EOS: an empty Int16Array frames as the empty binary frame (step-14
    // audio_processor.py:878-890 stop sequence) WITHOUT closing the socket.
    adapter.send(new Int16Array(0))

    // Wait for the final flush to settle (finals are emitted after EOS; the
    // step-14 probe waited for ready_to_stop before closing for this reason).
    const flushDeadline = Date.now() + FLUSH_DEADLINE_MS
    while (Date.now() < flushDeadline) {
      if (lastEventAt > 0 && Date.now() - lastEventAt > SETTLE_MS) break
      await new Promise((r) => setTimeout(r, 200))
    }
    await adapter.close()
  } finally {
    await server.shutdown()
  }

  const labelsSeen = Array.from(labels)
  const demo = {
    partials,
    finals,
    labelsSeen,
    firstPartialMs,
    loopbackEnergyCaptured
  }
  const latency = {
    firstPartialMs,
    model: 'tiny',
    criterion: 'sub-2s spoken-to-partial',
    pass: firstPartialMs !== null && firstPartialMs < CRITERION_MS
  }

  const demoPath = join(root, 'state', 'phase2-demo.json')
  const latencyPath = join(root, 'state', 'latency-p2.json')
  mkdirSync(dirname(demoPath), { recursive: true })
  writeFileSync(demoPath, JSON.stringify(demo, null, 2) + '\n')
  writeFileSync(latencyPath, JSON.stringify(latency, null, 2) + '\n')
  console.log(`[e2e] wrote ${demoPath}`)
  console.log(`[e2e] wrote ${latencyPath}`)
  return { ...demo, demoPath, latencyPath }
}

// Script mode: run exactly once when VEYRA_E2E=1 (step-21 invocation). The
// assert is partials > 0 (plan step 21) -- a red result exits 1 with the REAL
// numbers logged, never a faked pass.
if (process.env['VEYRA_E2E'] === '1') {
  runE2e()
    .then((r) => {
      console.log(
        `[e2e] RESULT partials=${r.partials} finals=${r.finals} labelsSeen=${JSON.stringify(r.labelsSeen)} ` +
          `firstPartialMs=${r.firstPartialMs} loopbackEnergyCaptured=${r.loopbackEnergyCaptured}`
      )
      if (r.partials > 0) {
        console.log('[e2e] ASSERT partials > 0: PASS')
      } else {
        console.error('[e2e] ASSERT partials > 0: FAIL (real value written, do not retry blindly)')
        process.exitCode = 1
      }
    })
    .catch((err: unknown) => {
      console.error('[e2e] FATAL:', err instanceof Error ? err.message : err)
      process.exitCode = 1
    })
}
