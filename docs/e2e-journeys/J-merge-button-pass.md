---
id: J-merge-button-pass
category: gate-merge
status: draft
last_reviewed: 2026-06-06
---

# Operator runs the promotion gate and main is promoted on green

## What the user is trying to accomplish

Philipp reviews the accumulated work on `dev` (commits ahead of `main`, the RR — regression risk — score in the Branch Topology panel), decides the moment is right, and clicks **RUN GATE & MERGE TO MAIN**. The dashboard dispatches `promote.yml` on GitHub; the workflow re-runs the full regression suite against `dev` on a clean runner and fast-forwards `main` to the tested SHA only if the suite is green. Nothing auto-promotes — Philipp decides *when* the gate runs; the suite decides *whether* main advances.

## Preconditions

- One or more slices have landed on `origin/dev` (commits ahead of `main` is non-zero)
- `ci.yml` has run on the latest `dev` push (per-push feedback; not required to be green for dispatch, but Philipp will normally look at it)
- The Branch Topology panel shows the RR score (computed from commits ahead, churn, and critical-path files touched) and the **RUN GATE & MERGE TO MAIN** button is enabled
- No `promote.yml` run is currently in progress (a running gate disables/guards the button)
- The dashboard server (`dashboard/server.js`) has working GitHub credentials to dispatch workflows (`gh` CLI or token)
- `main` is an ancestor of `dev` (fast-forward is possible)

## Steps

1. Philipp opens the Ops dashboard and reads the Branch Topology panel: commits ahead of `main`, churn, critical-path files touched, and the resulting RR score
2. Philipp judges the risk acceptable and clicks **RUN GATE & MERGE TO MAIN**
3. The dashboard POSTs `/api/promote/dispatch` to `dashboard/server.js`
4. The server dispatches `promote.yml` via `workflow_dispatch` against `dev` and returns the run reference; the strip shows a promote row in "running" state with a deep link to the Actions run
5. On the GitHub runner, `promote.yml` checks out `dev` and re-runs the **full** regression suite (`node --test 'regression/**/*.test.js'`)
6. The suite is green
7. `promote.yml` fast-forwards `main` to the exact `dev` SHA that was just tested and pushes `origin/main`
8. The dashboard picks up the completed run: the strip promote row shows ✓, the Branch Topology graph's `main` dot advances to the promoted SHA, and the RR score returns to clean (zero commits ahead)

## Expected outcomes

- `origin/main` tip equals the `dev` SHA the suite ran against — main never receives an untested commit
- The promotion is a fast-forward: no merge commit, no divergence between `dev` and `main`
- The `promote.yml` Actions run is the audit record: dispatched by operator, suite log, ff push — all visible on GitHub
- Strip promote row shows ✓ with a link to the run
- Branch Topology: `main` dot advances; commits-ahead returns to 0; RR returns to clean/baseline
- **RUN GATE & MERGE TO MAIN** button returns to its idle/enabled state (nothing to promote until new commits land on `dev`)
- No local gate machinery is involved: no `gate-running.json` mutex, no `branch-state.json` `GATE_RUNNING` transition, no step cards, no local `mergeDevToMain`

## Known failure modes

- **Regression suite is red on the runner.** `promote.yml` stops before the ff step — `main` is untouched. The strip shows the promote row as gate failed with a deep link to the failing Actions run. *Recovery:* see J-gate-fail-retry.
- **Dispatch fails (gh/auth).** `POST /api/promote/dispatch` errors because the server's GitHub credentials are missing/expired or the `gh` invocation fails. No workflow run is created; `main` and `dev` are untouched. *Recovery:* fix credentials on the dashboard host, retry the button.
- **Main has diverged (non-ff).** Someone pushed to `main` outside the gate; the fast-forward push is rejected and `promote.yml` fails *after* a green suite without advancing `main`. *Recovery:* reconcile `main` vs `dev` manually (rebase/realign), then re-run the gate.
- **Double-press.** Philipp clicks the button while a promote run is already in flight; the server responds `409 gate_already_running` and does not dispatch a second run. The strip continues showing the in-flight run. *Recovery:* none needed — wait for the running gate to finish.

## Sources

- `.github/workflows/promote.yml` — workflow_dispatch trigger, full-suite re-run against dev, ff-only push to main
- `.github/workflows/ci.yml` — per-push regression run on dev (feedback only; not the promotion gate)
- `dashboard/server.js` — `/api/promote/dispatch` endpoint, 409 guard, GitHub dispatch mechanics
- `dashboard/lcars-dashboard.html` — Branch Topology panel, RR score, RUN GATE & MERGE TO MAIN button, strip promote row
- `docs/adr/ADR-GITHUB-CI-MERGE-MODEL.md` — merge model decision + the operator-gated promotion amendment

## Open questions

- RR score formula weighting: how are commits ahead, churn, and critical-path files combined, and what threshold (if any) renders the RR pill in a warning state? Is the critical-path file list hard-coded or configurable?
- Does the dashboard poll the Actions API for run completion, or does it rely on a webhook/refresh? What is the latency between the ff push and the `main` dot advancing?
- After a `409 gate_already_running`, does the UI surface the conflict to the operator (toast/inline message) or silently keep showing the in-flight row?
- Should the button be hard-disabled when commits-ahead is 0 (nothing to promote), or is dispatching a no-op gate run permitted?
- Is the dispatched run pinned to the `dev` SHA at dispatch time, or does the runner check out `dev` HEAD (meaning a slice landing mid-gate would be included in the tested-and-promoted set)?
