import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Seam under test (pre-agreed, plan step 18): the REAL preload (index.ts)
 * exposed via contextBridge -- window.api gains onTranscriptEvent(cb) and
 * windowRole, with onTranscriptEvent bound to ipcRenderer.on on the shared
 * 'transcript-event' channel.
 */

const mockExposeInMainWorld = vi.fn()
const mockIpcOn = vi.fn()
const mockIpcRemoveListener = vi.fn()

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: mockExposeInMainWorld
  },
  ipcRenderer: {
    on: mockIpcOn,
    removeListener: mockIpcRemoveListener
  }
}))

// The real @electron-toolkit/preload ESM entry named-imports from 'electron'
// (externalized in vitest -> the REAL electron CJS stub, which has no named
// exports). Mock it too so the preload under test never loads it; the api
// object only passes electronAPI through to contextBridge.
vi.mock('@electron-toolkit/preload', () => ({
  electronAPI: { ipcRenderer: mockIpcOn }
}))

interface Api {
  onTranscriptEvent: (cb: (event: unknown) => void) => () => void
  windowRole: string
}

let api: Api

beforeAll(async () => {
  // contextIsolation is ON in the real app (windows.ts); the preload branches
  // on process.contextIsolated at module load, so set it before importing.
  ;(process as { contextIsolated?: boolean }).contextIsolated = true
  await import('../src/preload/index')
  const call = mockExposeInMainWorld.mock.calls.find(([name]) => name === 'api')
  if (!call) throw new Error('contextBridge.exposeInMainWorld("api", ...) was never called')
  api = call[1] as Api
})

describe('preload transcript bridge (plan step 18)', () => {
  beforeEach(() => {
    mockIpcOn.mockClear()
    mockIpcRemoveListener.mockClear()
  })

  it('exposes onTranscriptEvent and windowRole on window.api', () => {
    expect(typeof api.onTranscriptEvent).toBe('function')
    expect(['main', 'overlay']).toContain(api.windowRole)
  })

  it('onTranscriptEvent subscribes to the transcript-event channel and unsubscribes', () => {
    const cb = vi.fn()
    const unsubscribe = api.onTranscriptEvent(cb)

    expect(mockIpcOn).toHaveBeenCalledWith('transcript-event', expect.any(Function))
    const listener = mockIpcOn.mock.calls[0][1] as (event: unknown, payload: unknown) => void

    const event = { source: 'mic', kind: 'partial', text: 'hi', seq: 0, ts: 1 }
    listener({}, event)
    expect(cb).toHaveBeenCalledWith(event)

    unsubscribe()
    expect(mockIpcRemoveListener).toHaveBeenCalledWith('transcript-event', listener)
  })
})
