---
status: needs-human
reason: contract-violation
date: 2026-08-19
source: research-analyst dispatch
---

# Research-analyst digest exceeded per_agent_return_tokens twice — contract violation

## Gate evidence (raw)

Cap under test: `per_agent_return_tokens: 150` (`config/budget.yml` line 7).

Gate command:
`/c/Users/MARYRO~1/CONFIG~1/opencode/scripts/check-reply.sh /c/Users/MARYRO~1/CONFIG~1/opencode/agents/research-analyst.md -`

- Attempt 1 — first reply rejected at 512 words vs the 150 cap; `check-reply.sh` exit 1.
  Gate output quoted verbatim in the resend message: "reply is 512 words against a 150
  per_agent_return_tokens cap". Resent once per protocol (resend carried compression
  instructions).
- Attempt 2 — second reply rejected at 189 words vs 150; `check-reply.sh` exit 1.
- Both gate invocations are in `opencode.log` (run c7a5e7e2, 2026-08-19T09:47:22Z and
  09:48:02Z). Dispatch session: `ses_fe6973589ffeV5InHoj43uAlke` ("Research VEYRA P1-2
  unknowns (@research-analyst subagent)").
- Reproduction (rails, 2026-08-19): replayed both stored replies through the same gate
  command. The stored second reply gates at exactly 189 words, exit 1. A reconstruction of
  the first reply from the stored transcript parts gates at 539 words, exit 1 (the recorded
  value at dispatch time was 512; the exact piped bytes are not recoverable — either way
  the reply far exceeded the 150 cap, so the violation verdict is unchanged).

## Harness gap — the long form could not be persisted

research-analyst's contract allows writing the long form to the named state file
(`agents/research-analyst.md`: "Interactive: you may also write the long form to the named
state/ file if asked. Machine-invoked: emit only the digest above and write nothing beyond
that state file."). In this OpenCode harness that write is physically impossible:

- `disallowedTools: Write, Edit, MultiEdit` (agent frontmatter) removes every file-write tool.
- The bash permission block denies every write pattern (`*Set-Content*`, `*Out-File*`,
  `*New-Item*ItemType*File*`, `*[System.IO.File]*`, `cp *`, `mv *`, `* > *`, `* >> *`, ...).
- The attempt was denied live: `opencode.log` (run c7a5e7e2) line 124702 —
  `Set-Content -LiteralPath "D:\Projects\Sefi-Veyra-AI\state\research-veyra-p1p2.md" -Value $body -Encoding UTF8`
  → `action.action=deny`.
- `D:/Projects/Sefi-Veyra-AI/state/research-veyra-p1p2.md` was never written (absent from
  `state/`).

Human decision needed: relax the research-analyst return cap, grant it a write path for the
long form, or accept a tighter digest contract.

## Content preserved — governance, not blocking

The chain continues: the accepted 189-word digest was inlined into the product-manager
handoff, so no research content was lost. This item is a governance record of the contract
violation, not a blocker.

The accepted digest text, verbatim (word count verified by re-running the gate, exit 1):

```
FINDINGS:
- WhisperLiveKit is active (not stale): ~10.6k stars, Apache-2.0, latest release v0.2.23 (2026-07-09), merges through 2026-08-01.
- It runs as a Python `wlk` server (pip `whisperlivekit`) with a native WebSocket streaming API at `ws://host:port/asr` (PCM in → JSON partial/final out), plus Deepgram-compatible WS and OpenAI-compatible REST.
- Runs on Windows (cuDNN docs exist; native-GPU detect flaky); `--model tiny|base|small` configurable, faster-whisper/whisper backends.
- whisper.cpp ships prebuilt Windows binaries (v1.9.0: whisper-bin-x64, blas, cublas) with whisper-cli/stream/server; whisper-stream needs SDL2, whisper-server is HTTP request/response, not token-streaming WS.
- Loopback options: native N-API/WASAPI modules (application-loopback, native-audio-node, native-recorder-nodejs) or electron-audio-loopback (Electron ≥31, patches getDisplayMedia); mic via renderer getUserMedia or main-process native; macOS needs one-time BlackHole (`brew install blackhole-2ch`).
- Gemini: `streamGenerateContent` REST (SSE, x-goog-api-key) or `@google/genai` `generateContentStream()`; Node 20+, SDK 3.0 needs Node 22.
- better-sqlite3 needs native rebuild + asarUnpack; v13 is N-API. Use Electron safeStorage (Keychain/DPAPI) over archived keytar.
- Default 2026 starter: electron-vite + electron-builder (or electron-react-boilerplate) for React+TS.

SOURCES:
- https://github.com/QuentinFuxa/WhisperLiveKit
- https://github.com/ggml-org/whisper.cpp
- https://github.com/alectrocute/electron-audio-loopback
- https://ai.google.dev/api
- https://github.com/WiseLibs/better-sqlite3
- https://electronjs.org/docs/latest/api/safe-storage

UNKNOWNS:
- Whether whisper-server has a token-streaming WS endpoint (unconfirmed).
- Exact current stable Gemini model string (gemini-2.5-flash vs gemini-3.x).
```
