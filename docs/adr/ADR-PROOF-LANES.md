# ADR — Proof Lanes: machines run suites, agents do not; two lanes of rigour

**Status:** Proposed. Decided by Taylor (Architect; legacy key `dax`) on 2026-09-07 at Philipp's
request; briefs revised after adversarial review on 2026-09-10; Philipp approves the slices and applies the contract patches. Amends the run-count table
of Chris's ruling of 2026-09-03 (`.claude/roles/worf/RULING-TEST-OWNERSHIP-2026-09-03.md` §4).
**Builds on:** `ADR-GITHUB-CI-MERGE-MODEL.md` (main moves only on a green gate),
`ADR-TEST-UPDATE-GATE.md`, `ADR-AC-RECONCILE.md`. Changes nothing about what protects main.
**Owner:** Taylor owns this contract. Alex slices nothing here; the six slices are staged by Taylor.
Chris owns the CI half and the ruling amendment.

> Crew names: this record uses the real-world names of the 2026-09-03 rename plan
> (`docs/ROLE-RENAME-PLAN.md`). Sam = Rom (builder), Jordan = Nog (reviewer), Julian = Bashir (QA),
> Alex = O'Brien (lead), Chris = Worf (DevOps), Taylor = Dax (architect).

---

## 1. Context, measured

Slice 383 changed 13 lines of the dashboard (two owner chips get a person's name). Sam's session
took 16.3 minutes, 65 tool calls, $5.14, and produced 13 product lines against 642 lines of tests,
report and lock files. The full record is `bridge/logs/rom-383.log`; the per-call split was
re-derived by eleven independent checks on 2026-09-07.

| Where the 16.3 minutes went | min | share |
|---|---|---|
| Full safety-net suite, six invocations in four calls | 5.4 | 33% |
| Orientation before the first edit (63% of it reading the lock and hash machinery) | 3.6 | 22% |
| Writing the 227-line report | 2.5 | 15% |
| Writing nine tests (319 lines) | 1.9 | 12% |
| Lock regeneration, second commit, reconcile loop | 1.4 | 9% |
| Break-it proof and screenshots | 1.2 | 7% |
| The product change | 0.65 | 4% |

Of the six suite runs one was demanded, one was forced by a guard that fails in every fresh copy of
the code (`slice-372-ac-2` asserts a gitignored file exists), four were Sam hunting the names of
five pre-existing skipped tests for one sentence of his report. Each run cost 53 to 58 seconds in
his session against 22 seconds for the same commit in a clean worktree.

The same fixed floor shows in every recent run: first product edit at minute 1.6 to 5.3, 65 to 114
tool calls, 11.5 to 22.5 minutes, paperwork exceeding product by 3.5 to 14 times. Nothing is
rate-limited; the model answers in 5 to 7 seconds per turn. Time is spent on what we ask Sam to
prove and write, not on the change.

Two further facts decided the shape of this record. The metric fields Sam must fill (tokens, elapsed
time, human hours) are unobservable to him and were invented; the run's cost is recorded three
different ways ($3.77 timesheet, $3.91 register, $5.14 CLI). And the suite Sam runs locally already
runs on GitHub on every push to dev (`.github/workflows/ci.yml`) and again at the merge gate
(`promote.yml`); his run is the third of four, and the only one that costs tokens.

## 2. Decision

**Rule 1 — machines run suites, agents do not.** No agent runs the full safety-net suite or the
browser suite. Sam runs only the test file he wrote. GitHub runs the safety-net suite when a slice
lands on dev; Julian's stage machinery (when built) runs both suites once on dev; the Promote button
runs both once more. A red run on dev files a fix request into Alex's inbox by itself; it is a
trigger, not a warning light.

**Rule 2 — two lanes, declared in the brief, checked in review.**

| | core | surface |
|---|---|---|
| What it is | Changes what the system does: control flow, state, git, the gate, API endpoints and responses, the orchestrator, lib, scripts, workflows, a test's behaviour | Changes what the screen shows or says, or what a document says: markup, copy, styling, docs, role files, templates, prompt wording. No new branch of logic |
| Safety-net tests by Sam | One per criterion plus one per trap | Only where a criterion asserts behaviour (an interaction or a computed value); otherwise none |
| Break-it proof | Yes, and machine-repeated at Julian's stage | No |
| Report | The seven headings of the 3 September ruling | Four: Summary, What changed, Screen hooks, Commit |
| Jordan's review | Unchanged | No rejection for missing tests or proof; rejection for a lane mismatch (the diff alters behaviour; Alex re-files as core) |
| Criteria-coverage gate | Unchanged | A criterion without a test is `SURFACE`, passed with the reason "Jordan's review is the evidence; the browser suite covers the screen at the gate" |
| Test-Update Gate | Unchanged | A file changed only by surface commits is not policed for missing guards; the masking classifier (loosened, removed, skipped) applies to both lanes |
| Effort setting | max | high, as a measured trial (`laneArgs` in `bridge.config.json`) |

Alex declares the lane (`--lane` in `new-slice.js`; a brief without a lane is core). Jordan checks
the diff against the declaration. The lane travels as a `Lane:` trailer on every commit so the gate
reads it from history, never from a working file.

**Rule 3 — the pipeline produces what the pipeline knows.** The orchestrator fills tokens, elapsed
time and cost into the report it keeps, from the session it ran; a report with zeros is never an
error. The orchestrator regenerates the two lock files inside the landing commit; every brief
arrives with its `@ac-hash` lines pre-computed. Sam never runs a lock script, never edits a lock,
never reads the gate machinery.

## 3. The amended run-count table

Replaces §4's table in the 2026-09-03 ruling. Rom's "once, before he hands in" becomes "never".

| Who | Own new test file | Full safety-net suite | Full browser suite |
|---|---|---|---|
| Sam, while working | as often as he likes | never | never |
| GitHub, on every push to dev | | once (red files a fix request) | never |
| Julian, while writing | as often as he likes | never | never |
| Julian's stage machinery, on his signal | | once, on dev | once, on dev |
| Promote button | | once | once |

## 4. Conditions (all three are slices below; the decision is not live until they land)

1. A red safety-net run on dev files a fix request automatically (Slice 388). Without it the
   coverage Rule 1 relies on is decorative.
2. The lane is declared by Alex and checked by Jordan against the diff (Slice 389). By nature of the
   change, not by file path: `dashboard/lcars-dashboard.html` mixes markup with 218 functions of
   real logic, so a path rule misclassifies. (The decomposition review on Taylor's desk would make
   the lane rule mechanical; until then Jordan's check carries it.)
3. The criteria-coverage gate and the Test-Update Gate learn the lane (Slice 390). Otherwise every
   surface criterion is flagged MISSING, Pipeline A stays NEEDS_YOU, and a fix slice goes back to
   Sam through the side door.

## 5. Risk, classified (per the architect's risk discipline)

- **Acceptable:** a surface change lands on dev without a local proof and breaks something CI
  catches a minute later; the fix goes forward on dev; main is untouched. For a panel header this
  is the right bet. Blast radius is the operator's dashboard on dev.
- **Acceptable:** a lane is declared surface but the diff alters behaviour. Jordan rejects with a
  lane mismatch; the slice is re-filed as core. If Jordan misses it, the Promote gate still runs
  both suites before main moves.
- **No spike needed.** Every piece reuses existing machinery: the CI poll and artifact download in
  `dashboard/server.js`, the renderer in `scripts/regression-report.js`, `parseAcBlock` and
  `acHashOf`, the trailer parsers in `lib/tests-needed.js` and `lib/ac-range-scan.js`.
- **Nothing critical.** Main's protection (promote.yml: strict gate, both suites, ff-only) is not
  changed by any rule here.

## 6. What changes where

| Surface | Change | Vehicle |
|---|---|---|
| `bridge/orchestrator.js` | Fill metrics; retire `incomplete_metrics`; regenerate locks at squash; hash lines and lane in the template; lane in events and the squash trailer; effort by lane | Slices 386, 387, 388, 389 |
| `dashboard/server.js`, `scripts/regression-report.js`, the DevOps Station pill | Red dev files a fix request; register `DEV_SUITE_RED` / `DEV_SUITE_GREEN` | Slice 388 |
| `bridge/new-slice.js`, `bridge/nog-prompt.js`, `bridge/bridge.config.json` | `--lane`; Jordan's lane check; `laneArgs` | Slice 389 |
| `scripts/build-ac-manifest.js`, `lib/ac-range-scan.js`, `lib/ac-reconcile.js`, `lib/check-test-updates.js`, `lib/tests-needed.js`, `scripts/ac-reconcile.js`, the CHECK overlay | Lane in the manifest; `SURFACE` status; surface-only files exempt from guard policing | Slice 390 |
| `regression/dispatch-execution/j-untracked-runtime-state.test.js` | Passes in a fresh copy | Slice 391 |
| `docs/contracts/*` (locked, Philipp applies) | Actors, states, brief format (`lane`), report format, custody | `.claude/roles/dax/drafts/contracts-2026-09-07/CONTRACT-PATCHES-PROOF-LANES.md` |
| `.claude/roles/rom/ROLE.md`, `.claude/roles/obrien/slice-body-template.md` | Run rules, lanes, locks, metrics; the fixed block | Edited by Taylor on dev, 2026-09-07 |
| `.claude/CLAUDE.md` (Philipp applies) | The Tests sentence | In the patch document |

## 7. Order and interaction with staged work

Order: 386 (metrics), 387 (locks and hashes), 388 (no suite; red dev routes), 389 (lanes), 390
(gate learns the lane), 391 (fresh-copy guard). 387, 388 and 389 each build on the template function
386 creates; 390 reads the trailer 389 writes. **Approval rule: approve one at a time, and approve
the next only after the previous shows SLICE_SQUASHED_TO_DEV in the register (the History row reads
"accepted").** The daemon's `depends_on` field is not used, because it clears only on a promotion
to main, and the pipeline otherwise picks up the next queued slice while the previous one is still
in review. All six go before the test-ownership plumbing slices 363, 377, 378 and before the rename
slices R1 to R3, at Philipp's word that this is the next change. 388 must land before 378, which
rewrites the same failure parser; 378's brief gets one sentence to keep 388's exports working.

The orchestrator loads its code at start. Slices 386 to 389 change `bridge/orchestrator.js`; Chris
restarts the daemon after they land (`launchctl kickstart -k gui/$(id -u)/dev.denorios.orchestrator`).
Until then the running daemon keeps the old template, which is why every one of the six briefs
carries a transitional "How to finish" section.

Julian's stage (slices 363, 377, 378): for a surface slice the stage runs its machine steps only
(both suites once); Julian is not spawned unless a criterion names an interaction. Alex adds that
sentence to those briefs before Philipp approves them; it is one line each.

Uncommitted rename work in the main tree touches `bridge/new-slice.js`, `scripts/ac-reconcile.js`,
`scripts/build-ac-manifest.js` and `scripts/regression-report.js`, four files these slices also
touch, plus an untracked test file `regression/orchestrator/j-role-map.test.js`. Commit or stash
it before approving 387 to 390: the drift merge will conflict on the four files, and once 387 is
live its lock regeneration refuses to land any slice while an untracked test file sits under
`regression/` (by design: a stray test must never be baked into the lock). Two more facts the
reviews surfaced for Chris: the autocommit that protects uncommitted work before the squash checkout
currently fails on a type-change status line (`T bridge/nog-prompt.js`, the symlink from the rename
WIP), and the failure branch in 387 therefore uses `git reset --keep`, never `--hard`.

Verification: the six briefs were adversarially reviewed against dev HEAD before staging (two
lenses per brief plus a cross-slice critic); the findings were applied on 2026-09-07 and
2026-09-10 and are recorded in the briefs themselves. Where a brief names an exported function
(`buildDoneTemplate`, `fillDoneMetrics`, `buildHashLines`, `routeDevSuiteRun`, `resolveLane`,
`laneEventFields`, `applyLaneArgs`), that is the seam Sam's safety-net test drives; nothing in these
slices is testable only by grepping source text.

## 8. Measurement

Every DONE event now carries `lane`, `effort`, real `tokens_in`, `tokens_out`, `tokens_cache_read`,
`elapsed_ms` and the CLI's `cost_usd`. After ten surface slices and ten core slices, compare minutes
and dollars per lane against the 2026-09-06 baseline (core-shaped rigour on a surface change: 16.3
min, $5.14). Expected for a slice like 383: about 4 minutes and under $2. No number goes into a
contract before those twenty runs are read.

## 9. What this record does not decide

- The decomposition of the three giant files (Alex's handoff of 2026-09-02): separate review, still
  on Taylor's desk.
- Model A (spec-first parallel authoring): stays parked. Nothing here writes anything before the
  code exists or changes the order of the pipeline.
- Whether Jordan's review itself should be lighter for surface slices: measured first.

## 10. Philipp's words, 2026-09-07

- "right now, even very little tasks that we give to Sam to build, take a long time ... this cannot
  be the way we want to approach things long term."
- "arent we better off to run these tests less often and not on a per slice basis? ... either, we
  make a decision which size and complexity of size actually benefits from this sort of exactness
  or we somehow need to rethink the devops workflow."
- "you are the architect and you have to be responsible for the decision. are you okay with cutting
  down sams tasks a lot since we have enough coverage in other areas?" (Taylor: yes, under the three
  conditions in §4.)
- "okay, this must be the next change we make."
