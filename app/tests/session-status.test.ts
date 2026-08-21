import { describe, expect, it } from 'vitest'
import {
  overlayEmptyLabel,
  sessionChipLabel,
  isListeningState,
  type SessionStatus
} from '../src/renderer/src/session/session-status'

describe('session-status (plan step 5)', () => {
  it('maps idle to Idle', () => {
    const s: SessionStatus = { state: 'idle', lastError: null }
    expect(sessionChipLabel(s)).toBe('Idle')
    expect(overlayEmptyLabel(s)).toBe('Idle \u2014 press Start listening')
  })

  it('maps starting to Starting model… with download hint', () => {
    const s: SessionStatus = { state: 'starting', lastError: null }
    const label = sessionChipLabel(s)
    expect(label).toContain('Starting model')
    // Must mention download/minutes so user knows first run takes minutes
    expect(label.toLowerCase()).toMatch(/download|minutes/)
    expect(overlayEmptyLabel(s)).toBe(label)
  })

  it('maps listening to Listening', () => {
    const s: SessionStatus = { state: 'listening', lastError: null }
    expect(sessionChipLabel(s)).toBe('Listening')
    expect(overlayEmptyLabel(s)).toBe('Listening\u2026')
  })

  it('maps stopping to Stopping', () => {
    const s: SessionStatus = { state: 'stopping', lastError: null }
    expect(sessionChipLabel(s)).toContain('Stopping')
  })

  it('maps error with message to Error: <message>', () => {
    const s: SessionStatus = { state: 'error', lastError: 'wlk spawn failed' }
    expect(sessionChipLabel(s)).toBe('Error: wlk spawn failed')
    expect(overlayEmptyLabel(s)).toBe('Error: wlk spawn failed')
  })

  it('maps error without message to bare Error', () => {
    const s: SessionStatus = { state: 'error', lastError: null }
    expect(sessionChipLabel(s)).toBe('Error')
  })

  it('unknown state falls back to Idle', () => {
    const s: SessionStatus = { state: 'unknown-state', lastError: null }
    expect(sessionChipLabel(s)).toBe('Idle')
    expect(overlayEmptyLabel(s)).toContain('Idle')
  })

  it('isListeningState true for listening and starting', () => {
    expect(isListeningState('listening')).toBe(true)
    expect(isListeningState('starting')).toBe(true)
    expect(isListeningState('idle')).toBe(false)
    expect(isListeningState('error')).toBe(false)
  })

  it('error label preserves full error text including colon', () => {
    const s: SessionStatus = { state: 'error', lastError: 'Error: spawn ENOENT' }
    expect(sessionChipLabel(s)).toBe('Error: Error: spawn ENOENT')
  })
})
