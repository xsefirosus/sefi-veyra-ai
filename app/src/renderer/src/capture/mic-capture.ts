/**
 * Mic capture (plan step 17). getUserMedia -> AudioContext -> AudioWorklet ->
 * downsample to 16 kHz -> window.api.sendPcm -> main 'pcm' handler ->
 * adapter.send(int16).
 *
 * ## Worklet loading -- verified against the INSTALLED toolchain
 * (electron-vite 5.0.0 / vite 7.3.6, 2026-08-20). Both candidate loaders were
 * built and the emitted renderer bundle inspected:
 *   1. `new URL('./pcm-processor.ts', import.meta.url)` (plan's suggestion):
 *      vite 7.3.6's asset-import-meta-url plugin INLINES the file as an
 *      uncompiled data URL -- the built bundle contains
 *      `new URL("data:video/mp2t;base64,<raw .ts source>", import.meta.url)`
 *      and NO pcm-processor asset is emitted. addModule would receive the raw
 *      TypeScript (with `declare` keywords -- a parse error in a JS engine) as
 *      an origin-opaque data: URL. Broken in production builds.
 *   2. `import url from './pcm-processor?worker&url'` -- vite's documented
 *      worker-URL form: the file is BUNDLED as a standalone compiled classic
 *      script (verified: out/renderer/assets/pcm-processor-<hash>.js contains
 *      the transpiled IIFE with `registerProcessor("pcm-processor", ...)` and
 *      the main chunk references it via
 *      `new URL("pcm-processor-<hash>.js", import.meta.url)`). addModule
 *      accepts it. Option 2 is used below.
 *
 * ## ScriptProcessorNode fallback
 * If addModule throws at runtime (dev server quirk, CSP, protocol), the capture
 * path degrades to a ScriptProcessorNode (deprecated API) so the pipeline still
 * runs; the mode is reported on the handle so callers can surface it.
 *
 * ## sampleRate: 16000 constraint + downsample
 * getUserMedia requests 16 kHz per the plan; Chrome treats it as a target and
 * many devices deliver 48k anyway, so the frame is ALWAYS resampled from the
 * actual context rate down to 16 kHz (shared downsample, linear) before IPC --
 * the adapter only ever sees 16 kHz.
 */
import { downsample } from '../../../shared/audio/format'
import pcmProcessorUrl from './pcm-processor?worker&url'

export type CaptureMode = 'audioworklet' | 'scriptprocessor'

export interface MicCaptureOptions {
  /** Device id from settings.audioDeviceId; null/undefined = system default. */
  deviceId?: string | null
  /** Called when the worklet fails to load and the fallback engages. */
  onFallback?: (mode: CaptureMode, err: Error) => void
}

export interface MicCaptureHandle {
  stop: () => Promise<void>
  /** Which processor ran: 'audioworklet' or the deprecated script fallback. */
  mode: CaptureMode
  /** The AudioContext's actual sample rate (what downsample resampled from). */
  contextSampleRate: number
}

export async function startMicCapture(opts: MicCaptureOptions = {}): Promise<MicCaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: 16000,
      echoCancellation: true,
      ...(opts.deviceId ? { deviceId: { exact: opts.deviceId } } : {})
    }
  })

  const ctx = new AudioContext()
  const source = ctx.createMediaStreamSource(stream)
  const sendChunk = (frame: Float32Array): void => {
    // Frame is at ctx.sampleRate; the adapter contract is 16 kHz mono int16.
    const chunk = downsample(frame, ctx.sampleRate, 16000)
    window.api.sendPcm(chunk)
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
    // fix the addModule URL (loader decision above) -- the fallback disappears
    // with the worklet loading, no API surface change.
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
