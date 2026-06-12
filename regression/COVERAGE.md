# Regression Catalogue — Coverage

*Maintained by Bashir (QA). Last updated 2026-06-12, after landing the full journey catalogue.*

## Suite facts

| Fact | Value |
|---|---|
| Runner | `node --test 'regression/**/*.test.js'` (Node 24, no npm deps) |
| Total tests | **168** |
| Passing | **159** |
| Failing | **0** |
| Skipped (documented findings, see below) | **9** |
| Wall time (local, M-series mac) | ~2.5 s |
| CI | `.github/workflows/ci.yml` runs the identical command on every dev push; `promote.yml` re-runs it on a clean runner before fast-forwarding main |

Every test name carries a `J-<journey>` tag and/or a `slice-<id>-ac-<index>` tag so failures trace to a journey step or acceptance criterion. This convention is itself enforced by a meta-test (`j-gate-fail-retry` slice-316-ac-9).

**Before any full local run:** `rm -rf regression/_test_timeout_suite regression/_test_pass_suite`. Two retired-gate tests under `test/` (not in CI) regenerate a never-resolving test file the CI glob matches; if present, the full run hangs forever.

## Journey → files → what they guard

All 14 testable journeys from `docs/e2e-journeys/INDEX.md` (plus the discovered `J-queue-detail-controls`) are covered. Tests run against journey text as specification; product modules are driven through their interfaces (orchestrator `_testSetDirs`/`_testSetProjectDir` hooks, the dashboard server compiled into a tmpdir root, fixture git repos). Live `bridge/` state is never touched.

### Authoring & Staging
| Journey | Files | Tests | Guards |
|---|---|---|---|
| J-stage-and-watch-slice | `authoring-staging/j-stage-and-watch-slice.test.js`, `…-cli.test.js` | 9 + 10 | Staging a slice via the CLI and seeing it appear in Ops: file lands in `bridge/staged/`, staged listing serves it, frontmatter survives round-trips |
| J-approve-and-reorder-queue | `authoring-staging/j-approve-and-reorder-queue.test.js` (+ helpers), `j-approve-and-reorder-server.test.js` | 11 + 7 | Approve moves `STAGED → QUEUED` with `HUMAN_APPROVAL` emitted; drag-reorder rewrites `queue-order.json` atomically; order survives restarts |
| J-queue-detail-controls | `authoring-staging/j-queue-detail-controls.test.js`, `…-server.test.js` | 5 + 9 | Detail-overlay actions: save edits (frontmatter preserved), un-approve, remove-to-trash, return-to-O'Brien (`NEEDS_APENDMENT`), each with its register event |

### Dispatch & Execution
| Journey | Files | Tests | Guards |
|---|---|---|---|
| J-rom-completes-slice | `dispatch-execution/j-rom-completes-slice.test.js` | 9 | The happy dispatch path: QUEUED pickup → IN_PROGRESS → DONE report appended → IN_REVIEW; register event sequence |
| J-slice-broken-fast-path | `dispatch-execution/j-slice-broken-fast-path.test.js` | 10 | A slice that errors out fast: ERROR state, no phantom retries, queue not wedged, operator-visible error artifacts |

### Review & Verdict
| Journey | Files | Tests | Guards |
|---|---|---|---|
| J-nog-accepts-slice | `review-verdict/j-nog-accepts-slice.test.js` | 12 | PASS verdict appends the Nog Review block, advances state, emits REVIEWED/REVIEW_RECEIVED |
| J-nog-rejects-slice-round-2 | `review-verdict/j-nog-rejects-slice-round-2.test.js` | 10 | REJECT → re-queue under the **same id**, append-only block history through Round-2 acceptance, no minted ids, stable branch derivation |
| J-nog-max-rounds-escalation | `review-verdict/j-nog-max-rounds-escalation.test.js` | 7 | Round cap: 6th rejection escalates to O'Brien instead of looping; reworked slice re-enters only via Philipp's approval |

### Gate & Merge (highest blast radius — bad code reaching main)
| Journey | Files | Tests | Guards |
|---|---|---|---|
| J-merge-button-pass | `gate-merge/j-merge-button-pass.test.js` (+ helpers) | 12 | The slice-316 model: `promote.yml` is workflow_dispatch-only (nothing auto-promotes); gate runs the full suite strictly before the only main-push step; ff-only to the tested SHA; RR/branch-state reports real commits-ahead and churn; double-press → 409; dispatch failure → 502 with no run recorded; **no local gate machinery is recreated** |
| J-gate-fail-retry | `gate-merge/j-gate-fail-retry.test.js` (+ helpers) | 9 | Red gate leaves main untouched; no continue-on-error/always() escape hatches in the workflow; retry is a fresh full run; cancelled/timed-out runs don't wedge the button |

### Recovery & Observability
| Journey | Files | Tests | Guards |
|---|---|---|---|
| J-pipeline-pause-resume | `recovery/j-pipeline-pause-resume.test.js` | 8 | `bridge/.pipeline-paused` flag: paused pipeline dispatches nothing, resume picks up where it left off, no slices lost |
| J-watch-slice-live-log | `observability/j-watch-slice-live-log.test.js` | 7 (3 pass / 4 skip) | What exists headlessly: `/api/bridge` serves the IN_PROGRESS slice + heartbeat elapsed-time for the Active Build panel; per-slice per-round log files persist for post-mortem. The rest of the journey is an unimplemented product feature — see findings |
| J-inspect-slice-history | `observability/j-inspect-slice-history.test.js` | 10 (9 pass / 1 skip) | History rows carry id, title (read from the archived file), acceptance signal, and **real** recorded cost/duration (distinct fixtures → distinct values, nothing hardcoded); `/api/costs` aggregates `rounds[]` telemetry; per-tab data sources for the detail view; shipped slices never display as failures |

### Direct Controls
| Journey | Files | Tests | Guards |
|---|---|---|---|
| J-direct-controls-ops-ui | `direct-controls/j-direct-controls-ops-ui.test.js` | 14 (10 pass / 4 skip) | The unique headless surfaces of the control catalog: system-pulse tri-state (`up`/`stale`/`down`) derived from heartbeat age incl. missing-file case; approve/reject staged rows (reject is row-scoped); one representative cross-assertion per queued-detail control. The four retired-local-gate rows are named skips — see findings |
| J-direct-controls-ops-ui (addendum 2026-06-12) | `direct-controls/j-direct-controls-regression-coverage.test.js` | 3 | The Bashir crew card (Philipp's spec): `GET /api/regression/coverage` serves this file verbatim with a freshness timestamp, 404s cleanly when absent; the shipped dashboard wires the card active + clickable to the coverage overlay |

### Base suite (pre-journey, committed in `def7308`)
| Files | Tests | Guards |
|---|---|---|
| `top-user-journeys/top-5-user-journeys.test.js` | 5 | End-to-end smoke of the five core flows in one file |
| `slice-311.test.js` | 1 | `package.json` integrity |

## Portability finding — dev is broken on clean checkouts (caught by CI on first landing, 2026-06-12)

The first CI run of this catalogue (`fb418b1`) failed with 19 test failures that do not reproduce locally. Root cause, verified by clean-clone bisection: **the committed `bridge/orchestrator.js` requires `./kira-events`, a module that was never committed to git.** On any clean checkout, `require('bridge/orchestrator.js')` — and therefore `bridge/new-slice.js` and every test that drives the real orchestrator — throws `Cannot find module './kira-events'`. The repo on this machine works only because the role-rename wave (commit `7f53354`, 2026-06-06) left its fixed orchestrator (kira references removed) **uncommitted in the working tree**.

Evidence: a fresh clone of `fb418b1` fails 19/165; overlaying the single working-tree `bridge/orchestrator.js` onto that clone yields 156 pass / 0 fail. The fix is committing that one file — a product-code commit that is not Bashir's to make (the working-tree diff also contains an unreviewed behavioral addition, a `rom_no_commits` hard-fail in `verifyRomActuallyWorked`, which should pass through review like any product change). Until it lands, the red CI strip on dev is **correct and truthful**: dev as committed cannot run its own orchestrator on any other machine, and must not be promoted.

The 19 affected tests (all of `j-stage-and-watch-slice-cli` and `j-slice-broken-fast-path`) are deliberately **not skipped**: they guard real journey steps that dev, as committed, genuinely fails. Masking them would turn the gate green on a broken tree.

## Product findings (the 9 skips)

Skipped tests are findings, never fabricated green. Each skip's comment block in the file carries the full evidence.

1. **PRODUCT BUG — History detail view is empty for ARCHIVED slices** (1 skip, `j-inspect-slice-history.test.js`).
   `buildSliceInvestigation` in `dashboard/server.js` (the function behind `GET /api/slice/:id`, which feeds the History panel's detail tabs) never includes `{id}-ARCHIVED.md` in its candidate lists, although `getTitleAndGoal` and `/api/queue/:id/content` both have the ARCHIVED fallback. For a slice in the journey's own precondition state — terminal ARCHIVED with all blocks appended — all three tabs render placeholders even though the data is on disk. Verified empirically 2026-06-12. Fix: add the `-ARCHIVED.md` candidates to `buildSliceInvestigation`, then unskip.

2. **PRODUCT GAP — the live-log feature is unimplemented** (4 skips, `j-watch-slice-live-log.test.js`).
   Journey steps 2–6 have no implementation on dev: the orchestrator keeps Rom's stdout in memory only (no per-slice Rom log file, no streaming to the register); the Active Build panel's action group has no "View live log" button (the only such anchor sits in the Nog lane and is wired to the `viewNogLog()` placeholder); no `/api/log*` route exists in `server.js`. The journey's failure-mode section says "file a finding if the button is absent" — these skips are that finding. Route to Ziyal/Sisko for scoping.

3. **STALE SPEC — four journey rows describe the retired local gate** (4 skips, `j-direct-controls-ops-ui.test.js`).
   The "Merge to main → gate-start/GATE_RUNNING", "gate step cards", "abort → ACCUMULATING" and "gate status pill" rows predate slice 316. Per `docs/adr/ADR-GITHUB-CI-MERGE-MODEL.md` (Amendment 2026-06-06) the retired local gate stays retired; the live control (RUN GATE & MERGE TO MAIN → `/api/promote/dispatch`) is covered in `regression/gate-merge/`. Kept as named skips so the stale rows stay traceable until the journey doc is updated.

## Known gaps

- **`J-recovery-mutex-orphan` is not tested — deliberately.** It specs recovery from an orphaned *local gate mutex*, machinery retired by slice 316. The journey awaits re-spec against the GitHub-CI model. Consequence: the catalogue currently has **no recovery-from-crash coverage** beyond pause/resume.
- **Browser-only behavior is out of headless scope** across all UI journeys: hover/focus/active states, tooltips, chevron rotation, drag visuals, modal open/close, Escape/Enter handling, scrolling. Headless tests pin the data contracts the UI consumes; nobody asserts the pixels.
- **`promote.yml` semantics are tested by parsing the workflow YAML and simulating the ff-step in fixture git repos** — faithful to the file, but real GitHub Actions behavior is only proven by actual promote runs. The first few button presses are the live verification.
- **`test/` (orchestrator unit/integration tests) is intentionally not in the CI gate** per the note in `ci.yml` — much of it tests retired local-merge internals. Not a `regression/` concern, but the orchestrator itself has thinner gate coverage than the dashboard/server until that suite is hardened and re-included.

## Weak spots (honest self-assessment)

- `j-watch-slice-live-log` ac-9 (log persistence) is a **fixture simulation**: the orchestrator's `LOGS_DIR` is `__dirname`-anchored and not redirectable via the test hooks, so the test asserts the naming/persistence contract against files it writes itself with the orchestrator's primitive. It guards the contract shape, not the orchestrator's execution of it. Making `LOGS_DIR` injectable would let this become a real integration test.
- `j-direct-controls-ops-ui` deliberately covers each queued-detail control with **one representative assertion**, delegating depth to `j-queue-detail-controls*`. If those files are ever removed, the direct-controls file alone is not deep coverage.
- The heartbeat tri-state thresholds (30 s / 60 s bands) are asserted as observed server behavior matched to the journey's three states; if the product retunes the bands, these tests fail and need a spec-side confirmation, not a blind update.

## What would make this suite gate-worthy next

1. Re-spec `J-recovery-mutex-orphan` for the GitHub-CI model (what *is* the crash-recovery story now?) and author it — the catalogue's only untested journey and the biggest blind spot.
2. Fix the ARCHIVED-slice detail-view bug and unskip the finding test.
3. Scope and implement the live-log path; unskip the four gap tests as the feature lands.
4. Make `LOGS_DIR` injectable in the orchestrator so log persistence is integration-tested.
5. Add a thin browser-level smoke (Playwright against the tmpdir-rooted server) for the UI-only journey rows headless tests can't reach.
6. Harden and re-include `test/` in CI per the ADR note, so the orchestrator's internals are gated too.
