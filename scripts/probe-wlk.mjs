#!/usr/bin/env node
/**
 * probe-wlk.mjs -- plan step 14: capture REAL wlk /asr fixtures.
 *
 * Spawns the app's venv wlk (same command builder as step 13's WlkServer),
 * streams the 16 kHz mono PCM from app/assets/test-speech.wav over the wlk
 * /asr WebSocket, saves EVERY JSON message verbatim to
 * app/tests/fixtures/wlk-messages.json, and writes first-partial-ms to
 * state/wlk-probe.json.
 *
 * ## Endpoint -- taken from wlk-server.ts, NOT hardcoded
 * The plan's research digest said 9090; the REAL shipped default is 8000
 * (parse_args.py:14, config.py:28) and /asr is the real WS path
 * (basic_server.py:88). This script imports WLK_DEFAULT_PORT / WLK_WS_PATH /
 * WLK_DEFAULT_HOST and buildWlkCommand from app/src/main/stt/wlk-server.ts --
 * the exact values the app uses -- so the probe can never drift from the app.
 *
 * ## Why --pcm-input is appended
 * buildWlkCommand does not pass --pcm-input (step 13 only needed a readiness
 * probe). Without it the server routes client bytes through ffmpeg
 * (audio_processor.py:118-122); the probe streams RAW PCM, so it appends
 * --pcm-input (parse_args.py:260-263). This framing is what step 16's adapter
 * replicates.
 *
 * ## Why CUDA_VISIBLE_DEVICES=-1 (verified on this machine, 2026-08-20)
 * wlk crashed at startup with "Library cublas64_12.dll is not found or cannot
 * be loaded": the faster-whisper encoder is loaded with device='auto'
 * (simul_whisper/backend.py:430-431), auto picked CUDA because a driver is
 * present (ctranslate2.get_cuda_device_count() == 1), but the venv's CUDA
 * runtime DLLs (cublas64_12.dll) are missing. With CUDA_VISIBLE_DEVICES=-1 the
 * count is 0 (verified) and 'auto' falls back to CPU -- the plan's v1 mode
 * ("GPU auto-detect flaky -- CPU mode fine for v1"). An explicit
 * CUDA_VISIBLE_DEVICES in the environment is respected (override).
 * NOTE for step 21 (e2e harness): WlkServer (step 13) spawns wlk WITHOUT this
 * env and will hit the same cublas error; the fix belongs at the spawn site.
 *
 * ## Server protocol (sourced from the installed package)
 * - client sends binary frames of s16le 16 kHz mono PCM (audio_processor.py
 *   convert_pcm_to_float:306-308);
 * - an EMPTY binary frame ends the stream (audio_processor.py:878-890);
 * - server JSON messages: first {"type":"config",...} (basic_server.py:127),
 *   then FrontData updates, then {"type":"ready_to_stop"} (basic_server.py:81).
 *
 * ## Fixture shape
 * JSON array of VERBATIM message strings -- each element is the exact text the
 * server sent (nothing renamed/normalized). Step 15 JSON.parses each element
 * and derives field names from the REAL captured text; the step-14 assertion
 * only requires >= 2 messages and one message containing "testing"
 * (case-insensitive), with NO field-name assumptions.
 *
 * ## first-partial-ms criterion (documented, reproducible)
 * milliseconds from the first PCM byte sent to the first message AFTER the
 * config message whose JSON text matches /testing|veyra|meeting/i -- content
 * words from the fixed synth sentence that never appear in config/status
 * strings. null (PENDING) if no such message arrived.
 */

import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildWlkCommand,
  WLK_DEFAULT_HOST,
  WLK_DEFAULT_PORT,
  WLK_WS_PATH,
  wlkBinPath
} from '../app/src/main/stt/wlk-server.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

// --- CLI args (minimal; defaults are the step-14 paths) ---
const argv = process.argv.slice(2)
function argValue(name, fallback) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const model = argValue('--model', 'tiny')
const wavPath = resolve(argValue('--wav', join(repoRoot, 'app', 'assets', 'test-speech.wav')))
const outPath = resolve(argValue('--out', join(repoRoot, 'app', 'tests', 'fixtures', 'wlk-messages.json')))
const statePath = resolve(argValue('--state', join(repoRoot, 'state', 'wlk-probe.json')))
const readyTimeoutMs = Number(argValue('--ready-timeout-ms', '300000')) // first run downloads weights (network)

// --- WAV parsing: strict 16k/16-bit/mono s16le ---
function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`probe: ${wavPath} is not a RIFF/WAVE file`)
  }
  let fmt = null
  let data = null
  let off = 12
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(off + 8),
        channels: buf.readUInt16LE(off + 10),
        sampleRate: buf.readUInt32LE(off + 12),
        bitsPerSample: buf.readUInt16LE(off + 22)
      }
    } else if (id === 'data') {
      data = buf.subarray(off + 8, off + 8 + size)
    }
    off += 8 + size + (size % 2)
  }
  if (!fmt || !data) throw new Error(`probe: ${wavPath} has no fmt/data chunks`)
  if (fmt.audioFormat !== 1) throw new Error(`probe: ${wavPath} is not PCM (audioFormat=${fmt.audioFormat})`)
  if (fmt.channels !== 1 || fmt.sampleRate !== 16000 || fmt.bitsPerSample !== 16) {
    throw new Error(
      `probe: ${wavPath} must be 16k mono 16-bit, got ${fmt.sampleRate}Hz/${fmt.channels}ch/${fmt.bitsPerSample}bit`
    )
  }
  return { fmt, data }
}

// --- helpers ---
function wsOpens(url, timeoutMs) {
  return new Promise((resolveOpen) => {
    let ws
    try {
      ws = new WebSocket(url)
    } catch {
      resolveOpen(false)
      return
    }
    const timer = setTimeout(() => {
      try { ws.close() } catch { /* ignore */ }
      resolveOpen(false)
    }, timeoutMs)
    ws.onopen = () => {
      clearTimeout(timer)
      try { ws.close() } catch { /* ignore */ }
      resolveOpen(true)
    }
    ws.onerror = () => { /* onclose follows */ }
    ws.onclose = () => {
      clearTimeout(timer)
      resolveOpen(false)
    }
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function killTree(child) {
  if (!child || child.pid === undefined) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } catch { /* best effort */ }
  } else {
    child.kill('SIGTERM')
  }
}

async function waitForAsr(url, child, logTail, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`probe: wlk exited before ready (code ${child.exitCode})\n${logTail()}`)
    }
    if (await wsOpens(url, 1500)) return
    await sleep(500)
  }
  throw new Error(`probe: timed out after ${timeoutMs}ms waiting for ${url}\n${logTail()}`)
}

// --- main ---
async function main() {
  if (!existsSync(wavPath)) throw new Error(`probe: WAV missing at ${wavPath} (run scripts/synth-speech.ps1 first)`)
  const wavBuf = readFileSync(wavPath)
  const { fmt, data } = parseWav(wavBuf)
  const seconds = (data.length / 2 / fmt.sampleRate).toFixed(2)

  // The app's own constants and command builder -- single source of truth.
  const host = WLK_DEFAULT_HOST
  const port = WLK_DEFAULT_PORT
  const wsUrl = `ws://${host}:${port}${WLK_WS_PATH}`
  const wlkBin = process.env.WLK_BIN ?? wlkBinPath(join(repoRoot, 'app'))

  let child = null
  let logTail = ''
  const remember = (d) => {
    logTail = (logTail + d.toString()).slice(-4000)
  }

  // Reuse an already-running wlk if one answers (e.g. a leftover probe server
  // on the same port started with --pcm-input); otherwise spawn our own.
  let reused = false
  if (await wsOpens(wsUrl, 1500)) {
    console.log(`probe: reusing already-running wlk at ${wsUrl}`)
    reused = true
  } else {
    const { cmd, args } = buildWlkCommand(model, wlkBin)
    args.push('--pcm-input') // raw PCM framing; see header
    console.log(`probe: spawning ${cmd} ${args.join(' ')}`)
    // Force ctranslate2 to CPU (see header): driver present, CUDA runtime DLLs
    // missing. Respect an explicit CUDA_VISIBLE_DEVICES override if set.
    const spawnEnv = {
      ...process.env,
      CUDA_VISIBLE_DEVICES: process.env.CUDA_VISIBLE_DEVICES ?? '-1'
    }
    child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: spawnEnv })
    child.stdout?.on('data', remember)
    child.stderr?.on('data', remember)
    await waitForAsr(wsUrl, child, () => logTail, readyTimeoutMs)
    console.log(`probe: wlk ready at ${wsUrl}`)
  }

  const ws = new WebSocket(wsUrl)
  const messages = []
  let tFirstByte = null
  let firstPartialMs = null
  let firstPartialMessage = null
  let gotReadyToStop = false
  const PARTIAL_RE = /testing|veyra|meeting/i // content words from the fixed synth sentence

  await new Promise((resolveOpen, rejectOpen) => {
    ws.onopen = resolveOpen
    ws.onerror = () => rejectOpen(new Error(`probe: WS error connecting to ${wsUrl}`))
  })
  ws.onerror = null

  ws.onmessage = (ev) => {
    const text = String(ev.data)
    messages.push(text)
    if (firstPartialMs === null && messages.length > 1 && PARTIAL_RE.test(text)) {
      firstPartialMs = tFirstByte === null ? null : Date.now() - tFirstByte
      firstPartialMessage = text
    }
    if (text.includes('"ready_to_stop"')) gotReadyToStop = true
  }
  ws.onclose = () => { /* recorded via messages/gotReadyToStop */ }

  // Stream the WAV in 100 ms frames (3200 bytes = 1600 samples), matching the
  // server's min-chunk-size (0.1 s default); an empty frame ends the stream.
  const FRAME = 3200
  for (let i = 0; i < data.length; i += FRAME) {
    const frame = data.subarray(i, Math.min(i + FRAME, data.length))
    if (frame.length === 0) break
    if (tFirstByte === null) tFirstByte = Date.now()
    ws.send(frame)
  }
  console.log(`probe: streamed ${data.length} PCM bytes (${seconds}s) to ${wsUrl}`)
  ws.send(new Uint8Array(0)) // end of stream
  const postStreamDeadline = Date.now() + 30_000
  while (!gotReadyToStop && Date.now() < postStreamDeadline) await sleep(100)
  try { ws.close() } catch { /* ignore */ }
  // Kill the spawned wlk (whole tree on win32) so this node process can exit;
  // a leftover uvicorn would hold the port. No-op when reusing an existing server.
  killTree(child)
  child = null

  // Persist EVERY message verbatim (exact server text, one per array element).
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(messages, null, 1) + '\n')

  // Assertions (plan step 14): >= 2 messages and "testing" appears
  // case-insensitively in at least one message's JSON string.
  const messageCount = messages.length
  const testingIdx = messages.findIndex((m) => /testing/i.test(m))
  const testingMatched = testingIdx >= 0
  const matchedMessage = testingMatched ? messages[testingIdx] : null

  const probeState = {
    step: 14,
    createdAt: new Date().toISOString(),
    model,
    host,
    port,
    wsUrl,
    pcmInput: true,
    reusedServer: reused,
    cudaNote: 'CUDA_VISIBLE_DEVICES=-1 set on the spawned wlk: faster-whisper encoder device=auto (simul_whisper/backend.py:430) picked CUDA (driver present, cublas64_12.dll missing from venv); -1 forces CPU (verified get_cuda_device_count 1->0)',
    fixture: outPath,
    wav: { path: wavPath, sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bitsPerSample, pcmBytes: data.length, seconds: Number(seconds) },
    messageCount,
    firstPartialMs, // null = PENDING (no partial carrying the spoken words arrived)
    firstPartialCriterion: 'ms from first PCM byte sent to first message after the config message whose JSON text matches /testing|veyra|meeting/i',
    firstPartialMessage,
    testingMatched,
    matchedMessage
  }
  writeFileSync(statePath, JSON.stringify(probeState, null, 2) + '\n')

  const failures = []
  if (messageCount < 2) failures.push(`fixture has ${messageCount} messages (< 2)`)
  if (!testingMatched) failures.push('no message JSON string contains "testing" (case-insensitive)')

  if (failures.length === 0) {
    console.log(`probe: OK -- ${messageCount} messages, "testing" found in message ${testingIdx}, firstPartialMs=${firstPartialMs}`)
  } else {
    console.error(`probe: ASSERT FAILED\n${failures.join('\n')}\nlog tail:\n${logTail}`)
  }
  return failures.length === 0 ? 0 : 1
}

try {
  process.exitCode = await main()
} catch (err) {
  console.error(`probe: FATAL ${err.message}`)
  process.exitCode = 1
}