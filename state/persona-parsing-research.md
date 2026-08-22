# Persona parsing research — Phase 3 Step 1 (2026-08-22)

Verified against live npm registry on 2026-08-22 (versions/dates are registry truth, not memory). Criteria: pure-JS, no node-gyp / prebuilt-binary dependency, no native rebuild required in app/ (same bar better-sqlite3 failed in audit-01). .txt and .md need no library — read directly via fs.readFile.

## Recommendation (GO for steps 7-8)

- **PDF: unpdf@1.8.1 (wraps pdfjs-dist@6.2.108) — PRIMARY.** Use unpdf extractText API. Fallback/direct alternative is pdfjs-dist@6.2.108 itself.
- **DOCX: mammoth@1.12.1 — PRIMARY.** Use mammoth.extractRawText.
- **Rejected: pdf-parse@2.4.5 — has required native dep @napi-rs/canvas, fails pure-JS gate.**

## Packages verified

### 1. mammoth — DOCX to text

- **Package:** mammoth
- **Version checked (latest):** 1.12.1 (npm dist-tag latest)
- **Registry last publish:** 2026-08-09T14:13:02.962Z (~13 days ago) — actively maintained; prior 1.12.0 on 2026-03-12
- **License:** BSD-2-Clause (npm view mammoth license)
- **Pure-JS confirmed:** YES — dependencies are all JS: lop, jszip, argparse, bluebird, base64-js, underscore, xmlbuilder, @xmldom/xmldom, path-is-absolute, dingbat-to-unicode; scripts are test/prepare/pretest/check-typescript with no install or native build, no gyp, no prebuild, no binary field
- **Engines:** node >=12.0.0
- **Source:** https://github.com/mwilliamson/mammoth.js — npm https://www.npmjs.com/package/mammoth
- **Install for app/:** npm install mammoth@1.12.1 inside app/
- **API note:** extractRawText({buffer}) returns {value: string} — pure JS unzip plus XML parse, no canvas.

### 2. pdfjs-dist — PDF to text (underlying engine)

- **Package:** pdfjs-dist
- **Version checked (latest):** 6.2.108
- **Registry last publish:** 2026-07-28T19:51:33.809Z (~25 days ago); cadence monthly — 6.1.200 on 2026-06-27, 6.0.227 on 2026-05-30 — actively maintained by Mozilla
- **License:** Apache-2.0
- **Pure-JS confirmed:** YES — scripts is empty object (no install hook), no gyp or prebuild, optionalDependencies only contains @napi-rs/canvas ^1.0.0 marked optional and canvas false flag. Text extraction via getDocument + getTextContent does NOT require canvas; canvas only for rendering.
- **Engines:** node >=22.13.0 or >=24 (matches Electron 39 which ships Node 22 — OK)
- **Source:** https://github.com/mozilla/pdf.js — homepage https://mozilla.github.io/pdf.js/

### 3. unpdf — PDF to text (ergonomic wrapper over pdfjs-dist)

- **Package:** unpdf
- **Version checked (latest):** 1.8.1
- **Registry last publish:** 2026-08-13T20:46:23.155Z (~9 days ago) — very active; 1.8.0 same week, 1.7.0 on 2026-07-24 — under unjs org
- **License:** MIT
- **Pure-JS confirmed:** YES — no dependencies field (bundled pdfjs-dist at build time via tsdown/rolldown), peerDependencies is @napi-rs/canvas with peerDependenciesMeta optional true. No install script requiring native build; scripts are dev/lint/test/build only. Text path needs no canvas.
- **Engines:** node >=22
- **Source:** https://github.com/unjs/unpdf
- **Install for app/:** npm install unpdf@1.8.1 inside app/ — same Node requirement as pdfjs-dist.
- **Why recommended over raw pdfjs-dist:** single call extractText(buffer) with no worker config; already handles pdfjs-dist bundling. Tradeoff is extra abstraction layer vs direct pdfjs-dist.

## Rejected / not recommended

### pdf-parse@2.4.5

- **Latest:** 2.4.5 published 2025-10-20T17:35:03.325Z
- **License:** Apache-2.0
- **Why rejected:** dependencies include pdfjs-dist 5.4.296 and @napi-rs/canvas 0.1.80 — canvas is a REQUIRED dependency, not optional. @napi-rs/canvas is a Rust NAPI addon with prebuilt binaries and napi build scripts. Violates hard gate no native rebuild or prebuilt-binary — same class as better-sqlite3 failure.
- **Engines:** node >=20.16.0 <21 or >=22.3.0

## Alternatives considered and not needed

- **WASM-based parsers:** Acceptable per plan if no pure-JS option exists, but both PDF and DOCX have clean pure-JS options above, so WASM tradeoff not needed. Documented as fallback only.
- **docx, docx-preview, docx4js, jszip alone, word-extractor:** docx is generator not parser, docx-preview 0.4.0 (2026-07-07) is browser rendering only, docx4js heavier, word-extractor targets legacy .doc not .docx. None beat mammoth for simple .docx text extraction.

## Verification commands run (2026-08-22)

- npm view mammoth version -> 1.12.1
- npm view mammoth time -> 1.12.1 at 2026-08-09
- npm view mammoth license -> BSD-2-Clause
- npm view pdfjs-dist version -> 6.2.108
- npm view pdfjs-dist time -> 6.2.108 at 2026-07-28
- npm view unpdf version -> 1.8.1
- npm view unpdf time -> 1.8.1 at 2026-08-13
- npm view pdf-parse dependencies -> required @napi-rs/canvas 0.1.80

## Gate decision

PASS — clean pure-JS options exist for both formats: mammoth for .docx and unpdf (or pdfjs-dist) for .pdf. No WASM fallback needed. .txt and .md confirmed need no library.
