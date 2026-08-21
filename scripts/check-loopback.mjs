#!/usr/bin/env node
/**
 * check-loopback.mjs -- audit plan step 14: PORTABLE twin of
 * scripts/check-loopback.ps1 (plan step 19 verification, Windows WASAPI
 * loopback). The .ps1 stays for Windows; THIS script is the documented entry
 * point on every platform (`node scripts/check-loopback.mjs`).
 *
 * Flow (identical to check-loopback.ps1):
 *   1. `npm run build` in app/ (the check runs the BUILT bundle: fast boot,
 *      no vite dev server).
 *   2. Generate a 3 s 440 Hz tone WAV (16-bit mono PCM @ 16 kHz, pure stdlib).
 *   3. Launch the built app with VEYRA_LOOPBACK_CHECK=1 (+
 *      VEYRA_LOOPBACK_CHECK_OUT). The app auto-starts loopback capture
 *      (getDisplayMedia -> AudioWorklet -> 'pcm-loopback' IPC); main
 *      accumulates int16, computes full-scale RMS, writes
 *      state/loopback-check.json {energyCaptured, rms, samples, durationMs},
 *      and quits (8 s capture window from the first chunk).
 *   4. Play the tone WHILE the app captures, so it is in the loopback mix.
 *   5. Assert energyCaptured === true (RMS > 0.001, plan threshold).
 *
 * Exit 0 on pass; 1 on fail. When the app never wrote the JSON the script
 * records {energyCaptured: false, error: <why>} so the artifact exists and the
 * step is visibly REJECTED (never a faked pass) -- same contract as the .ps1.
 * The JSON is written by the APP with the REAL measured RMS; this script only
 * asserts it.
 *
 * ## Per-platform tone playback (step 14 platform pick)
 * Playing a WAV has no stdlib primitive, so the player is picked per OS:
 *   win32  -> PowerShell System.Media.SoundPlayer PlaySync (what the .ps1 used)
 *   darwin -> afplay
 *   linux  -> paplay, falling back to aplay
 * All are standard OS-bundled CLIs; no dependency added.
 *
 * sefi: PENDING -- this script's full Electron+audio flow has NOT been run on
 * macOS/Linux (this machine is win32), and even on Windows the capture path it
 * exercises is the Electron getDisplayMedia WASAPI loopback verified via the
 * .ps1 twin (state/loopback-check.json). The macOS loopback device story
 * (BlackHole) remains documentation-only: docs/loopback-macos.md, anti-
 * hallucination registry PENDING. Ceiling: run `node scripts/check-loopback.mjs`
 * on a desktop session of each target OS; upgrade path: promote darwin/linux
 * results from PENDING to measured in state/.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const appDir = join(repoRoot, 'app')
const outPath = join(repoRoot, 'state', 'loopback-check.json')
const tempDir = mkdtempSync(join(tmpdir(), 'veyra-loopback-'))
const wavPath = join(tempDir, 'tone-440.wav')
const IS_WIN = process.platform === 'win32'

let appProc = null
let exitCode = 1
const oldCheck = process.env.VEYRA_LOOPBACK_CHECK
const oldOut = process.env.VEYRA_LOOPBACK_CHECK_OUT

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function killTree(child) {
  if (!child || child.pid === undefined) return
  if (IS_WIN) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
    } catch {
      /* best effort */
    }
  } else {
    try {
      child.kill('SIGTERM')
    } catch {
      /* best effort */
    }
  }
}

function writeFailureJson(message) {
  if (existsSync(outPath)) return
  const payload = { energyCaptured: false, rms: 0, samples: 0, durationMs: 0, error: message }
  try {
    writeFileSync(outPath, JSON.stringify(payload))
  } catch (e) {
    console.log(`WARN: could not write failure JSON: ${e.message}`)
  }
}

// --- step 2: 3 s 440 Hz tone, 16-bit mono PCM @ 16 kHz, amplitude 0.25 ---
function generateToneWav() {
  const sampleRate = 16000
  const seconds = 3
  const freq = 440.0
  const amp = 0.25
  const sampleCount = sampleRate * seconds
  const dataBytes = sampleCount * 2
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // fmt chunk size
  header.writeUInt16LE(1, 20) // audio format: PCM
  header.writeUInt16LE(1, 22) // channels: mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataBytes, 40)
  const data = Buffer.alloc(dataBytes)
  for (let i = 0; i < sampleCount; i++) {
    data.writeInt16LE(Math.round(amp * 32767 * Math.sin((2 * Math.PI * freq * i) / sampleRate)), i * 2)
  }
  writeFileSync(wavPath, Buffer.concat([header, data]))
}

// --- step 4: play the tone while the app captures (per-platform player) ---
async function playToneBlocking() {
  if (IS_WIN) {
    // Doubling ' escapes it inside a single-quoted PowerShell string.
    const psPath = wavPath.replaceAll("'", "''")
    return new Promise((resolvePlay, rejectPlay) => {
      const p = spawn(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$p = New-Object Media.SoundPlayer '${psPath}'; $p.PlaySync()`
        ],
        { windowsHide: true, stdio: 'ignore' }
      )
      p.on('exit', (code) =>
        code === 0 ? resolvePlay() : rejectPlay(new Error(`SoundPlayer exited ${code}`))
      )
      p.on('error', rejectPlay)
    })
  }
  const players =
    process.platform === 'darwin'
      ? [['afplay', [wavPath]]]
      : [
          ['paplay', [wavPath]],
          ['aplay', ['-q', wavPath]]
        ]
  for (const [cmd, args] of players) {
    const r = spawnSync(cmd, args, { stdio: 'ignore' })
    if (!r.error && r.status === 0) return
  }
  throw new Error(`no working audio player (tried: ${players.map(([c]) => c).join(', ')})`)
}

try {
  console.log('check-loopback: building app...')
  const build = spawnSync(IS_WIN ? 'cmd.exe' : 'npm', IS_WIN ? ['/d', '/s', '/c', 'npm run build'] : ['run', 'build'], {
    cwd: appDir,
    stdio: 'inherit'
  })
  if (build.status !== 0) throw new Error(`npm run build failed (exit ${build.status})`)

  generateToneWav()
  console.log('check-loopback: generated 440 Hz tone WAV...')

  // --- step 3: launch the built app in check mode ---
  rmSync(outPath, { force: true })
  process.env.VEYRA_LOOPBACK_CHECK = '1'
  process.env.VEYRA_LOOPBACK_CHECK_OUT = outPath
  const electronBin = join(appDir, 'node_modules', '.bin', IS_WIN ? 'electron.cmd' : 'electron')
  console.log('check-loopback: launching app (VEYRA_LOOPBACK_CHECK=1)...')
  appProc = spawn(electronBin, ['.'], {
    cwd: appDir,
    windowsHide: true,
    stdio: 'ignore',
    shell: IS_WIN // Node >= 18 refuses .cmd/.bat without a shell (EINVAL)
  })

  // --- step 4: let the app boot, then play the tone into the loopback mix ---
  await sleep(2000)
  await playToneBlocking()
  await sleep(1000) // tail of the app's 8 s capture window

  // --- step 5: wait for the verdict JSON (the app quits after writing it) ---
  const deadline = Date.now() + 60_000
  while (!existsSync(outPath) && Date.now() < deadline) await sleep(500)
  killTree(appProc)
  appProc = null

  if (!existsSync(outPath)) throw new Error('state/loopback-check.json was not written')
  const result = JSON.parse(readFileSync(outPath, 'utf8'))
  console.log(
    `loopback check: energyCaptured=${result.energyCaptured} rms=${result.rms} samples=${result.samples} durationMs=${result.durationMs} error=${result.error}`
  )
  if (result.energyCaptured !== true) {
    throw new Error(`loopback energy NOT captured (energyCaptured false, rms ${result.rms})`)
  }
  if (!(Number(result.rms) > 0.001)) {
    throw new Error(`assert captured RMS > 0.001 failed (rms ${result.rms})`)
  }
  exitCode = 0
  console.log('check-loopback: PASS')
} catch (err) {
  console.log(`check-loopback: FAIL: ${err.message}`)
  writeFailureJson(err.message)
  exitCode = 1
} finally {
  // Restore caller env, kill a lingering app tree, drop the temp tone.
  if (oldCheck === undefined) delete process.env.VEYRA_LOOPBACK_CHECK
  else process.env.VEYRA_LOOPBACK_CHECK = oldCheck
  if (oldOut === undefined) delete process.env.VEYRA_LOOPBACK_CHECK_OUT
  else process.env.VEYRA_LOOPBACK_CHECK_OUT = oldOut
  killTree(appProc)
  rmSync(tempDir, { recursive: true, force: true })
}
process.exit(exitCode)
