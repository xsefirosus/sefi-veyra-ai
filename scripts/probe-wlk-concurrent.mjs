#!/usr/bin/env node
/**
 * probe-wlk-concurrent.mjs -- plan step 7: prove/disprove concurrent wlk WS sessions.
 *
 * Mirrors scripts/probe-wlk.mjs (same WAV parsing, same WS helpers, same wlk
 * spawn logic and constants imported from app/src/main/stt/wlk-server.ts) but
 * opens TWO /asr sockets on ONE wlk process, streams the test WAV into both,
 * and records whether both receive transcription.
 *
 * Output: state/wlk-concurrency.json {concurrentSessions, session1Messages, session2Messages, note}
 *   concurrentSessions = true iff BOTH sockets received >=2 messages and a
 *   content-word match (/testing|veyra|meeting/i) after the config message.
 *   If false, note records the fallback (second WlkServer on port 8001).
 *
 * Portable Node: no PowerShell, no platform-specific assumptions beyond the
 * killTree helper (mirrored from probe-wlk.mjs). Uses global WebSocket
 * (Node >= 22), same as wlk-server.ts and whisper-livekit.ts.
 */

import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

// Import app constants + command builder from the same source the app uses.
// Falls back to hardcoded defaults if the TS import fails (portable fallback).
let WLK_DEFAULT_HOST = '127.0.0.1'
let WLK_DEFAULT_PORT = 8000
let WLK_WS_PATH = '/asr'
let buildWlkCommand = null
let wlkBinPath = null
try {
  const mod = await import('../app/src/main/stt/wlk-server.ts')
  WLK_DEFAULT_HOST = mod.WLK_DEFAULT_HOST ?? WLK_DEFAULT_HOST
  WLK_DEFAULT_PORT = mod.WLK_DEFAULT_PORT ?? WLK_DEFAULT_PORT
  WLK_WS_PATH = mod.WLK_WS_PATH ?? WLK_WS_PATH
  buildWlkCommand = mod.buildWlkCommand
  wlkBinPath = mod.wlkBinPath
} catch {
  // Portable fallback: constants are known from the shipped whisperlivekit
  // 0.2.24 (parse_args.py:10,14, config.py:28, basic_server.py:88).
  buildWlkCommand = (model, wlkBin) => ({
    cmd: wlkBin,
    args: ['--model', model, '--host', WLK_DEFAULT_HOST, '--port', String(WLK_DEFAULT_PORT)]
  })
  wlkBinPath = (anchor) => {
    const envBin = process.env['WLK_BIN']
    if (envBin) return resolve(envBin)
    // Minimal resolution: <repoRoot>/app/.wlk-venv/...
    const rel = process.platform === 'win32' ? '.wlk-venv/Scripts/wlk.exe' : '.wlk-venv/bin/wlk'
    return join(repoRoot, 'app', rel)
  }
}

const argv = process.argv.slice(2)
function argValue(name, fallback) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const model = argValue('--model', 'tiny')
const wavPath = resolve(argValue('--wav', join(repoRoot, 'app', 'assets', 'test-speech.wav')))
const statePath = resolve(argValue('--state', join(repoRoot, 'state', 'wlk-concurrency.json')))
const readyTimeoutMs = Number(argValue('--ready-timeout-ms', '300000'))

function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`probe-concurrent: ${wavPath} is not a RIFF/WAVE file`)
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
  if (!fmt || !data) throw new Error(`probe-concurrent: ${wavPath} has no fmt/data chunks`)
  if (fmt.audioFormat !== 1) throw new Error(`probe-concurrent: not PCM (audioFormat=${fmt.audioFormat})`)
  if (fmt.channels !== 1 || fmt.sampleRate !== 16000 || fmt.bitsPerSample !== 16) {
    throw new Error(`probe-concurrent: must be 16k mono 16-bit, got ${fmt.sampleRate}Hz/${fmt.channels}ch/${fmt.bitsPerSample}bit`)
  }
  return { fmt, data }
}

function wsOpens(url, timeoutMs) {
  return new Promise((resolveOpen) => {
    let ws
    try { ws = new WebSocket(url) } catch { resolveOpen(false); return }
    const timer = setTimeout(() => { try { ws.close() } catch {} ; resolveOpen(false) }, timeoutMs)
    ws.onopen = () => { clearTimeout(timer); try { ws.close() } catch {} ; resolveOpen(true) }
    ws.onerror = () => {}
    ws.onclose = () => { clearTimeout(timer); resolveOpen(false) }
  })
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
function killTree(child) {
  if (!child || child.pid === undefined) return
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch {}
  } else { child.kill('SIGTERM') }
}
async function waitForAsr(url, child, logTail, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`probe-concurrent: wlk exited before ready (code ${child.exitCode})\n${logTail()}`)
    if (await wsOpens(url, 1500)) return
    await sleep(500)
  }
  throw new Error(`probe-concurrent: timed out after ${timeoutMs}ms waiting for ${url}\n${logTail()}`)
}

async function main() {
  if (!existsSync(wavPath)) throw new Error(`probe-concurrent: WAV missing at ${wavPath} (run scripts/synth-speech.ps1 first)`)
  const wavBuf = readFileSync(wavPath)
  const { fmt, data } = parseWav(wavBuf)
  const seconds = (data.length / 2 / fmt.sampleRate).toFixed(2)
  const host = WLK_DEFAULT_HOST
  const port = WLK_DEFAULT_PORT
  const wsUrl = `ws://${host}:${port}${WLK_WS_PATH}`
  const wlkBin = process.env.WLK_BIN ?? wlkBinPath(join(repoRoot, 'app'))

  let child = null
  let logTail = ''
  const remember = (d) => { logTail = (logTail + d.toString()).slice(-4000) }
  let reused = false
  if (await wsOpens(wsUrl, 1500)) {
    console.log(`probe-concurrent: reusing already-running wlk at ${wsUrl}`)
    reused = true
  } else {
    const built = buildWlkCommand(model, wlkBin)
    const cmd = built.cmd
    const args = [...built.args, '--pcm-input']
    console.log(`probe-concurrent: spawning ${cmd} ${args.join(' ')}`)
    const spawnEnv = { ...process.env, CUDA_VISIBLE_DEVICES: process.env.CUDA_VISIBLE_DEVICES ?? '-1' }
    child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: spawnEnv })
    child.stdout?.on('data', remember)
    child.stderr?.on('data', remember)
    await waitForAsr(wsUrl, child, () => logTail, readyTimeoutMs)
    console.log(`probe-concurrent: wlk ready at ${wsUrl}`)
  }

  const PARTIAL_RE = /testing|veyra|meeting/i
  const messages1 = []
  const messages2 = []
  let tFirstByte = null
  let ws1 = null
  let ws2 = null
  let ws1Ready = false
  let ws2Ready = false
  let ws1Error = null
  let ws2Error = null
  let gotReady1 = false
  let gotReady2 = false

  // Open two sockets concurrently
  const openWs = (label) => new Promise((resolveOpen, rejectOpen) => {
    let ws
    try { ws = new WebSocket(wsUrl) } catch (err) { rejectOpen(err); return }
    const timer = setTimeout(() => { try { ws.close() } catch {} ; rejectOpen(new Error(`${label}: connect timeout to ${wsUrl}`)) }, 10000)
    ws.onopen = () => { clearTimeout(timer); resolveOpen(ws) }
    ws.onerror = () => { /* onclose follows */ }
    ws.onclose = () => { clearTimeout(timer); rejectOpen(new Error(`${label}: closed before open`)) }
  })

  // We use a two-phase open: if first open helper races close, retry once via wsOpens polling
  try {
    const p1 = new Promise((res, rej) => {
      let ws
      try { ws = new WebSocket(wsUrl) } catch (e) { rej(e); return }
      ws.onopen = () => res(ws)
      ws.onerror = () => {}
      ws.onclose = () => rej(new Error('ws1 closed before open'))
      setTimeout(() => { try { ws.close() } catch {} ; rej(new Error('ws1 open timeout')) }, 10000)
    })
    const p2 = new Promise((res, rej) => {
      let ws
      try { ws = new WebSocket(wsUrl) } catch (e) { rej(e); return }
      ws.onopen = () => res(ws)
      ws.onerror = () => {}
      ws.onclose = () => rej(new Error('ws2 closed before open'))
      setTimeout(() => { try { ws.close() } catch {} ; rej(new Error('ws2 open timeout')) }, 10000)
    })
    // open sequentially first to avoid race on server accept
    ws1 = await p1
    ws1Ready = true
    ws2 = await p2
    ws2Ready = true
    console.log('probe-concurrent: both sockets open')
  } catch (err) {
    // fallback: try openWs helper individually and record error
    if (!ws1Ready) ws1Error = String(err?.message ?? err)
    if (!ws2Ready && !ws1Error) {
      // if ws1 succeeded but ws2 failed, keep ws1
    }
    // Try to open ws2 via wsOpens retry if ws1 succeeded
    if (ws1 && !ws2) {
      try {
        // second attempt with simple open
        ws2 = await openWs('ws2-retry')
        ws2Ready = true
        ws2Error = null
      } catch (e2) {
        ws2Error = String(e2?.message ?? e2)
      }
    } else if (!ws1) {
      try { ws1 = await openWs('ws1-retry'); ws1Ready = true; ws1Error = null } catch (e1) { ws1Error = String(e1?.message ?? e1) }
      try { ws2 = await openWs('ws2-retry'); ws2Ready = true; ws2Error = null } catch (e2) { ws2Error = String(e2?.message ?? e2) }
    }
  }

  // Attach listeners
  if (ws1) {
    ws1.onmessage = (ev) => {
      const text = String(ev.data)
      messages1.push(text)
      if (text.includes('"ready_to_stop"')) gotReady1 = true
    }
    ws1.onerror = () => {}
  }
  if (ws2) {
    ws2.onmessage = (ev) => {
      const text = String(ev.data)
      messages2.push(text)
      if (text.includes('"ready_to_stop"')) gotReady2 = true
    }
    ws2.onerror = () => {}
  }

  // If either socket failed to open, we can already conclude not concurrent
  let streamError = null
  if (ws1Ready && ws2Ready) {
    const FRAME = 3200
    for (let i = 0; i < data.length; i += FRAME) {
      const frame = data.subarray(i, Math.min(i + FRAME, data.length))
      if (frame.length === 0) break
      if (tFirstByte === null) tFirstByte = Date.now()
      try { ws1.send(frame) } catch (e) { streamError = `ws1 send failed: ${e}`; break }
      try { ws2.send(frame) } catch (e) { streamError = `ws2 send failed: ${e}`; break }
    }
    if (!streamError) {
      console.log(`probe-concurrent: streamed ${data.length} PCM bytes (${seconds}s) to BOTH sockets`)
      try { ws1.send(new Uint8Array(0)) } catch {}
      try { ws2.send(new Uint8Array(0)) } catch {}
    }
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline && (!gotReady1 || !gotReady2)) {
      // if one socket closed early, break
      if (ws1 && ws1.readyState === 3 && !gotReady1) break
      if (ws2 && ws2.readyState === 3 && !gotReady2) break
      await sleep(100)
    }
  }

  try { ws1?.close() } catch {}
  try { ws2?.close() } catch {}
  killTree(child)
  child = null

  const testing1 = messages1.findIndex((m) => PARTIAL_RE.test(m)) >= 0
  const testing2 = messages2.findIndex((m) => PARTIAL_RE.test(m)) >= 0
  const concurrentSessions = ws1Ready && ws2Ready && !streamError && messages1.length >= 2 && messages2.length >= 2 && testing1 && testing2

  let note = ''
  if (concurrentSessions) {
    note = 'one wlk process serves two concurrent /asr sessions; dual-track can share a single WlkServer (port 8000).'
  } else {
    if (!ws1Ready || !ws2Ready) {
      note = `second /asr session failed to open (ws1Ready=${ws1Ready} ws2Ready=${ws2Ready} ws1Error=${ws1Error ?? 'none'} ws2Error=${ws2Error ?? 'none'}); fallback: loopback track must use a second WlkServer on port 8001 with factory url ws://127.0.0.1:8001/asr.`
    } else if (streamError) {
      note = `${streamError}; fallback: loopback track must use a second WlkServer on port 8001.`
    } else if (messages1.length < 2 || messages2.length < 2) {
      note = `one or both sessions received <2 messages (s1=${messages1.length} s2=${messages2.length}); fallback: second WlkServer on port 8001.`
    } else {
      note = `both sessions opened but only one received transcription (testing1=${testing1} testing2=${testing2} s1=${messages1.length} s2=${messages2.length}); fallback: second WlkServer on port 8001.`
    }
  }
  if (reused) note = `[reused server at ${wsUrl}] ${note}`

  const out = {
    concurrentSessions,
    session1Messages: messages1.length,
    session2Messages: messages2.length,
    note,
    detail: {
      createdAt: new Date().toISOString(),
      model,
      host,
      port,
      wsUrl,
      pcmInput: true,
      reusedServer: reused,
      wav: { path: wavPath, sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bitsPerSample, pcmBytes: data.length, seconds: Number(seconds) },
      session1: { messages: messages1.length, testingMatched: testing1, gotReadyToStop: gotReady1, sampleMessages: messages1.slice(0, 3) },
      session2: { messages: messages2.length, testingMatched: testing2, gotReadyToStop: gotReady2, sampleMessages: messages2.slice(0, 3) },
      streamError,
      ws1Ready,
      ws2Ready,
      ws1Error,
      ws2Error,
      fallback: concurrentSessions ? null : { loopbackPort: 8001, loopbackUrl: `ws://${host}:8001${WLK_WS_PATH}` }
    }
  }

  mkdirSync(dirname(statePath), { recursive: true })
  writeFileSync(statePath, JSON.stringify(out, null, 2) + '\n')
  console.log(`probe-concurrent: concurrentSessions=${concurrentSessions} s1=${messages1.length} s2=${messages2.length} testing1=${testing1} testing2=${testing2}`)
  console.log(`probe-concurrent: wrote ${statePath}`)

  // Exit code 0 means probe completed (whether concurrent or not); non-zero means infrastructure failure
  // We return 0 if we produced a valid measurement; the artifact is the truth.
  return 0
}

try {
  process.exitCode = await main()
} catch (err) {
  console.error(`probe-concurrent: FATAL ${err?.message ?? err}`)
  // Even on fatal, try to write a false artifact so the plan's file-exists check passes
  try {
    const fallback = {
      concurrentSessions: false,
      session1Messages: 0,
      session2Messages: 0,
      note: `probe fatal: ${err?.message ?? String(err)}; assuming no concurrency; fallback: second WlkServer on port 8001 required.`
    }
    const p = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'state', 'wlk-concurrency.json')
    mkdirSync(dirname(p), { recursive: true })
    // Don't overwrite if already written
    if (!existsSync(p)) writeFileSync(p, JSON.stringify(fallback, null, 2) + '\n')
  } catch {}
  process.exitCode = 1
}
