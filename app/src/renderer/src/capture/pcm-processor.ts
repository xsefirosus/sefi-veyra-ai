/**
 * AudioWorklet processor (plan step 17). Runs in the AudioWorkletGlobalScope:
 * reads input channel 0 and posts each Float32Array frame to the renderer main
 * thread via this.port.postMessage (structured clone copies the frame).
 * mic-capture.ts downsamples the frame to 16 kHz and ships it to main via
 * window.api.sendPcm.
 *
 * Deliberately dependency-free (no imports): the file must stay a standalone
 * script so it loads correctly under ANY worklet-bundling mode (Vite worker
 * URL, dev asset transform, or raw file URL). Keep it that way.
 *
 * The two ambient declarations below are the AudioWorkletGlobalScope globals;
 * TypeScript's lib.dom does not declare them (they live in the worklet scope,
 * not the window scope) -- verified against typescript 5.9.3 lib.dom.d.ts
 * (only AudioWorkletNode/MessagePort are declared there). No @types/audioworklet
 * dependency is needed for these two minimal shapes.
 */
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void
class PcmProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0]
    if (input && input.length > 0) this.port.postMessage(input)
    return true // keep the processor alive for the whole stream
  }
}

registerProcessor('pcm-processor', PcmProcessor)
