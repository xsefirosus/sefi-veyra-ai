#!/usr/bin/env node
/**
 * setup-wlk.mjs -- audit plan step 14: PORTABLE installer for the local STT
 * server (WhisperLiveKit) into app/.wlk-venv.
 *
 * This is the cross-platform twin of scripts/setup-wlk.ps1, which is kept for
 * Windows. Platform pick:
 *   - macOS / Linux / any OS with node + python3: THIS script (`node scripts/setup-wlk.mjs`)
 *   - Windows: either this script or scripts/setup-wlk.ps1 -- both work; the
 *     .mjs is the single entry point documented for all platforms.
 *
 * Flow (identical to setup-wlk.ps1, proven 2026-08-20, state/wlk-install.log):
 *   1. `python -m venv app/.wlk-venv`            (skipped when the venv exists)
 *   2. `<venv python> -m pip install --upgrade pip`  (fresh-venv pip on 3.11 is
 *      23.x and mis-resolves torch; cheap insurance before the GBs install)
 *   3. `<venv python> -m pip install whisperlivekit`
 *   4. verify the CLI: `<venv> .../wlk --help` must exit 0
 *
 * Package facts (verified from the WhisperLiveKit README on 2026-08-20 before
 * writing setup-wlk.ps1; see that script's header): pip name
 * `whisperlivekit`, CLI entry point `wlk`, Python 3.11-3.13.
 *
 * ## Venv layout per platform -- MUST match wlkBinPath() in
 * ## app/src/main/stt/wlk-server.ts (unit-tested in tests/wlk-server.test.ts,
 * ## "wlkBinPath platform branch"):
 *   win32 -> .wlk-venv/Scripts/python.exe, .wlk-venv/Scripts/wlk.exe
 *   posix -> .wlk-venv/bin/python,        .wlk-venv/bin/wlk
 * That posix branch is CONFIRMED at the path-selection/existence-check seam by
 * the unit suite, but a REAL macOS/Linux venv install has never been run:
 * PENDING per the anti-hallucination registry -- do not claim macOS works
 * until this script completes there.
 *
 * Interpreter pick: win32 -> `python`, posix -> $PYTHON or `python3`
 * (posix distros do not reliably provide a bare `python`). Override with
 * PYTHON=/path/to/python3.
 *
 * Idempotent: re-running skips venv creation; pip's cache makes a re-install
 * cheap when everything is already satisfied.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const venv = join(repoRoot, 'app', '.wlk-venv')
const IS_WIN = process.platform === 'win32'

// Layout constants -- keep in sync with wlkBinPath() (see header).
const venvPython = join(venv, IS_WIN ? 'Scripts' : 'bin', IS_WIN ? 'python.exe' : 'python')
const wlkBin = join(venv, IS_WIN ? 'Scripts' : 'bin', IS_WIN ? 'wlk.exe' : 'wlk')
const pyLauncher = process.env.PYTHON ?? (IS_WIN ? 'python' : 'python3')

function run(label, cmd, args) {
  console.log(`==> ${label}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit' })
  if (r.error) throw new Error(`${label}: could not run "${cmd}" (${r.error.message})`)
  if (r.status !== 0) {
    throw new Error(`${label}: exit ${r.status ?? 'signal ' + r.signal}`)
  }
}

if (!existsSync(venvPython)) {
  run(`python -m venv ${venv}`, pyLauncher, ['-m', 'venv', venv])
} else {
  console.log(`==> venv already exists at ${venv} (skipping creation)`)
}

// `python -m pip`, never the pip executable: pip refuses to self-modify its own
// console script (same reason setup-wlk.ps1 documents).
run('upgrading pip in venv', venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'])
run('pip install whisperlivekit (torch/faster-whisper is GBs -- long wall-clock)', venvPython, [
  '-m',
  'pip',
  'install',
  'whisperlivekit'
])

run(`verifying venv CLI: ${wlkBin} --help`, wlkBin, ['--help'])

console.log(`OK: whisperlivekit installed into ${venv}; CLI wlk responds to --help`)
