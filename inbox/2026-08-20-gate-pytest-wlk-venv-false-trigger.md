---
status: approved
reason: gate-red
date: 2026-08-20
source: software-engineer dispatch (step 12)
---

# gate.sh red in app/ — Python branch false-triggers on app/.wlk-venv/**/*.py

Same class as the approved-and-patched node_modules case
(`inbox/2026-08-19-gate-pytest-node_modules-false-trigger.md`): the step-12 REQUIRED
venv `app/.wlk-venv` adds `.py` files to the tree, the gate's Python find (line 92)
matches them from `app/`, and `pytest -q` collects zero tests -> exit 5.

## Gate evidence (raw)

Gate command (run from `app/`, workdir `D:/Projects/Sefi-Veyra-AI/app`):
`/c/Users/Mary%20Rose/.config/opencode/scripts/gate.sh` via git bash.

Run 1 (before in-slice eslint fix) — `GATE_EXIT=5`:

```
FAIL: npm-lint (exit 1)   <- eslint scanning .wlk-venv JS (WhisperLiveKit web-UI strings)
      1   1627 problems (176 errors, 1451 warnings)
      1   915:3     error    Missing return type on function
      1   864:1     error    Missing return type on function
full log: .worktrees/logs/20260820-081232_npm-lint.log
ok: npm-typecheck
ok: npm-test
ok: ruff
FAIL: pytest (exit 5)
no tests ran in 0.04s
full log: .worktrees/logs/20260820-081259_pytest.log
gate: FAILED (exit 5)
```

Run 2 (after in-slice eslint fix, commit `f19b58a`-ish) — `GATE_EXIT=5`:

```
ok: npm-lint
ok: npm-typecheck
ok: npm-test
ok: ruff
FAIL: pytest (exit 5)
no tests ran in 0.04s
full log: .worktrees/logs/20260820-081449_pytest.log
gate: FAILED (exit 5)
```

## Root cause — gate.sh Python detector does not exclude the wlk venv

gate.sh line 92: `find . -name '*.py' -not -path './.git/*' -not -path './.worktrees/*'
-not -path './node_modules/*'` — depth-1 excludes only. Step 12 created the REQUIRED
venv `app/.wlk-venv` (plan-mandated, correctly gitignored at app/.gitignore:7, and
now eslint-ignored). Its `Lib/site-packages/**/*.py` match from `app/`, so the Python
branch triggers and runs globally-installed `pytest -q` (hermes venv on PATH) with zero
tests to collect in a TypeScript-only app -> exit 5. pytest exit 5 on "no tests ran" is
hardcoded pytest behavior; no pytest config can make it exit 0, and the app must not
gain fake Python tests.

## Fixed within this slice (not escalated)

npm-lint red (run 1) was a genuine in-slice defect: eslint flat config does not respect
.gitignore, so it scanned `.wlk-venv`'s JS. Fixed once in `app/eslint.config.mjs`
(`'**/.wlk-venv'` added to the ignores array) — same intent as the plan's gitignore
mandate ("never commit the venv" => never let it pollute tooling). Verified: npm-lint
passes after the fix. Committed separately.

## Not fixable within this slice

The remaining pytest exit 5 comes from harness gate.sh detection, which this slice must
not edit (shared tooling outside the repo; previous approval was for the node_modules
pattern only). Step-12's own criteria are all verified (README package/entry-point
confirmed, venv CLI `wlk --help` exit 0, .wlk-venv gitignored, install tail logged,
script committed) — but the gate did NOT pass, so this step is not green.

Human decision needed — mirror the 2026-08-19 approval:

- **(a)** extend gate.sh's Python find (line 92) with `-not -path './.wlk-venv/*'`
  (and, if the residual at the repo root is being fixed anyway, the general
  `*/node_modules/*` + `*/.wlk-venv/*` patterns), or
- **(b)** accept a documented exception for the wlk venv (all future Phase-2 steps
  gate from `app/` and will hit this every time while the venv exists).

## State

- Step-12 artifacts committed `3c470bd` (scripts/setup-wlk.ps1, app/.gitignore,
  state/wlk-install.log).
- eslint ignore fix committed separately (see git log).
- Plan checkbox marked `- [x]` and committed separately ("plan: mark step 12 ... complete").
- The gate remains RED (exit 5, pytest) — recorded here, not papered over.

## Approval (2026-08-20)

Human decision (user, recorded 2026-08-20): **"Extend fix class-wide"** — extends the
2026-08-19 approval. gate.sh line 92 Python find exclusions now cover any depth:
`-not -path '*/node_modules/*'` replaces `-not -path './node_modules/*'`, and
`-not -path '*/.wlk-venv/*'` added. Minimal edit — only the line-92 exclusion list.
Applied to BOTH copies, line endings preserved (active install LF, plugin cache CRLF):

- `C:/Users/Mary Rose/.config/opencode/scripts/gate.sh` (active install) — MD5
  `ECEE32243ABA50E3CC5B9274BA1A8AB5`
- `C:/Users/Mary Rose/.cache/opencode/sefi-agents/plugins/sefi-core/scripts/gate.sh`
  (plugin cache) — MD5 `A3C5A42EBB5FF41D036771AE983BA841`

Verification (via git bash, active-install copy):

- From `D:/Projects/Sefi-Veyra-AI/app` (has `.wlk-venv`, 10,103 .py files): **exit 0** —
  `ok: npm-lint`, `ok: npm-typecheck`, `ok: npm-test`, `gate: PASSED (3 checks)`; no
  ruff, no pytest (Python branch no longer triggers).
- From repo root `D:/Projects/Sefi-Veyra-AI`: **exit 0** — `gate: no known toolchain
  detected; nothing to run (pass)`; no pytest/ruff (root residual resolved;
  `app/node_modules` covered by `*/node_modules/*`).

gate.sh edits are outside the repo (shared install) and were not committed here; only
this inbox note was committed.