# Regression Catalogue — Coverage

*Maintained by Bashir (QA). Last updated 2026-09-01, after the packaging + S-numbering coverage pass (slices 348/350/351/352 — see the dated section at the end). Suite-facts table below reflects the 2026-06-13 baseline; current totals: **356 regression tests (352 pass / 4 skipped), 42 e2e tests, both green.***

## Two test layers

QA runs two suites, kept separate on purpose:
- **`regression/`** — fast `node --test` API/contract gate (the hot loop; this doc's tables).
- **`e2e/`** — real Playwright browser clicktests of the Ops dashboard (**23 tests / 12 journeys**): crew-dossier, lcars-mode, engineering-queue, conversation-menu, ci-strip-report, gate-button (incl. red/yellow flagging, live gate phases, stale-success drift guards), history-logbook, economics-ledger, drag-reorder, pipeline-lifecycle, rollback (topology + History-row). Run: `npx playwright test`. It is a **promote-gate merge blocker** (`promote.yml` runs it between the regression suite and the fast-forward), so it does not run on every dev push — `if: github.event_name != 'push'` in `ci.yml`; verify on a clean runner with `gh workflow run ci.yml --ref dev`.

## Suite facts (regression layer)

| Fact | Value |
|---|---|
| Runner | `node --test 'regression/**/*.test.js'` (Node 24, no npm deps) |
| Total tests | **186** |
| Passing | **177** |
| Failing | **0** |
| Skipped (documented findings, see below) | **9** |
| Wall time (local, M-series mac) | ~5 s |
| CI | `.github/workflows/ci.yml` runs the identical command on every dev push; `promote.yml` re-runs it (plus the e2e suite) on a clean runner before fast-forwarding main |

Every test name carries a `J-<journey>` tag and/or a `slice-<id>-ac-<index>` tag so failures trace to a journey step or acceptance criterion. This convention is itself enforced by a meta-test (`j-gate-fail-retry` slice-316-ac-9).

**Before any full local run:** `rm -rf regression/_test_timeout_suite regression/_test_pass_suite`. Two retired-gate tests under `test/` (not in CI) regenerate a never-resolving test file the CI glob matches; if present, the full run hangs forever.

## The Test-Update Gate (`gate-merge/`)

Beyond guarding behaviour, the suite guards **the tests themselves** against loosen-to-go-green
(ADR-TEST-UPDATE-GATE; contract: [`docs/contracts/test-update-gate-trailers.md`](../docs/contracts/test-update-gate-trailers.md)).

- **`lib/assert-direction.js`** — signs each assertion change as tightened / reworded / **loosened / removed / skipped**; an unknown idiom fails loud (reads loosened). Locked by `j-tests-needed-direction` (`slice-99820`).
- **Rename detection** — an untagged check that is reworded within one file is paired with its successor, **merged** and re-classified, so a pure rename reads reworded while a rename that also weakens still reads loosened; the rename rides along as a label, never as a direction. Cross-file renames and tag changes stay RED (fail closed). Locked by `j-tests-needed-rename` (`slice-366`).
- **`lib/tests-needed.js`** — the verdict engine: classifies the pinned `merge-base(main,dev)..dev` changeset into CLEAR / NEEDS REVIEW / OVERRIDDEN / **RED FLAG**, honouring only scoped, transition-matched override trailers. Locked by `j-tests-needed-verdict` (`slice-99821`) and the engine self-lock `j-tests-needed-self-lock` (`slice-99823`).
- **`regression/COVERAGE.lock`** — the source→guard backstop (which slice tags read which BEHAVIOUR source), derived by `scripts/build-coverage-map.js`. Integrity + anti-shrink ratchet: `j-coverage-map-integrity` (`slice-99822`).
- **Enforcement** — `scripts/tests-needed.js --strict` blocks `promote.yml` on RED (no escape hatch); `ci.yml` runs it advisory on every dev push; the Ops checkpoint shows the banded verdict and defaults to STOP behind a non-author second-ack. Phase wiring: `j-promote-gate-phases`.

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
| J-rom-work-substance | `orchestrator/j-rom-work-substance.test.js` | 10 | Whether Rom worked is decided by `git diff --numstat`, never by commit count or self-reported tokens (slice 375, after the rule filed finished slices 366 and 371 as fake): empty branch → `rom_no_commits`, bookkeeping-only branch → `rom_no_product_change`, one commit of real content passes, divergence warns only |

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
| J-direct-controls-ops-ui (addendum 2026-06-12) | `direct-controls/j-direct-controls-regression-coverage.test.js` | 7 | The Bashir crew card (Philipp's spec): `GET /api/regression/coverage` serves this file verbatim with a freshness timestamp, 404s cleanly when absent; the shipped dashboard wires the card active + clickable to the coverage overlay. Gate-button responsiveness (Philipp's spec): the click is acknowledged visually before any network call, a live elapsed readout ticks while the gate runs, and promote is explained in plain language on the button, both strip rows, and the header info icon. Topology/CI visibility (Philipp's spec): branch-state carries run recency, commit subjects/ages, and churn split; the Regression row shows run age, flashes on a new verdict, and calls out "new push awaiting CI" when the latest green belongs to an older commit. The wiring checks are static source contracts — behavioral depth for branch-state lives in `gate-merge/` |

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

---

## 2026-09-01 — packaging + S-numbering coverage pass (slices 348, 350, 351, 352)

New features landed on dev (packaging initiative + S-numbering); the suites were updated to guard them:

**Moved (intended behaviour changes, assertions re-pointed, never loosened):**
- `e2e/lcars-mode.spec.js` — slice-348-ac-1: LCARS body/container background moved from pure black to charcoal `#0b0b14` (`rgb(11,11,20)`). Now pins the exact new value, asserts NOT-black (a revert goes red), and guards `.dashboard-container` against half-reverts.
- `regression/gate-merge/j-ac-amend-order.test.js` — un-squatted stale `slice-350-ac-3/-ac-4` tags that collided with the real slice 350 AC set (the tags were assigned against a *planned* AC set that never shipped). The tests guard the ac-range-scan contract; their honest tag is `J-ac-amend-order`.

**New guards:**
- `e2e/s-numbering.spec.js` — slice-350-ac-1 (label half: topology S-number node label + sha line; History S-identity, old "slice N" label banned) and slice-350-ac-2 (loose commits labeled sha-alone, no sequence number). Retired counter format (`commit N ·`) asserted absent.
- `regression/observability/j-s-numbering-retirement.test.js` — slice-350-ac-1 (retirement half): no product source references `commit-numbers.json`; static reads of the four rewired surfaces + full product-dir sweep.
- `regression/packaging/j-denorios-cli.test.js` — slice-351-ac-2 (`denorios status` reports orchestrator+dashboard state, exits 0) and slice-351-ac-3 (`npm test` runs the regression suite).
- `regression/packaging/j-npm-pack-whitelist.test.js` + `j-release-workflow-shape.test.js` (authored by Rom with the slices, audited + `@ac-hash`-annotated by QA): slice-351-ac-1, slice-352-ac-1..4.

**Documented gaps (routed, not hidden):**
- **slice-350-ac-3** (squash subject `S{id}: {title}`) — **the AC itself is guarded in CI** by `regression/gate-merge/j-s-numbering-squash-subject.test.js` (drives the real `squashSliceToDev` against a fixture repo; pins the subject and both trailers) — see the addendum below. **OPEN — UNGUARDED (wider than this AC):** slice 365 de-scoped `test/` from the Test-Update Gate (police only what you run — nothing executes that directory), so `test/squash-slice-to-dev.test.js` + `test/accept-and-merge-squash-to-dev.test.js` are formally not guard surface — and the cases only they covered are run by nothing: the squash **conflict** path (`{ success: false, error: 'conflict' }`, no partial state), the **atomic-write** requirement on `branch-state.json`, and the accept-and-merge integration (slice lands on dev, `main` untouched). The gap is pre-existing — that suite never ran — and 365 makes it visible instead of implied. Closing it means porting those three cases into `regression/`. Owner: unassigned. (This line previously read "guarded only by" those two `test/` files; that claim is superseded on both counts.)
- **slice-350-ac-4** (legacy `slice N:` subjects resolve in rollback preview / revert blame) — **no guard anywhere**. A real guard needs the preview endpoint against a git fixture; flagged rather than built fragile.
- **Classifier blind spot:** `package.json`, `.github/workflows/release.yml`, and `bin/` are INERT-bucketed in `lib/tests-needed.js`, and the coverage walker only walks `regression/` — so the packaging guards and all e2e guards can never corroborate in `COVERAGE.lock`. Pipeline A therefore flags slice-351/352 ACs "decide" despite real coverage. Bucket/walker design is Worf's strand; flagged to him.
- **Open question (Philipp):** ac-1's literal `"S{n} · {sha7}"` format renders on History surfaces; the topology renders the same identity as node label `S350` + line `abc1234 S350: …`. The e2e test asserts the intent; tighten to the literal form if that's the ruling.

### Addendum, same day — classifier blind spot CLOSED (Philipp's ruling)

Clicking CHECK FOR TEST UPDATES still flagged 10 ACs "No test guards this AC" despite the coverage above — the classifier only counted guards that statically `readFileSync` a BEHAVIOUR-bucketed source inside `regression/`. Per Philipp's ruling ("the gate must recognize done test updates"), `scripts/build-coverage-map.js` now has a second, annotation-declared registration form: a `// @ac-hash: <tag> sha256:<hex>` annotation whose tag also appears in a test title registers under the test file's own path — in `regression/` AND `e2e/`. Product-source corroboration semantics are untouched (test-file keys can't collide with product paths); the integrity meta-test's ac-5 was MOVED (not loosened) to pin the new form strictly: self-referential file, hash mandatory, junk keys still rejected.

Also closed the two remaining S-numbering gaps with real guards:
- `gate-merge/j-s-numbering-squash-subject.test.js` — slice-350-ac-3 in CI (fixture git repo + orchestrator `_testSet*` hooks; subject `S{id}: {title}`, trailers unchanged).
- `gate-merge/j-s-numbering-legacy-resolve.test.js` — slice-350-ac-4 end-to-end against the real server (shared `compileServer` harness, extracted to `j-merge-button-pass-helpers.js`): rollback preview attributes pending commits from BOTH subject forms, and a genuinely conflicting revert blames the legacy-subject slice.

Result: Pipeline A resolves all 13 in-range ACs (11 pass, 2 kept) — zero decision cards, merge gate unlocked. Remaining for Worf: INERT-bucket promotion (affects only the needs-review band now) and the override first-match quirk.
