# Retro ledger -- what self-improvement actually did

Machine bookkeeping. Append-only, one row per retro decision. Written by the retro loop at
EDIT TIME, never reconstructed afterwards: the `before` value and the motivating evidence
only exist at the moment the edit is made, and a retro run that fires before this file
exists is permanently un-analyzable.

Keyed by `target-path` -- the same keyspace as `state/metrics.md`, which is the same path
`retro-improve` edits. One keyspace by construction, so a row here joins to a verdict there
without a mapping table.

<!-- status: applied | proposed | rejected | pending-evidence | reverted | skip -->
<!-- commit: the SHA of the applied edit. This is what makes an edit undoable: `git revert <sha>`. -->
<!-- before/after: PASS rate for target-path from state/metrics.md, as passes/verdicts. -->

| date | target-path | status | commit | evidence | before | after |
|------|-------------|--------|--------|----------|--------|-------|

## How this file is read (before proposing anything)

`retro-improve` reads its own ledger BEFORE selecting a target, and applies three rules.
Without them the loop has no memory of its own edits: it can re-edit the same file every
week, or re-propose something a human already rejected, and nothing notices.

1. **Churn guard.** A target-path with an `applied` row in either of the last 2 retro runs
   is not eligible again this run. Pick the next-worst performer and note the skip. Two
   writers oscillating on one file is the failure the single-writer rule prevents; one
   writer oscillating with itself is not covered by it.
2. **Rejection memory.** A proposal a human marked `rejected` is not re-proposed. If the
   same failure evidence recurs, escalate to `inbox/` once, citing the prior rejection row
   -- never quietly retry the same edit.
3. **Evidence debt.** A target with a `pending-evidence` row is not eligible for a new
   edit until that row is evaluated. Editing a file whose last edit was never graded
   compounds an unmeasured change with another unmeasured change.

## Revert rule (threshold fixed before any data existed)

Stated now, deliberately, while `state/metrics.md` is empty. A threshold written after the
numbers arrive is a threshold fitted to them -- the same discipline
`docs/METRICS-PROVENANCE.md` applies to every figure this repo cites.

- **Evaluation window:** the first 5 qa-engineer verdicts recorded against that
  `target-path` after the edit's commit date.
- **Minimum data:** 3 verdicts. Below that the row stays `pending-evidence` and is never
  evaluated. A 1-of-1 REJECT is not a regression signal; it is one data point.
- **Regression:** PASS rate inside the window is strictly lower than the PASS rate of the
  5 verdicts preceding the commit.
- **Action:** write a revert proposal to `inbox/` naming the exact command
  (`git revert <commit>`), the before/after rates, and the row. Set status `proposed`.
- **Never automatic.** A revert is a commit, and `human-checkpoint.md` is unconditional.
  The loop may not apply its own revert even though `git revert` is the safest action it
  could take -- correlation is not causation, and at these sample sizes an unlucky week
  would revert a good edit.

A `reverted` row is appended when a human applies the proposal; the original `applied` row
is left exactly as written. Same append-only correction the vault uses for a superseded
note -- the history stays honest about what was tried.
