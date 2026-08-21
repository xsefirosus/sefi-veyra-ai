/**
 * Loopback capture (plan step 19): system audio via getDisplayMedia, following
 * the electron-audio-loopback README
 * (https://github.com/alectrocute/electron-audio-loopback).
 *
 * ## README-first decision -- NO dependency added (verified, cited)
 * The plan says "add the dependency" (electron-audio-loopback). The README's
 * Requirements section (read 2026-08-20) bounds the plugin to
 * "Electron >=31.0.1" AND "Electron <39.0.0":
 *
 *   "Electron 39 and up--you're in the clear--you won't require
 *    electron-audio-loopback, read more (#7). If you run into system audio
 *    capture issues, it's likely a skill issue. Please see
 *    @chrhartm/electron-mic-speaker-loop for a working Electron 39 demo that
 *    doesn't use any additional dependencies."
 *
 * Issue #7 confirms the plugin is broken on 39 ("I don't seem to get any
 * audio. The plugin works correctly with electron 38."). Installed Electron is
 * 39.8.10 (npm ls electron, verified 2026-08-20), so the README's patch is NOT
 * applicable and its install step must NOT run. Electron 39 captures system
 * audio natively: renderer getDisplayMedia({audio:true}) resolved by a
 * main-process session.setDisplayMediaRequestHandler that returns
 * {video: <screen source>, audio: 'loopback'} (the chrhartm demo's exact
 * pattern, wired in src/main/index.ts). The plugin's IPC surface
 * (enable-loopback-audio / disable-loopback-audio) is the 31-39 patch's API
 * and is deliberately NOT registered here.
 *
 * ## Capture path -- README manual-mode, dual-track
 * getDisplayMedia({video: true, audio: true}) -- the README's constraint
 * ("getDisplayMedia will fail if you don't request video: true") -- then the
 * video tracks are stopped/removed ("You may find bugs if you don't remove
 * video tracks"). The remaining audio track flows through the SAME
 * AudioWorklet -> downsample(->16 kHz) -> IPC pipeline as mic-capture.ts, but
 * on its own channel ('pcm-loopback') so main routes it to the SECOND
 * SttAdapter session (plan decision 6: dual-track, source 'loopback', separate
 * wlk session; see src/main/index.ts startLoopbackBridge).
 *
 * ## AudioContext autoplay
 * Electron's default autoplay policy is no-user-gesture-required, so the
 * capture AudioContext starts running without a gesture; resume() below is a
 * defensive no-op under that policy (and the documented escape if a future
 * Electron flips the default).
 */
import { downsample } from '../../../shared/audio/format'
import pcmProcessorUrl from './pcm-processor?worker&url'
import type { CaptureMode } from './mic-capture'

/**
 * Sentinel device id for the settings "System audio (loopback)" entry (plan
 * step 19: "Add the loopback device to the settings device list"). Loopback is
 * a virtual capture track, NOT an audioinput device: this value must never be
 * passed to getUserMedia -- any future consumer of settings.audioDeviceId must
 * skip it (the mic path is the only consumer and it treats it as absent).
 */
export const LOOPBACK_DEVICE_ID = '__veyra_loopback__'

export interface LoopbackCaptureOptions {
  /** Called when the worklet fails to load and the fallback engages. */
  onFallback?: (mode: CaptureMode, err: Error) => void
}

export interface LoopbackCaptureHandle {
  stop: () => Promise<void>
  /** Which processor ran: 'audioworklet' or the deprecated script fallback. */
  mode: CaptureMode
  /** The AudioContext's actual sample rate (what downsample resampled from). */
  contextSampleRate: number
}

export async function startLoopbackCapture(
  opts: LoopbackCaptureOptions = {}
): Promise<LoopbackCaptureHandle> {
  // README manual mode: video: true is REQUIRED for the audio track; the video
  // tracks are then stopped/removed because the README warns of bugs otherwise.
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
  const videoTracks = stream.getVideoTracks()
  for (const track of videoTracks) {
    track.stop()
    stream.removeTrack(track)
  }
  const audioTracks = stream.getAudioTracks()
  if (audioTracks.length === 0) {
    for (const track of videoTracks) track.stop() // safety: never leak a live track
    throw new Error('loopback-capture: getDisplayMedia returned no audio track')
  }

  const ctx = new AudioContext()
  if (ctx.state === 'suspended') await ctx.resume()
  const source = ctx.createMediaStreamSource(stream)
  const sendChunk = (frame: Float32Array): void => {
    // Frame is at ctx.sampleRate; the adapter contract is 16 kHz mono int16.
    const chunk = downsample(frame, ctx.sampleRate, 16000)
    window.api.sendLoopbackPcm(chunk)
  }

  let mode: CaptureMode
  let workletNode: AudioWorkletNode | null = null
  let scriptNode: ScriptProcessorNode | null = null

  try {
    await ctx.audioWorklet.addModule(pcmProcessorUrl)
    workletNode = new AudioWorkletNode(ctx, 'pcm-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1
    })
    workletNode.port.onmessage = (ev: MessageEvent<Float32Array>): void => sendChunk(ev.data)
    source.connect(workletNode)
    mode = 'audioworklet'
  } catch (err) {
    // sefi: ScriptProcessorNode is a deprecated API (replaced by AudioWorklet);
    // ceiling = worklet-load failure in this environment only. Upgrade path:
    // fix the addModule URL (see mic-capture.ts header) -- the fallback
    // disappears with the worklet loading, no API surface change.
    const fbErr = err instanceof Error ? err : new Error(String(err))
    mode = 'scriptprocessor'
    scriptNode = ctx.createScriptProcessor(4096, 1, 1)
    scriptNode.onaudioprocess = (ev: AudioProcessingEvent): void =>
      sendChunk(ev.inputBuffer.getChannelData(0))
    source.connect(scriptNode)
    opts.onFallback?.(mode, fbErr)
  }

  return {
    mode,
    contextSampleRate: ctx.sampleRate,
    async stop(): Promise<void> {
      workletNode?.disconnect()
      scriptNode?.disconnect()
      source.disconnect()
      for (const track of stream.getTracks()) track.stop()
      await ctx.close()
    }
  }
}
