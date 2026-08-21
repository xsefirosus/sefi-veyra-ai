/**
 * Plan step 16(e): friendly audio-device select options.
 *
 * enumerateDevices() returns EMPTY labels until microphone permission is
 * granted, and the old mapping fell back to the raw deviceId hash -- useless
 * hashes in the <select>. While labels are withheld we show "Microphone N"
 * instead; once permission is granted (SettingsScreen re-enumerates on the
 * permission change) the real labels flow through unchanged.
 */
import { LOOPBACK_DEVICE_ID } from '../capture/loopback-capture'

export interface AudioDeviceOption {
  deviceId: string | null
  label: string
}

export function deviceOptions(inputs: { deviceId: string; label: string }[]): AudioDeviceOption[] {
  return [
    { deviceId: null, label: 'System default' },
    ...inputs.map((d, i) => ({
      deviceId: d.deviceId,
      // Label withheld pre-permission: a stable placeholder beats a raw hash.
      label: d.label !== '' ? d.label : `Microphone ${i + 1}`
    })),
    // The virtual second track is NOT an audioinput device; it must never
    // reach getUserMedia (LOOPBACK_DEVICE_ID sentinel, mic path treats it as
    // absent).
    { deviceId: LOOPBACK_DEVICE_ID, label: 'System audio (loopback)' }
  ]
}
