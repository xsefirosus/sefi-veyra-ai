/**
 * useCapture (plan step 4): reacts to session-state → listening (start mic with
 * settings.audioDeviceId skipping LOOPBACK_DEVICE_ID, start loopback) and
 * stopping/idle (stop both). Surfaces onFallback (scriptprocessor) mode so the
 * UI can show it.
 *
 * Seams under test:
 * - window.api.onSessionState subscription (listening vs stopping/idle)
 * - startMicCapture called with deviceId !== LOOPBACK_DEVICE_ID
 * - startLoopbackCapture called on listening
 * - stop() on both handles + track release on stopping/idle/error + unmount
 * - onFallback surface (mic + loopback scriptprocessor fallback)
 * - loopbackCheckMode preserved (no-op when window.api.loopbackCheckMode)
 */
import { useEffect, useRef, useState } from 'react'
import { LOOPBACK_DEVICE_ID, startLoopbackCapture } from './loopback-capture'
import type { LoopbackCaptureHandle } from './loopback-capture'
import { startMicCapture } from './mic-capture'
import type { CaptureMode, MicCaptureHandle } from './mic-capture'

export interface UseCaptureOptions {
  /** Device id from settings.audioDeviceId; null/undefined = system default. The LOOPBACK_DEVICE_ID sentinel must never reach getUserMedia. */
  audioDeviceId?: string | null
  /** Called when either track falls back to scriptprocessor; surfaced so UI can show it. */
  onFallback?: (info: { source: 'mic' | 'loopback'; mode: CaptureMode; error: Error }) => void
}

export interface UseCaptureState {
  /** Last mic fallback mode, if any */
  micMode: CaptureMode | null
  /** Last loopback fallback mode, if any */
  loopbackMode: CaptureMode | null
  /** Most recent fallback across both tracks */
  fallback: { source: 'mic' | 'loopback'; mode: CaptureMode; error: Error } | null
}

export function useCapture(options: UseCaptureOptions = {}): UseCaptureState {
  const { audioDeviceId, onFallback } = options
  const [micMode, setMicMode] = useState<CaptureMode | null>(null)
  const [loopbackMode, setLoopbackMode] = useState<CaptureMode | null>(null)
  const [fallback, setFallback] = useState<UseCaptureState['fallback']>(null)

  // Keep latest values in refs so the session-state callback always sees current
  // without re-subscribing.
  const audioDeviceIdRef = useRef<string | null | undefined>(audioDeviceId)
  const onFallbackRef = useRef<UseCaptureOptions['onFallback']>(onFallback)
  useEffect(() => {
    audioDeviceIdRef.current = audioDeviceId
  }, [audioDeviceId])
  useEffect(() => {
    onFallbackRef.current = onFallback
  }, [onFallback])

  const micHandleRef = useRef<MicCaptureHandle | null>(null)
  const loopHandleRef = useRef<LoopbackCaptureHandle | null>(null)
  const startingRef = useRef(false)

  useEffect(() => {
    // Keep loopbackCheckMode working: renderer auto-starts loopback capture
    // in that mode via App.tsx's dedicated effect; this hook must not interfere.
    if (window.api.loopbackCheckMode) return

    let cancelled = false
    let unsubscribe: (() => void) | null = null

    const handleFallback = (source: 'mic' | 'loopback', mode: CaptureMode, error: Error): void => {
      if (source === 'mic') setMicMode(mode)
      else setLoopbackMode(mode)
      const info = { source, mode, error }
      setFallback(info)
      onFallbackRef.current?.(info)
    }

    const stopAll = async (): Promise<void> => {
      const mic = micHandleRef.current
      const loop = loopHandleRef.current
      micHandleRef.current = null
      loopHandleRef.current = null
      startingRef.current = false
      const tasks: Promise<void>[] = []
      if (mic) tasks.push(mic.stop().catch((e) => console.error('[capture] mic stop failed:', e)))
      if (loop)
        tasks.push(loop.stop().catch((e) => console.error('[capture] loopback stop failed:', e)))
      if (tasks.length > 0) await Promise.all(tasks)
    }

    const startAll = async (): Promise<void> => {
      if (startingRef.current) return
      if (micHandleRef.current || loopHandleRef.current) return
      startingRef.current = true
      try {
        const rawId = audioDeviceIdRef.current
        // Sentinel must never reach getUserMedia
        const deviceId = rawId === LOOPBACK_DEVICE_ID ? undefined : (rawId ?? undefined)

        // Start mic first; if it fails, still attempt loopback? Sequential to avoid
        // concurrent getUserMedia/getDisplayMedia permission prompts competing.
        try {
          const micHandle = await startMicCapture({
            ...(deviceId ? { deviceId } : {}),
            onFallback: (mode, err) => handleFallback('mic', mode, err)
          })
          if (cancelled) {
            await micHandle.stop().catch(() => {})
          } else {
            micHandleRef.current = micHandle
          }
        } catch (err) {
          console.error(
            '[capture] startMicCapture failed:',
            err instanceof Error ? err.message : err
          )
        }

        if (cancelled) return

        try {
          const loopHandle = await startLoopbackCapture({
            onFallback: (mode, err) => handleFallback('loopback', mode, err)
          })
          if (cancelled) {
            await loopHandle.stop().catch(() => {})
          } else {
            loopHandleRef.current = loopHandle
          }
        } catch (err) {
          console.error(
            '[capture] startLoopbackCapture failed:',
            err instanceof Error ? err.message : err
          )
        }
      } finally {
        startingRef.current = false
      }
    }

    const onState = (payload: { state: string; lastError: string | null }): void => {
      const s = payload.state
      if (s === 'listening') {
        void startAll()
      } else if (s === 'stopping' || s === 'idle' || s === 'error') {
        void stopAll()
      }
    }

    // Subscribe to session-state broadcasts
    unsubscribe = window.api.onSessionState(onState)

    // Hydrate initial state in case we mounted while already listening
    void window.api
      .getSessionState()
      .then(onState)
      .catch(() => {})

    return () => {
      cancelled = true
      unsubscribe?.()
      void stopAll()
    }
  }, [])

  return { micMode, loopbackMode, fallback }
}

export default useCapture
