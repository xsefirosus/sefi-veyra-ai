# synth-speech.ps1 -- plan step 14: synthesize the wlk probe audio offline.
#
# Uses the Windows built-in SAPI (System.Speech) -- no network, no TTS download.
# Writes app/assets/test-speech.wav as 16 kHz, 16-bit, mono PCM (the exact format
# the WhisperLiveKit /asr WebSocket consumes), speaking the fixed probe sentence:
#   "Testing one two three. This is the Veyra meeting transcription test."
#
# The plan's speech is fixed text and a fixed format
# (SpeechAudioFormatInfo(16000, Sixteen, Mono)) -- do not edit either without
# changing the probe expectations in scripts/probe-wlk.mjs.

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$wavDir   = Join-Path $repoRoot 'app\assets'
$wavPath  = Join-Path $wavDir 'test-speech.wav'

if (-not (Test-Path $wavDir)) {
    New-Item -ItemType Directory -Path $wavDir -Force | Out-Null
    Write-Host "==> created $wavDir"
}

Add-Type -AssemblyName System.Speech

$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
    16000,
    [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono
)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $synth.SetOutputToWaveFile($wavPath, $format)
    $synth.Speak('Testing one two three. This is the Veyra meeting transcription test.')
} finally {
    $synth.Dispose()
}

if (-not (Test-Path $wavPath)) {
    throw "synthesis produced no file at $wavPath"
}

$file = Get-Item $wavPath
Write-Host "OK: $wavPath ($($file.Length) bytes)"