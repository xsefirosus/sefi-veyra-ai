<#
check-loopback.ps1 -- plan step 19 verification (Windows WASAPI loopback).

Platform pick (audit step 14): Windows can use this script OR the portable
`node scripts/check-loopback.mjs` (same flow, per-OS tone player); macOS/Linux
must use the .mjs. The macOS capture path itself is still PENDING -- see
docs/loopback-macos.md.

Flow:
  1. npm run build in app/ (the check runs the BUILT bundle: fast boot, no vite).
  2. Generate a 3 s 440 Hz tone WAV (16-bit mono PCM @ 16 kHz, pure PowerShell).
  3. Launch the built app with VEYRA_LOOPBACK_CHECK=1. The app's main window
     auto-starts loopback capture (getDisplayMedia -> AudioWorklet ->
     'pcm-loopback' IPC); main accumulates int16, computes full-scale RMS,
     writes state/loopback-check.json {energyCaptured, rms, samples,
     durationMs}, and quits (8 s capture window from the first chunk).
  4. Play the tone for 3 s with System.Media.SoundPlayer WHILE the app
     captures (WASAPI loopback captures the default-render-endpoint mix, so
     the SoundPlayer tone IS in the loopback stream).
  5. Assert the JSON: energyCaptured === true (RMS > 0.001, plan threshold).

Exit 0 on pass; 1 on fail. On any failure where the app never wrote the JSON,
the script records {energyCaptured: false, error: <why>} so the artifact
exists and the step is visibly REJECTED (never a faked pass).

The JSON is written by the APP with the REAL measured RMS; this script only
asserts it.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$appDir = Join-Path $repoRoot 'app'
$outPath = Join-Path $repoRoot 'state\loopback-check.json'
$tempDir = Join-Path $env:TEMP ('veyra-loopback-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempDir | Out-Null
$wavPath = Join-Path $tempDir 'tone-440.wav'

$proc = $null
$oldCheck = $env:VEYRA_LOOPBACK_CHECK
$oldOut = $env:VEYRA_LOOPBACK_CHECK_OUT
$exitCode = 1

function Write-FailureJson([string]$message) {
  if (-not (Test-Path -LiteralPath $outPath)) {
    $payload = @{ energyCaptured = $false; rms = 0; samples = 0; durationMs = 0; error = $message } | ConvertTo-Json
    try { [System.IO.File]::WriteAllText($outPath, $payload) } catch { Write-Host "WARN: could not write failure JSON: $_" }
  }
}

try {
  Write-Host 'check-loopback: building app...'
  Push-Location $appDir
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit $LASTEXITCODE)" }
  Pop-Location

  # --- 2. 3 s 440 Hz tone, 16-bit mono PCM @ 16 kHz, amplitude 0.25 ---
  Write-Host 'check-loopback: generating 440 Hz tone WAV...'
  $sampleRate = 16000
  $seconds = 3
  $freq = 440.0
  $amp = 0.25
  $sampleCount = $sampleRate * $seconds
  $dataBytes = $sampleCount * 2
  $fs = [System.IO.File]::Create($wavPath)
  $bw = New-Object System.IO.BinaryWriter($fs)
  try {
    $bw.Write([Text.Encoding]::ASCII.GetBytes('RIFF'))
    $bw.Write([int](36 + $dataBytes))
    $bw.Write([Text.Encoding]::ASCII.GetBytes('WAVE'))
    $bw.Write([Text.Encoding]::ASCII.GetBytes('fmt '))
    $bw.Write([int]16) # fmt chunk size
    $bw.Write([int16]1) # audio format: PCM
    $bw.Write([int16]1) # channels: mono
    $bw.Write([int]$sampleRate)
    $bw.Write([int]($sampleRate * 2)) # byte rate
    $bw.Write([int16]2) # block align
    $bw.Write([int16]16) # bits per sample
    $bw.Write([Text.Encoding]::ASCII.GetBytes('data'))
    $bw.Write([int]$dataBytes)
    for ($i = 0; $i -lt $sampleCount; $i++) {
      $sample = [int]([Math]::Round($amp * 32767 * [Math]::Sin(2 * [Math]::PI * $freq * $i / $sampleRate)))
      $bw.Write([int16]$sample)
    }
  } finally {
    $bw.Dispose()
    $fs.Dispose()
  }

  # --- 3. Launch the built app in check mode (env inherited by the child) ---
  Remove-Item -LiteralPath $outPath -ErrorAction SilentlyContinue
  $env:VEYRA_LOOPBACK_CHECK = '1'
  $env:VEYRA_LOOPBACK_CHECK_OUT = $outPath
  $electronCmd = Join-Path $appDir 'node_modules\.bin\electron.cmd'
  Write-Host 'check-loopback: launching app (VEYRA_LOOPBACK_CHECK=1)...'
  $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "`"$electronCmd`" ." `
    -WorkingDirectory $appDir -WindowStyle Hidden -PassThru

  # --- 4. Play the tone for 3 s WHILE the app captures loopback ---
  Start-Sleep -Seconds 2 # let the built app boot and getDisplayMedia resolve
  $player = New-Object System.Media.SoundPlayer($wavPath)
  $player.Play() # non-blocking: the 3 s tone plays in the background
  Start-Sleep -Seconds 4 # the app's 8 s capture window (from first chunk) covers it
  $player.Stop()
  $player.Dispose()

  # --- 5. Wait for the verdict JSON (the app quits itself after writing it) ---
  $deadline = (Get-Date).AddSeconds(60)
  while (-not (Test-Path -LiteralPath $outPath) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
  }
  if ($proc -and -not $proc.HasExited) {
    & taskkill.exe /PID $proc.Id /T /F 2>$null | Out-Null
    $proc = $null
  }

  # --- 6. Assert the REAL measured values ---
  if (-not (Test-Path -LiteralPath $outPath)) { throw 'state/loopback-check.json was not written' }
  $result = Get-Content -Raw -LiteralPath $outPath | ConvertFrom-Json
  Write-Host ("loopback check: energyCaptured={0} rms={1} samples={2} durationMs={3} error={4}" -f `
    $result.energyCaptured, $result.rms, $result.samples, $result.durationMs, $result.error)
  if ($result.energyCaptured -ne $true) { throw "loopback energy NOT captured (energyCaptured false, rms $($result.rms))" }
  if ([double]$result.rms -le 0.001) { throw "assert captured RMS > 0.001 failed (rms $($result.rms))" }
  $exitCode = 0
  Write-Host 'check-loopback: PASS'
} catch {
  Write-Host "check-loopback: FAIL: $($_.Exception.Message)"
  Write-FailureJson $_.Exception.Message
  $exitCode = 1
} finally {
  # Restore caller env, kill a lingering app tree, drop the temp tone.
  if ($null -eq $oldCheck) { Remove-Item Env:VEYRA_LOOPBACK_CHECK -ErrorAction SilentlyContinue }
  else { $env:VEYRA_LOOPBACK_CHECK = $oldCheck }
  if ($null -eq $oldOut) { Remove-Item Env:VEYRA_LOOPBACK_CHECK_OUT -ErrorAction SilentlyContinue }
  else { $env:VEYRA_LOOPBACK_CHECK_OUT = $oldOut }
  if ($proc -and -not $proc.HasExited) {
    & taskkill.exe /PID $proc.Id /T /F 2>$null | Out-Null
  }
  Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
}

exit $exitCode