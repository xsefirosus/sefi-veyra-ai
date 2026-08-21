# scripts/setup-wlk.ps1 -- step 12: install the local STT server (WhisperLiveKit) into app/.wlk-venv
#
# Platform pick (audit step 14): Windows can use this script OR the portable
# `node scripts/setup-wlk.mjs` (same flow); macOS/Linux must use the .mjs.
#
# README verification (https://github.com/QuentinFuxa/WhisperLiveKit, read 2026-08-20 before
# writing this script; raw fetch HTTP 200, 29933 bytes):
#   - pip package name:  whisperlivekit   (README "Installation & Quick Start": `pip install whisperlivekit`;
#                                          PyPI badge links https://pypi.org/project/whisperlivekit/)
#   - CLI entry point:   wlk              (README "Quick Start": `wlk --model base --language en`;
#                                          on Windows pip installs console scripts as Scripts\wlk.exe)
#   - Python support: 3.11-3.13 (README badge) -- this machine: 3.11.15 (state/env-probe.md)
#   - Discrepancy vs plan research digest (recorded in state/wlk-install.log): the README's default
#     server port is 8000 (`--port` default `8000`; `ws://localhost:8000/asr`), not 9090 as the
#     plan digest assumed. Step 13 must confirm host/port flag names from `wlk --help` itself.
#
# Idempotent: re-running skips venv creation; pip's download cache makes a re-install cheap.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot          # repo root
$venv = Join-Path $root 'app\.wlk-venv'
$venvPython = Join-Path $venv 'Scripts\python.exe'
$venvPip = Join-Path $venv 'Scripts\pip.exe'
$wlk = Join-Path $venv 'Scripts\wlk.exe'

if (-not (Test-Path -LiteralPath $venvPython)) {
    Write-Host "==> python -m venv $venv"
    & python -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw "python -m venv failed (exit $LASTEXITCODE)" }
} else {
    Write-Host "==> venv already exists at $venv (skipping creation)"
}

# Fresh-venv pip on 3.11 is 23.x; upgrade first -- the old resolver mis-resolves torch on
# Windows (double download / wrong CUDA variant). Cheap insurance before the multi-GB install.
# NOTE: must run as `python -m pip`, never `pip.exe` -- pip refuses to self-modify its own
# console-script exe on Windows ("To modify pip, please run the following command").
# NOTE: `2>&1` on every native call -- under $ErrorActionPreference='Stop', PS 5.1 turns native
# stderr into a terminating NativeCommandError; merging streams keeps $LASTEXITCODE authoritative.
Write-Host "==> upgrading pip in venv"
& $venvPython -m pip install --upgrade pip 2>&1
if ($LASTEXITCODE -ne 0) { throw "pip self-upgrade failed (exit $LASTEXITCODE)" }

Write-Host "==> pip install whisperlivekit (torch/faster-whisper is GBs -- long wall-clock)"
& $venvPython -m pip install whisperlivekit 2>&1
if ($LASTEXITCODE -ne 0) { throw "pip install whisperlivekit failed (exit $LASTEXITCODE)" }

Write-Host "==> verifying venv CLI: $wlk --help"
& $wlk --help 2>&1
if ($LASTEXITCODE -ne 0) { throw "wlk --help failed (exit $LASTEXITCODE)" }

Write-Host "OK: whisperlivekit installed into $venv; CLI wlk responds to --help"