# Loop: morning-triage
managed-by: sefi-agents

agentic-signals: goal_intake, refusal_gate, verification, loop_discipline, close_out
requires-tools: git, gh, rg
<!-- probed by scripts/probe-tools.sh --loop before the Discovery move runs. gh reads CI status and issues in the Discovery move; without it discovery degrades to commits + prior state only, and says so. -->

## Trigger (SCHEDULING)
cloud: cron `0 6 * * *` via `.github/workflows/triage.yml`   |   local: daily 06:00 interval invoking the headless agent

## Discovery
skill: loop-engineering (discovery move)   agent: support-engineer   inputs read: failed CI, issues in the last 24h, commits since the last run, and the prior `state/triage.md`. Judge each finding's actionability; drop the noise.

## Handoff
one worktree per kept finding: branch `triage/<slug>` under `.worktrees/`   max parallel: 3 (from `config/budget.yml` max_parallel_worktrees). Each dispatched task names its absolute worktree output path. Before opening it, grep other `state/*.md` for a matching `acting_on`; skip and log if already claimed.

## Verification
generator: software-engineer   evaluator: qa-engineer (different model where possible)
stop condition: the plan's numbered-checkbox list is fully checked AND the qa-engineer PASSes against the plan's `## Done Criteria` (executed, judged separately from the generator).

## Persistence
state file: `state/triage.md` (committed, carries the 6-field resume block; one row per finding)
metrics: append one row per qa-engineer verdict to `state/metrics.md` (target-path keyed)
outputs: PRs + `inbox/` for uncertainty
close_out: dispatch the knowledge-manager to file this cycle's durable observations to `memory/daily/` (privacy-filtered, tier: trace), or log SKIP with a reason -- never neither. Rule: `skills/sefi-orchestration/references/close-out.md`

## Budget (from config/budget.yml)
per-run cap: $0.50   daily cap: $2.00   max retries: 2

## Cost Profile
| Scenario | Est. tokens | Notes |
|---|---|---|
| no-op | UNKNOWN | no run history yet; fill from state/metrics.md after the first week |
| report only | UNKNOWN | |
| full fix attempt | UNKNOWN | |

## Human checkpoint
PRs are opened, never merged. Anything below the qa-engineer's confidence bar goes to `inbox/`.
See `skills/sefi-orchestration/references/human-checkpoint.md` for the full rule and why.
