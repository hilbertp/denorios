---
id: J-gate-fail-retry
category: gate-merge
status: draft
last_reviewed: 2026-06-06
---

# Gate fails on the runner, operator commissions a fix and retries

## What the user is trying to accomplish

Philipp presses **RUN GATE & MERGE TO MAIN**; `promote.yml` re-runs the regression suite against `dev` on the GitHub runner and a test fails. `main` is not advanced — that is the gate doing its job. Philipp follows the deep link to the failing Actions run, reads which test failed, commissions a fix slice through the normal pipeline, watches the fix land green on `dev` (`ci.yml`), and presses the button again. The second gate run is green and `main` is promoted.

## Preconditions

- Commits are ahead on `origin/dev`; the Branch Topology panel shows a non-zero RR score
- A defect on `dev` violates at least one journey/AC covered by the regression suite (the suite will genuinely fail on a clean runner)
- The dashboard can dispatch `promote.yml` (`/api/promote/dispatch` works; gh/auth healthy)
- No promote run currently in flight

## Steps

1. Philipp clicks **RUN GATE & MERGE TO MAIN**; the dashboard POSTs `/api/promote/dispatch` and `promote.yml` is dispatched against `dev`
2. The runner checks out `dev` and runs the full regression suite
3. A test fails (e.g. `slice-247-ac-2: queue-reorder persists order atomically`); `promote.yml` exits red **before** the fast-forward step
4. `main` is NOT advanced — its tip is unchanged; `dev` is also untouched by the gate
5. The strip promote row shows gate failed with a deep link to the Actions run; the RR score and commits-ahead remain as they were
6. Philipp opens the Actions run via the deep link and reads the failing test output: which `slice-<id>-ac-<index>` / `J-*` test failed and the assertion message
7. Philipp commissions a fix slice through the normal pipeline (O'Brien drafts, Philipp approves, Rom implements, Nog reviews)
8. The fix slice lands on `dev`; `ci.yml` runs on the push and comes back green (per-push feedback that the failing test now passes)
9. Philipp presses **RUN GATE & MERGE TO MAIN** again
10. `promote.yml` is dispatched, the full suite runs on the runner — including the previously failing test — and is green
11. `promote.yml` fast-forwards `main` to the tested `dev` SHA; the strip promote row shows ✓, the `main` dot advances, and RR returns to clean

## Expected outcomes

- After the failed run: `origin/main` tip is byte-identical to before the dispatch — a red gate never moves main
- The failing Actions run is preserved on GitHub as the audit record of what failed and why
- The fix arrives as a normal slice (dev-flow), not as a manual edit to `main` or a force push
- `ci.yml` green on the fix push gives Philipp pre-gate confidence before re-dispatching
- The retry is a fresh, full `promote.yml` run — no partial re-run, no state carried over from the failed attempt
- After the green run: `main` == tested `dev` SHA; commits-ahead 0; RR clean; strip shows the failed row (historical) followed by the ✓ row
- No local gate state involved at any point: no `GATE_FAILED` in `branch-state.json`, no mutex to clean up, no abort button — the "failed gate state" lives entirely in the Actions run history

## Known failure modes

- **Failure output doesn't identify the culprit.** The test name lacks the `slice-<id>-ac-<index>` / `J-*` tag, so Philipp can't map the failure to a journey/AC. *Recovery:* inspect the test file in `regression/`; flag the naming violation to Bashir (naming convention is load-bearing for exactly this moment).
- **The fix slice doesn't actually fix it.** `ci.yml` is green only because the failing case isn't reproduced per-push, or the fix is incomplete; the retried gate fails again. *Recovery:* repeat the loop — failed runs are cheap and main stays protected; commission another fix slice.
- **Flaky test (red on runner, green locally).** The failure is environmental (network, wall-clock, machine paths) rather than a product bug — a CI-portability violation. *Recovery:* route to Bashir to fix the test; do not promote around it and do not delete coverage to get green.
- **Re-dispatch while the retry is already running.** Second press during the in-flight retry returns `409 gate_already_running`; no duplicate run. *Recovery:* wait.
- **Dispatch itself fails on retry (gh/auth).** No run is created. *Recovery:* fix credentials on the dashboard host, press again (see J-merge-button-pass failure modes).

## Sources

- `.github/workflows/promote.yml` — red suite stops the workflow before the ff step; main untouched on failure
- `.github/workflows/ci.yml` — per-push feedback that the fix landed green on dev
- `dashboard/server.js` — `/api/promote/dispatch`, 409 guard on concurrent dispatch
- `dashboard/lcars-dashboard.html` — strip promote row failed state + deep link to the Actions run, RR score behavior across fail/retry
- `docs/adr/ADR-GITHUB-CI-MERGE-MODEL.md` — operator-gated promotion amendment; ff-only invariant

## Open questions

- How is the failed-run deep link surfaced — strip row only, or also a persistent "last gate result" indicator in the Branch Topology panel until the next green run?
- Does the dashboard distinguish "suite red" from "infrastructure red" (runner error, checkout failure, non-ff push rejection) in the strip, or is everything a generic gate-failed?
- Is there any notification path (beyond the strip) when a dispatched gate fails — or must Philipp keep the dashboard open to notice?
- When several fix slices are needed, should Philipp wait for all of them before re-dispatching, or retry after each? (The gate is cheap and main is protected either way, but the RR score could advise.)
- Should repeated failures on the same test escalate anywhere (e.g. auto-flag to Bashir/O'Brien after N consecutive red gates)?
