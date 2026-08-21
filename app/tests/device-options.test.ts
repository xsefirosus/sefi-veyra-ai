/**
 * Plan step 16(e) (plan-veyra-audit-01.md): enumerateDevices() returns EMPTY
 * labels until microphone permission is granted, so the device <select> showed
 * raw deviceId hashes.
 *
 * Seams under test (agreed before first test):
 *   deviceOptions -> pure mapping of enumerateDevices() audioinput results to
 *   select options: friendly "Microphone N" placeholders while labels are
 *   withheld, real labels once granted, plus the fixed System default and the
 *   System audio (loopback) sentinel entries. The permission-change
 *   re-enumeration wiring lives in SettingsScreen (build + step-18 live pass).
 */
import { describe, expect, it } from 'vitest'
import { deviceOptions } from '../src/renderer/src/settings/device-options'
import { LOOPBACK_DEVICE_ID } from '../src/renderer/src/capture/loopback-capture'

describe('step 16e: deviceOptions mapping', () => {
  it('always offers System default first and the loopback sentinel last', () => {
    const options = deviceOptions([])
    expect(options).toEqual([
      { deviceId: null, label: 'System default' },
      { deviceId: LOOPBACK_DEVICE_ID, label: 'System audio (loopback)' }
    ])
  })

  it('replaces withheld labels with Microphone N instead of the raw deviceId hash', () => {
    const options = deviceOptions([
      { deviceId: 'a1b2c3d4e5f6...', label: '' },
      { deviceId: 'f6e5d4c3b2a1...', label: '' }
    ])
    const middle = options.slice(1, -1)
    expect(middle).toEqual([
      { deviceId: 'a1b2c3d4e5f6...', label: 'Microphone 1' },
      { deviceId: 'f6e5d4c3b2a1...', label: 'Microphone 2' }
    ])
    // The hash stays as the hidden <option value>; it never becomes a label.
    expect(options.every((o) => !o.label.includes('a1b2c3d4e5f6'))).toBe(true)
  })

  it('keeps real labels once permission granted (post-getUserMedia enumeration)', () => {
    const options = deviceOptions([
      { deviceId: 'default-device', label: 'MacBook Pro Microphone' },
      { deviceId: 'usb-device', label: 'Shure MV7' }
    ])
    expect(options.map((o) => o.label)).toEqual([
      'System default',
      'MacBook Pro Microphone',
      'Shure MV7',
      'System audio (loopback)'
    ])
  })

  it('numbers devices consistently across the labeled/unlabeled mix', () => {
    const options = deviceOptions([
      { deviceId: 'd1', label: '' },
      { deviceId: 'd2', label: 'Named mic' },
      { deviceId: 'd3', label: '' }
    ])
    expect(options.map((o) => o.label)).toEqual([
      'System default',
      'Microphone 1',
      'Named mic',
      'Microphone 3',
      'System audio (loopback)'
    ])
  })
})
