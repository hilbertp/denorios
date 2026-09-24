---
id: "401"
title: "History tells the truth: time per role, working time from Sam's start to landing, honest tokens and cost"
from: rom
to: nog
status: DONE
slice_id: "401"
branch: "slice/401"
completed: "2026-09-24T01:18:00.000Z"
tokens_in: 70
tokens_out: 29363
elapsed_ms: 349527
estimated_human_hours: 0.75
compaction_occurred: false
tokens_cache_read: 2380969
cost_usd: 2.7447334999999993
---

<!-- ds9:sticker v1 -->

# History tells the truth: time per role, working time from Sam's start to landing, honest tokens and cost — slice record

The whole sticker: the brief with every review round, the builder's report, the
reviewer's verdict, and Julian's result. This file is the slice's permanent record.

## Brief (with every review round)

---
id: "401"
title: "History tells the truth: time per role, working time from Sam's start to landing, honest tokens and cost"
goal: "The History row shows the working time from Sam's start to landing on dev (queue wait shown separately), sums of recorded tokens and cost marked partial when a role is missing, and a per-round breakdown for Sam, Jordan and Julian, with nothing estimated or floored."
from: obrien
to: rom
priority: high
lane: core
created: "2026-09-23T23:01:07.669Z"
timeout_min: 30
status: "QUEUED"
approval_provenance: "human-click"
approval_ts: "2026-09-23T23:27:12.010Z"
approval_sig: "e213edbb697b9eef0d13302d5133475e9aea76a2b8c94564752fdcabcaa3ae10"
rom_session_id: "69a1a234-6f09-4ad0-b412-3f486da00e83"
rounds:
  - round: 1
    attempt_number: 1
    commissioned_at: ""
    done_at: "2026-09-24T00:36:06.000Z"
    durationMs: 998599
    tokensIn: 134
    tokensOut: 75771
    costUsd: 6.870357499999997
    nog_verdict: "NOG_DECISION_REJECTED"
    nog_reason: "All seven ACs met and verified against the live register, but server.js:2793-2809 numbers rounds positionally instead of by the NOG_INVOKED round field the brief names, so a re-invoked review invents a round line that never happened — slice 401's own register already reproduces it."
  - round: 2
    attempt_number: 1
    commissioned_at: ""
    done_at: "2026-09-24T01:18:00.000Z"
    durationMs: 349527
    tokensIn: 70
    tokensOut: 29363
    costUsd: 2.7447334999999993
    nog_verdict: "NOG_DECISION_ACCEPTED"
    nog_reason: "Round 1's finding is fixed at the identity — rounds now come from the NOG_INVOKED round field — and Rom found the sibling lie in the same events, where an abandoned invocation claimed its successor's verdict; verified on the live register and nine synthetic shapes, all seven ACs hold, 10/10 tests green, scope clean."
total_durationMs: 1348126
total_tokensIn: 204
total_tokensOut: 105134
total_costUsd: 9.615091
round: 2
apendment_cycle: "1"
apendment: "slice/401"
branch: "slice/401"
not_before: "null"
---

### History tells the truth: time per role, working time from Sam's start to landing, honest tokens and cost

<!-- Lane: core. Adds fields to the /api/bridge response (docs/adr/ADR-PROOF-LANES.md §2). -->

#### What is broken / Goal

The History row for slice 399 shows TIME `2m`, TOKENS `24`, COST `$1.07`. Each number is wrong or
unlabelled: `2m` is Sam's session alone, floored to whole minutes (Jordan's 3m 39s and the 6m 13s
from Sam's start to landing are nowhere); `24` is a display bug that prints only the uncached input
tokens; `$1.07` is Sam's cost only, shown as if it were the slice's. Philipp read the row as the
slice's time and cost and could not reconcile it with what he watched.

After this lands: TIME is the working time from Sam's start to landing on dev, in minutes and seconds.
Time a slice waits in the queue after approval is not work time; the expanded row shows it on its own line.
TOKENS and COST are the sums of what was recorded, marked partial and naming the missing role when a
role's numbers were not recorded. The expanded row shows, per round, Sam's build and Jordan's review
with their times, then Julian's QA time, then the total. Nothing is estimated and nothing missing is
shown as 0.

Recording Jordan's and Julian's tokens and cost is not in this slice (the orchestrator does not
capture them today; that is a follow-up slice). This slice changes no orchestrator code.

#### Why (evidence)

Ground truth for 399 (UTC, 2026-09-23, from `bridge/register.jsonl`, `bridge/logs/rom-399.log`,
`bridge/logs/nog-399-round1.log`, `bridge/state/qa-stage-399.json`):

| Stage | From → to | Duration | Recorded tokens / cost |
|---|---|---|---|
| Sam, build | DONE `durationMs` | 143,982 ms (2m 24s) | in 24, out 12,753, cache read 527,411; $1.07 |
| Jordan, review | NOG_INVOKED 22:35:55.622 → NOG_DECISION 22:39:34.475 | 218,853 ms (3m 39s) | not recorded |
| Julian, QA | IN_QA 22:39:39.443 → QA_STAGE_RECORDED `ended_ts` 22:49:08.770 | 569,327 ms (9m 29s) | not recorded |
| Waited in queue | HUMAN_APPROVAL 22:33:23.886 → COMMISSIONED 22:33:25.600 | 1,714 ms | |
| Sam start → landed on dev | COMMISSIONED 22:33:25.600 → SLICE_SQUASHED_TO_DEV 22:39:39.172 | 373,572 ms (6m 13s) | |

Why not from approval: slice 400 was first approved at 22:33:27 but Sam started it at 22:42:44, behind 399.
From approval it would read 26m 22s; its working time was 17m 05s.

- TIME: `dashboard/lcars-dashboard.html` History row uses `c._synthDurationMs ?? c.durationMs`
  (around line 8262); the server copies `durationMs` from the DONE event, which only Sam writes
  (`dashboard/server.js` `buildBridgeData`, around 2718-2723); `fmtDuration` (around 8155-8160)
  floors to whole minutes.
- TOKENS: the page's inline script declares `function fmtTokens` twice — History's `(tokIn, tokOut)`
  around line 8172 and the Cost Center's `(v)` around line 10729 (slice 201). The later one wins, so
  `fmtTokens(24, 12753)` prints `24`. The same collision affects the Details overlay (around 8826,
  8926, 8948, 8970, 8988). The server also drops `tokensCacheRead` from the row.
- COST: the row shows DONE `costUsd`, Sam's only; when a cost is missing, `fmtCostWithFallback`
  (around 8189-8196) invents one at Sonnet prices although the roles run claude-opus-5.
- Rounds: `completedMap[ev.id]` keeps only the last DONE per slice (server.js around 2718), so a
  reworked slice shows only its final build.

#### Tasks

1. In `dashboard/server.js` `buildBridgeData`, add a `stages` object to every `recent[]` row, built
   from register events only:
   `{ approvedAt, startedAt, landedAt, queuedMs, rounds: [{ round, build: { startedAt, durationMs, tokens, costUsd }, review: { startedAt, durationMs, verdict, tokens, costUsd } }], qa: { startedAt, endedAt, durationMs }, totals: { elapsedMs, tokens, costUsd, missing } }`.
   - `startedAt` = the last COMMISSIONED ts before the slice's first DONE event (an aborted or
     re-dispatched attempt that never finished does not count); `approvedAt` = the last
     HUMAN_APPROVAL ts before `startedAt`; `landedAt` = SLICE_SQUASHED_TO_DEV ts;
     `queuedMs` = startedAt − approvedAt.
   - Rounds: the nth DONE event of the slice is build round n (`startedAt` = DONE ts − `durationMs`;
     `tokens` = tokensIn + tokensOut + tokensCacheRead; `costUsd` from DONE). Review round n =
     the NOG_INVOKED with `round` n to the next NOG_DECISION; `verdict` from NOG_DECISION;
     `tokens` and `costUsd` null.
   - `qa` from IN_QA ts to QA_STAGE_RECORDED `ended_ts`.
   - `totals.elapsedMs` = landedAt − startedAt (working time, not queue time); `totals.tokens` and `totals.costUsd` sum the
     recorded values; `totals.missing` lists the roles with a stage but no tokens or cost
     (for 399: `["Jordan", "Julian"]`).
   - Any value whose events are missing is `null`, never 0 or negative.
   - Leave `durationMs`, `tokensIn`, `tokensOut` and `costUsd` on the row exactly as they are.
2. In `dashboard/lcars-dashboard.html`, History row: TIME shows `totals.elapsedMs` as `Xm Ys`;
   TOKENS shows `totals.tokens` (k / M); COST shows `totals.costUsd`, and when `totals.missing` is
   not empty it is marked partial (for example `$1.07 partial`) with a title naming the missing
   roles. No estimated cost is shown for a missing role. A null shows `—`.
3. The expanded row lists, in plain words: per round, `Build · Sam` and `Review · Jordan` (with the
   verdict) with time, tokens and cost; then `QA · Julian` with time; then `Waited in queue` with its time; then `Sam start → landed on dev`
   with the totals. Missing values show `—`.
4. Rename the Cost Center's `fmtTokens(v)` to `fmtTokenCount` and update its callers, so History's
   `fmtTokens` is the one History calls. Update the `extractFn` lift in
   `regression/observability/j-history-chronological-order.test.js` (around 31-41, 90-94) and
   `regression/authoring-staging/j-ten-rows-a-page.test.js` (around 37-47) if the rename affects
   what they lift.

Write one safety-net test per acceptance criterion, plus one for each trap, then stop.

#### Screen hooks

- slice-401-ac-4: Rom to declare (the History row's TIME, TOKENS and COST cells for a given slice id).
- slice-401-ac-5: Rom to declare (the expanded row's per-stage lines).

#### Traps

1. `regression/observability/j-inspect-slice-history.test.js:367` (slice-901-ac-8) pins the row's
   `durationMs`, `tokensIn`, `tokensOut` and `costUsd` to the DONE values. Add fields; do not change
   these. Changing them would be a criterion change only Philipp may make.
2. The existing history tests lift the first `fmtTokens` in the file with `extractFn`, so they pass
   while the browser runs the other one. After the rename, the function History calls and the one
   the tests lift must be the same.
3. The register was wiped on 2026-09-17: a slice can have a DONE with no HUMAN_APPROVAL, or a
   NOG_INVOKED with no NOG_DECISION. The span must be `null` (shown `—`), never negative or absurd.

Notes, not traps:
- Do not change `bridge/orchestrator.js`. Slice 400 is changing `invokeNog` right now; recording
  Jordan's tokens and cost is a separate slice. If this slice seems to need an orchestrator change,
  report BLOCKED.
- Do not read `rounds[]` from slice files: they pair Sam's numbers with Jordan's verdict under
  placeholder timestamps and move to the trash on archive. Use the register.
- MERGED is written at the squash to dev; label the end point "landed on dev", not "main".
- A `server.js` change goes live only after the dashboard restarts; say so under ## Summary.

#### What Rom does not do

- Rom writes safety-net tests as the brief's lane says: core lane, one per acceptance criterion plus one per trap; surface lane, only where a criterion asserts behaviour. Then he stops.
- Rom never writes or commits a browser test (a *.spec.js under e2e/). Browser tests are Julian's, written after the slice is on dev.
- Rom never runs the full safety-net suite and never the browser suite. He runs only the test file he wrote. GitHub runs the safety-net suite when the slice lands on dev; the Promote button runs both.
- Rom may look in a browser to check his own work and says what he saw under ## Safety-net tests. He does not prove it with a test.
- Core lane only: before committing, Rom stashes his fix, runs his new test file, confirms every new test goes red, restores the fix, and lists which tests went red under ## Safety-net tests.
- Rom moves his own safety-net tests when his change requires it and lists every move under ## Tests moved or weakened. He never edits a browser test.

#### Acceptance criteria

- slice-401-ac-1: Every recent[] row of /api/bridge carries a stages object (approvedAt, startedAt, landedAt, queuedMs, rounds with build and review, qa, totals) built from register events, and the row's existing durationMs, tokensIn, tokensOut and costUsd are unchanged.
- slice-401-ac-2: For a register fixture shaped like slice 399, stages reports build 143982 ms, review 218853 ms with verdict accepted, qa 569327 ms, queuedMs 1714, and totals.elapsedMs 373572 from Sam's start to landing on dev.
- slice-401-ac-3: A value whose events are missing is null, never 0 or negative, and totals.missing names each role that has a stage but no recorded tokens or cost.
- slice-401-ac-4: The History row shows TIME as Sam's start to landed on dev in minutes and whole seconds (6m 13s for the 399 fixture), TOKENS as the sum of recorded tokens including cache reads, and COST as the sum of recorded costs, marked partial and naming the missing roles when any are missing; no estimated cost is shown for a missing role.
- slice-401-ac-5: The expanded History row lists, per round, Build · Sam and Review · Jordan with verdict, time, tokens and cost, then QA · Julian with time, then the time waited in the queue, then the Sam-start-to-landed total; missing values show —.
- slice-401-ac-6: The dashboard's inline script declares each top-level function name once, and the History row formats tokens with the function History defines.
- slice-401-ac-7: A slice with two build rounds and two reviews shows two round lines, and its totals equal the sums of the recorded rounds.

#### REQUIRED — declare the ACs as commit trailers

    AC: slice-401-ac-1: Every recent[] row of /api/bridge carries a stages object (approvedAt, startedAt, landedAt, queuedMs, rounds with build and review, qa, totals) built from register events, and the row's existing durationMs, tokensIn, tokensOut and costUsd are unchanged.
    AC: slice-401-ac-2: For a register fixture shaped like slice 399, stages reports build 143982 ms, review 218853 ms with verdict accepted, qa 569327 ms, queuedMs 1714, and totals.elapsedMs 373572 from Sam's start to landing on dev.
    AC: slice-401-ac-3: A value whose events are missing is null, never 0 or negative, and totals.missing names each role that has a stage but no recorded tokens or cost.
    AC: slice-401-ac-4: The History row shows TIME as Sam's start to landed on dev in minutes and whole seconds (6m 13s for the 399 fixture), TOKENS as the sum of recorded tokens including cache reads, and COST as the sum of recorded costs, marked partial and naming the missing roles when any are missing; no estimated cost is shown for a missing role.
    AC: slice-401-ac-5: The expanded History row lists, per round, Build · Sam and Review · Jordan with verdict, time, tokens and cost, then QA · Julian with time, then the time waited in the queue, then the Sam-start-to-landed total; missing values show —.
    AC: slice-401-ac-6: The dashboard's inline script declares each top-level function name once, and the History row formats tokens with the function History defines.
    AC: slice-401-ac-7: A slice with two build rounds and two reviews shows two round lines, and its totals equal the sums of the recorded rounds.
    Lane: core

---

#### Nog Review — Round 1

**Verdict:** REJECTED

One finding. Everything else in this slice is correct, and I verified it against the
live register rather than against Rom's fixture — see the evidence below. The finding is
small and local; the next round should be short.

##### AC Check

- **slice-401-ac-1** — every `recent[]` row carries `stages`; row metrics unchanged → **✓ Satisfied**
  `server.js:3007-3013` hangs `stages` on the row and leaves `durationMs`/`tokensIn`/`tokensOut`/`costUsd`
  untouched. A slice with no stage events gets `stagesForSlice([])`, so the key is never absent.
  Verified independently: `j-inspect-slice-history.test.js` (trap 1's owner, unmodified) still passes.
- **slice-401-ac-2** — the 399 fixture reproduces the measured table → **✓ Satisfied**
  Not just on the fixture. I ran the shipped `buildStagesById` over the **live**
  `bridge/register.jsonl` through the real `lifecycle-translate` shim. Slice 399 returns
  build 143982, review 218853 verdict ACCEPTED, qa 569327, queuedMs 1714, elapsedMs 373572,
  tokens 540188, cost 1.0700555 — the brief's table, to the millisecond. Slice 400 returns
  elapsedMs 1025424 = 17m 05s, which is the working time the brief cites as ground truth
  against the 26m 22s that counting from approval would have given.
- **slice-401-ac-3** — missing is null, never 0 or negative; `missing` names the roles → **✓ Satisfied**
  `stageSpan` (`server.js:2708-2715`) returns null on a missing endpoint or a backwards clock.
  Live check: slice 401's own row has `landedAt: null` and `totals.elapsedMs: null` because it
  has not landed — correct, and it reads `—` rather than 0.
- **slice-401-ac-4** — TIME/TOKENS/COST on the row → **✓ Satisfied**
  `lcars-dashboard.html:8431-8435`. `fmtWorkTime` truncates, so 373572 ms → `6m 13s` exactly as
  the criterion pins it. `fmtTokens(totals.tokens, 0)` → `540k`, cache reads included.
  `fmtStageCost` never estimates: `fmtCostWithFallback`'s Sonnet-priced guess is off the row.
- **slice-401-ac-5** — the expanded per-stage lines → **✓ Satisfied**
  `historyStagesHtml` (`lcars-dashboard.html:8285-8325`) emits build/review per round, then qa,
  then queued, then total, with `—` for every unrecorded value.
- **slice-401-ac-6** — each top-level function declared once; History formats tokens with its own → **✓ Satisfied**
  I checked this independently of Rom's test, with a broader regex (any indent, not just the
  two-space top level): `main` carries exactly three duplicates — `showAbortConfirm`, `fmtTokens`,
  `fmtCost`. The branch carries **zero**, across 239 declarations. The `fmtCost` and
  `showAbortConfirm` renames are not scope creep; AC-6 says *each* name, so they are required by it.
  The `showAbortConfirm` split is a real bug fix: on `main` the mission button at
  `#abort-btn` (`:6810`) called the gate's handler with no argument and threw on
  `containerEl.innerHTML`.
- **slice-401-ac-7** — two build rounds show two round lines; totals are the sums → **✓ Satisfied on the fixture**
  The 910 fixture passes, and the cursor at `server.js:2772-2777` correctly stops round 1's
  decision from closing round 2. But see the finding — the *round identity* is derived the
  wrong way, and on live data that produces a round that does not exist.

Gate 1 passes on the criteria as written. The finding lands in Gate 2 and in intent.

##### Code Quality Findings

1. **`dashboard/server.js:2793-2809` — a round line is invented when Nog is re-invoked for the
   same round.** The `rounds` array is composed **positionally**: `reviews[i]` becomes round
   `i + 1`. The brief's Task 1 names the key to use instead — *"Review round n = the NOG_INVOKED
   with `round` n to the next NOG_DECISION"* — and `server.js:2779` already reads that field
   (`round: stageNum(inv.round) ?? (i + 1)`), then **discards it**: the object pushed at `:2805`
   keeps only `{ startedAt, durationMs, verdict, tokens, costUsd }` and stamps `round: i + 1` from
   the loop counter.

   This is not hypothetical. **Slice 401's own live register already breaks it.** Two
   `NOG_INVOKED` events, both carrying `round: 1`:

   ```
   2026-09-24T00:37:42.323Z  NOG_INVOKED  round=1
   2026-09-24T00:52:25.539Z  NOG_INVOKED  round=1   (this review — the first invocation did not finish)
   ```

   Running the shipped code over the live register, slice 401 returns:

   ```
   rounds: [ { round: 1, build: {...}, review: {...} },
             { round: 2, build: null,  review: {...} } ]
   ```

   So the expanded row will print `Build · Sam · round 2   —   —   —` and
   `Review · Jordan · round 2` for a round that never happened — and every existing line gains a
   `· round N` suffix it should not have, because `many = rounds.length > 1` becomes true.

   Retries are ordinary here: this same slice was commissioned three times, with a `ROM_ABORTED`
   and a `RATE_LIMITED` in between. The one panel this slice exists to make truthful would start
   stating a round that does not exist, which is the same class of defect as the `2m` it replaces.

   **Fix:** group reviews by `inv.round` (falling back to position only where the field is
   absent), folding repeated invocations of one round into a single review stage, and size the
   `rounds` array by `max(dones.length, highest round number seen)` rather than by
   `reviews.length`. The AC-7 fixture stays green; add the re-invoked-same-round shape to it.

**Linting:** PASS — the repo has no eslint config; `node -c` is the available check and all four
changed JS files parse clean. Style matches the file: named pure helpers, comments that say *why*,
no new dependency, no nesting past three levels.

##### Safety-net tests / screen hooks

**PASS.** This is the strongest test file I have reviewed on this pipeline.

- **Count is exactly the lane target:** 7 criterion tests + 3 trap tests = 10. No padding.
- **Tags and hashes:** every test carries its `slice-401-ac-N` tag and an `@ac-hash` line. I
  recomputed all seven with `scripts/build-ac-manifest.js`'s own `normalizeAcText` + sha256 against
  the commit trailer text — **all seven match**.
- **Tests the criterion, not the shape:** the file drives the real `server.js` over HTTP against a
  fixture register, then feeds the row it gets back into the real `renderHistoryPage` lifted out of
  the shipped page. Joining the halves is the right call — it is what stops the server and the page
  from drifting while both stay green.
- **Break-it list is specific**, naming which tests went red and why (`no stages on the row`;
  `fmtWorkTime/fmtStageCost/historyStagesHtml do not exist`; `declared twice`), including the honest
  note that trap 1's first four assertions pass either way and it goes red on its last. That is the
  kind of reporting that makes the break-it check worth something.
- **Nothing pins dead code.** `fmtCost(usd)` at `lcars-dashboard.html:8230` now has zero callers —
  but it was already dead on `main` (shadowed by the Cost Center's copy), so this slice reveals it
  rather than creating it. Keeping it, with the comment saying two tests lift it by name, is the
  right call: removing it is a test change needing a second signature.
- **Tests moved or weakened:** the two `extractFn` additions are additive lifts, not weakenings —
  I confirmed no assertion changed in either file. No Test-Update Gate trailer is required. Both
  files plus trap 1's owner run green (29/29 across the three).
- **Screen hooks:** every promised selector exists in the shipped page — `data-history-id`,
  `.col-duration`, `.col-tokens`, `.col-cost`, `.cost-partial`, `#history-expand-N`,
  `#history-chevron-N`, `.history-stages`, `[data-stage]`, `.history-stage-role|time|tokens|cost`,
  `.history-stage-total`, `.history-stage-verdict`. Each carries its "visible when" line.
- **Report shape:** all seven required headings present.

##### Scope

Clean. Six files, every one required: the two product files, the new test, the two test files the
brief's Task 4 names by path, and the DONE report. Nothing lost that was not replaced. No `e2e/`
change. The `fmtCost`/`showAbortConfirm` renames beyond Task 4's letter are mandated by AC-6 and
are named in `## What changed`.

##### Flags (not findings)

**For O'Brien:**

1. **`approvedAt` = "the last HUMAN_APPROVAL before `startedAt`" under-reports the queue wait.**
   This is the brief's own wording and Rom implemented it exactly, so it is the spec that needs the
   change, not the code. Live: slice 400 has `HUMAN_APPROVAL` at 22:33:27.188 **and again** at
   22:42:44.478, with `COMMISSIONED` at 22:42:44.502 → `queuedMs: 24`. The row will print
   `Waited in queue  0s` for the ~9m 17s wait that the brief's own evidence table cites as the
   reason not to measure from approval. Suggest: the **first** HUMAN_APPROVAL after the previous
   terminal event, or the earliest in the approval run.
2. **`totals.missing` is role-level, not stage-level.** `server.js:2836-2839` lists a role only when
   *none* of its stages recorded anything (`!builds.some(recorded)`). A slice where round 1's build
   recorded and round 2's did not would show an unmarked partial sum. Not reachable today — the
   orchestrator records every DONE — but it is the reading of AC-3 that shipped.
3. **Role labels are literal**, as AC-5 writes them, so LCARS mode says Sam/Jordan/Julian rather than
   Rom/Nog/Bashir. Rom flagged this himself. It contradicts the mode-aware ROLE map convention;
   changing it moves AC-5, so it is your call, not his.
4. **Expect the panel to get emptier before it gets fuller.** A row reads `—` for TIME unless it has
   a `SLICE_SQUASHED_TO_DEV` at or after its start. That is the honest answer AC-3 demands, but it
   means historical rows lose their (wrong) number without gaining a right one.
5. **The follow-up slice has a home.** The live register already writes `NOG_TELEMETRY` per slice
   (rounds, files_touched, lint findings) — with no tokens or cost. That is where Jordan's numbers
   would hang, and `stages` is written so the totals pick them up and `partial` clears itself.

**For Julian's stage:**

6. The new test stubs `bridge/lifecycle-translate.js` with a pass-through and its fixture writes
   `id:` directly, while the live register writes `slice_id:` and depends on the shim's key
   normalization (`lifecycle-translate.js:130-136`) to add `id`. I confirmed by hand that the real
   path works end to end, but no safety-net test covers the `slice_id`-only shape, nor the legacy
   `REVIEWED`/`NOG_PASS` → `NOG_DECISION` translation that feeds the review stage.
7. `e2e/seed-fixture.js`'s history slice has no `HUMAN_APPROVAL`, `IN_QA`, `QA_STAGE_RECORDED` or
   `SLICE_SQUASHED_TO_DEV`, so a seeded row shows `—` for TIME and for the queue and total lines.
   Rom named this under `## Screen hooks` and left the fixture alone, correctly — it is yours.
8. `server.js` changes are inert until the dashboard restarts. Until then the page receives rows
   with no `stages` and all three cells read `—` (the renderer guards for it). Restart, then
   hard-reload the tab.

#### Apendment round 1

This is a Nog code review return for slice 401 (round 1 of 5).

**IMPORTANT: The orchestrator handles all git branching. Do NOT run any git checkout, git branch, or git switch commands. You are already on the correct branch. Just make your changes and commit.**

##### Nog review summary

All seven ACs met and verified against the live register, but server.js:2793-2809 numbers rounds positionally instead of by the NOG_INVOKED round field the brief names, so a re-invoked review invents a round line that never happened — slice 401's own register already reproduces it.

##### Instructions

Read the Nog review section appended to the slice file for detailed findings.
Fix all issues identified by Nog, then write your DONE report.

##### Success criteria

1. All Nog findings from the latest round are addressed.
2. All original acceptance criteria from slice 401 are met.
3. DONE report includes branch name in frontmatter.

---

#### Nog Review — Round 2

**Verdict:** ACCEPTED

Round 1's single finding is fixed, and fixed properly — at the identity, not at the
symptom. Rom also found the sibling lie living in the same three events and fixed that
too. I verified both on the live register and against nine synthetic event shapes no
fixture covers. Nothing new is broken.

##### The finding from round 1 — closed

**Was:** `server.js` composed `rounds` positionally, so `reviews[i]` became round `i + 1`
and a re-invoked review invented a round that never happened.

**Now:** `roundOf(ev, i)` (`server.js:2772-2775`) reads the event's own `round` field,
`reviewByRound` (`:2808-2814`) folds repeated invocations of one round into a single
review stage, the loop is sized by `Math.max(dones.length, highestReviewRound)`
(`:2821`), and a round with neither a build nor a review is dropped (`:2834`) instead of
drawn as an empty line.

Verified the way the finding was raised — the shipped `buildStagesById` lifted out of
`dashboard/server.js` and run over the **live** `bridge/register.jsonl` through the real
`lifecycle-translate` shim:

| Slice | Round 1 code | Round 2 code |
|---|---|---|
| 401 | 2 rounds; `Build · Sam · round 2  —  —  —` | 1 round + this review's round 2, both real |
| 163 | round 1, build null | round 2, build null — the round it actually was |
| 399 | build 2m 23s / review 3m 38s ACCEPTED / qa 9m 29s / queued 1s / elapsed 6m 13s | unchanged |
| 400 | elapsed 17m 05s | unchanged |

The brief's ground-truth table for 399 and 400 still reproduces to the millisecond.

**The second lie, which Rom found and I had not.** The old invocation→decision cursor let
an **abandoned** invocation claim the verdict its replacement earned. On slice 401's own
register that reported Jordan's review as 21m 43s (00:37:42 → 00:59:25) for a review that
ran 6m 59s (00:52:25 → 00:59:25). The cursor now refuses a decision at or after the *next*
invocation (`:2788`), so the reported review is the run that reached the verdict. This was
a real defect of the same class as the `2m` the slice exists to replace, and finding it
inside the fix for the round-identity bug is the right instinct — same three events, same
wrong assumption.

##### Adversarial probe

I drove `stagesForSlice` over nine shapes, not just the fixture. The ones that matter:

| Shape | Result | |
|---|---|---|
| re-invoke r1, **first** invocation got the verdict | 1 round, the decided run wins | ✓ |
| re-invoke r1 abandoned, second decided (live 401) | 1 round, 300s review | ✓ |
| three invocations of r1, last decided | 1 round | ✓ |
| round 2 re-invoked after a real round 1 | 2 rounds, r2 keeps the decided run | ✓ |
| review only, no DONE, round 2 (live 163) | 1 round numbered 2 | ✓ |
| round numbers skip r1 → r3 | 3 rounds, middle one build-only | acceptable — see flag 2 |
| two DONEs, both reviews tagged round 1 | one verdict is dropped | see flag 2 |

The fold rule reads correctly in all of them: `!prev || closed(rev) || !closed(prev)` keeps
the run that reached a verdict and lets a later try supersede an unfinished one.

##### AC Check

All seven carried over from round 1, where I verified each against the live register
rather than the fixture. Re-checked this round; none regressed.

- **slice-401-ac-1** → **✓ Satisfied** — every `recent[]` row carries `stages`; the four
  pinned row fields untouched. Trap 1's owner `j-inspect-slice-history.test.js` unmodified
  and green.
- **slice-401-ac-2** → **✓ Satisfied** — 399 still reports 143982 / 218853 ACCEPTED /
  569327 / 1714 / 373572, on the fixture *and* on the live register.
- **slice-401-ac-3** → **✓ Satisfied** — missing spans null, never 0 or negative;
  `totals.missing` names the roles.
- **slice-401-ac-4** → **✓ Satisfied** — `6m 13s`, `540k`, `$1.07 partial`; no estimate.
- **slice-401-ac-5** → **✓ Satisfied** — build / review / qa / queued / total with `—`.
- **slice-401-ac-6** → **✓ Satisfied** — re-ran my own broader duplicate scan: 239
  declarations on the branch, **zero** duplicates; `main` still carries three.
- **slice-401-ac-7** → **✓ Satisfied, and now for the right reason.** 910 still shows two
  rounds with summed totals; 913 (slice 401's own shape) shows **one**. Last round this AC
  passed on the fixture while the derivation was wrong; it now passes on the derivation.

##### Code Quality Findings

None that warrant rework. Two behaviours worth recording, neither reachable in the live
pipeline and both strictly better trades than round 1 — see flags 2 and 3.

The new code reads well: `roundOf`, `closed`, `reviewByRound`, `highestReviewRound` all
announce intent; the comments say *why* (the 401 register, the 21m-for-7m read) rather than
restating the code; nesting stays at three levels; no new dependency; no dead binding left
behind by the edit. Rom's comment naming `round: 0` as the auto-accepted merge is accurate
(`orchestrator.js:6505`) — though that round-0 event is a `NOG_DECISION`, which `roundOf`
never sees, so the guard is defensive rather than load-bearing. Harmless.

**Linting:** PASS — no eslint config in the repo; `node -c` clean on all four changed JS
files and the page's inline script block parses as a unit.

##### Safety-net tests / screen hooks

**PASS.**

- **Count unchanged at the lane target:** 7 criterion + 3 trap = 10. Rom added assertions
  to the existing `slice-401-ac-7` test rather than an eleventh, which is the correct call
  — the re-invoked shape is the other side of that criterion, not a criterion of its own.
- **Fixture 913 is slice 401's own live register, event for event.** A fixture copied from
  the failure that was actually observed is worth more than one invented to fit the fix.
- **Break-it check is honest and specific:** round-1 code restored, `slice-401-ac-7` goes
  RED with `one build and one decided round is one round, not two — 2 !== 1`, the other
  nine correctly stay green. He also avoided `git stash` because the stack is shared across
  worktrees, and said so.
- **Nothing weakened.** I diffed round 2's test changes for deletions: zero. Additive only,
  so no Test-Update Gate trailer is required, and `## Tests moved or weakened` correctly
  says "None this round."
- **Tags and hashes:** re-computed all ten `@ac-hash` lines with `build-ac-manifest.js`'s
  own `normalizeAcText` + sha256 against the commit trailers — **10/10 match**.
- **Screen hooks:** unchanged and all still present in the shipped page — `data-history-id`,
  `.col-duration|tokens|cost`, `.cost-partial`, `#history-expand-N`, `#history-chevron-N`,
  `.history-stages`, `[data-stage]`, `.history-stage-role|time|tokens|cost|verdict|total`.
  Rom's new note for Julian — `data-stage` keys carry the **real** round number, so a
  wiped-register slice can have `build-2` with no `build-1`, select by key and never by
  position — is exactly the kind of hook-contract change that needs saying out loud.
- **Report shape:** all seven required headings present.

Test runs: the slice's file 10/10; with trap 1's owner and the two files Task 4 touched,
29/29.

##### Scope

Clean. Four files this round: the two product files, the test file, the DONE report.
The `lcars-dashboard.html` change is one line — `many` now also labels a lone round that
is not round 1 — and it is the display half of the same defect, named under
`## What changed`. In scope. No `e2e/` change. No `bridge/orchestrator.js` change, as the
brief required.

Rom correctly left all five of round 1's O'Brien flags alone and said why: they are spec
decisions, not his to make inside an amendment round. That is the right boundary.

##### Flags (not findings)

**For Julian's stage:**

1. **The new label branch has no safety-net coverage.** `historyStagesHtml`'s
   `rounds.length === 1 && rounds[0].round !== 1` is live in production — slice 163 hits
   it today — but no fixture in the file produces a lone non-1 round, so the branch never
   goes red. I confirmed it behaves correctly by running 163 through the shipped code; it
   is a one-line cosmetic label and not worth a round trip, but a browser test on a
   wiped-register row would close it.
2. Carried from round 1 and still open: the test stubs `lifecycle-translate` with a
   pass-through and writes `id:` directly, while the live register writes `slice_id:`; and
   `e2e/seed-fixture.js`'s history slice has no approval / QA / squash events, so a seeded
   row shows `—` for TIME, queue and total.
3. `server.js` changes are inert until the dashboard restarts. Restart, then hard-reload.

**For O'Brien:**

4. **Two event shapes degrade, neither reachable today.** (a) Two DONEs whose reviews are
   *both* tagged round 1 fold into one round and the earlier verdict is dropped — this
   would need a PARKED review-section write to fail after a completed review; it has never
   occurred, and round 1's code was only more accurate here at the cost of being wrong on
   the shape that *did* occur. (b) A `NOG_DECISION` with an unparseable `ts` now loses its
   verdict instead of showing it with a null duration; `registerEvent` always stamps a
   valid ISO timestamp, so this needs a corrupt register line. Recording both so the next
   person to touch this reads them deliberately rather than rediscovering them.
5. **Builds are still numbered positionally**, because `DONE` carries no `round` field
   (confirmed against the live register: 0 of 4 DONE events have one). The brief prescribes
   this — "the nth DONE event is build round n" — and there is no alternative without an
   orchestrator change, which the brief forbids. The consequence: a slice whose earlier
   `DONE` was lost to the wipe shows its surviving build under round 1 and its review under
   round 2, split across two lines. If that matters, giving `DONE` a `round` field is the
   follow-up, and it belongs with the slice that records Jordan's and Julian's tokens.
6. Round 1's flags 1–5 stand unchanged and are still yours: `approvedAt` under-reporting
   the queue wait on a re-approval, `totals.missing` being role-level rather than
   stage-level, the literal Sam/Jordan/Julian labels against the mode-aware ROLE map, rows
   getting emptier before they get fuller, and `NOG_TELEMETRY` as the home for the
   follow-up slice's numbers.

## Rom's DONE report

### Amendment round 1 — rounds are numbered by the round each event names

#### Summary

Nog's one finding is fixed. `rounds` was composed positionally — `reviews[i]` became round
`i + 1` — so a re-invoked review invented a round that never happened. Slice 401's own live
register reproduced it: two `NOG_INVOKED round=1` (the first review never finished) against one
`DONE` produced `rounds.length = 2`, and the expanded row would have printed
`Build · Sam · round 2   —   —   —`.

The round number now comes from the `NOG_INVOKED`'s own `round` field, as Task 1 names it.
Repeated invocations of one round fold into a single review stage, and the array is sized by the
highest round anyone reached rather than by how many invocations were written.

Fixing the identity exposed a second, quieter lie in the same events: the old cursor let an
**abandoned** invocation claim the verdict that followed its replacement. On slice 401 that read
Jordan's review as 21m 43s (00:37:42 → 00:59:25) when he reviewed for 6m 59s (00:52:25 → 00:59:25).
A decision now closes the latest invocation before it, so the review that is reported is the run
that reached the verdict.

Verified on the live register, not only on the fixture, by lifting the shipped `buildStagesById`
through the real `lifecycle-translate` shim:

| Slice | Before | After |
|---|---|---|
| 401 | 2 rounds; review 1303178 ms | 1 round; review 419962 ms (6m 59s) REJECTED |
| 163 | round 1, build null | round 2, build null — the round it actually was |
| 399 | build 143982 / review 218853 ACCEPTED / qa 569327 / queued 1714 / elapsed 373572 | unchanged |
| 400 | elapsed 1025424 (17m 05s) | unchanged |

**A `server.js` change goes live only after the dashboard restarts.** Until then the page receives
rows with no `stages` and the three cells read `—`; the renderer guards for it. Restart the server
and hard-reload the tab.

Nog's five flags for O'Brien and three for Julian's stage are left where he put them — `approvedAt`
under-reporting the queue wait, `totals.missing` being role-level, and the literal role labels are
all spec decisions, not mine to make inside an amendment.

#### What changed

- `dashboard/server.js` — `stagesForSlice`, three changes in one place:
  - new `roundOf(ev, i)` reads the event's `round` field, falling back to position only when the
    field is absent or not a round number (the auto-accepted merge writes `round: 0`);
  - the invocation→decision cursor now refuses a decision that falls at or after the *next*
    invocation, so an abandoned run cannot claim its successor's verdict;
  - `reviewByRound` folds repeated invocations of one round into one review stage (the run that
    reached a verdict wins; an unfinished run is kept only while nothing closed that round), the
    loop is sized by `max(dones.length, highest round seen)`, and a round with neither a build nor
    a review is dropped instead of drawn as an empty line.
- `dashboard/lcars-dashboard.html` — one line in `historyStagesHtml`: the `· round N` label now
  also appears when the *only* round is not round 1. Slice 163's lone round-2 review was otherwise
  drawn as if it were the first round — the display half of the same defect.
- `regression/observability/j-history-tells-the-truth.test.js` — fixture slice **913**, slice 401's
  own live shape (one `DONE`, two `NOG_INVOKED round=1`, one `NOG_DECISION`), and the assertions
  for it inside the existing `slice-401-ac-7` test. No new test: the lane target is 10 and this is
  the other side of the criterion already under test, not a criterion of its own.

No `e2e/` file touched. No `bridge/orchestrator.js` change.

#### Acceptance criteria verification

All seven still pass, on the same command: `node --test regression/observability/j-history-tells-the-truth.test.js` → **10 tests, 10 pass, 0 fail**.

| Tag | Test file | Result |
|---|---|---|
| slice-401-ac-1 | `regression/observability/j-history-tells-the-truth.test.js` | pass — every row carries `stages`; `durationMs`/`tokensIn`/`tokensOut`/`costUsd` untouched |
| slice-401-ac-2 | same | pass — the 399 fixture still reports 143982 / 218853 accepted / 569327 / 1714 / 373572, and the **live** register agrees to the millisecond |
| slice-401-ac-3 | same | pass — missing is `null`, never 0 or negative; `missing` names the roles |
| slice-401-ac-4 | same | pass — `6m 13s`, `540k`, `$1.07 partial` |
| slice-401-ac-5 | same | pass — build / review / qa / queued / total, `—` where nothing was recorded |
| slice-401-ac-6 | same | pass — each top-level name declared once (239 declarations, zero duplicates) |
| slice-401-ac-7 | same | pass — **extended this round**: 910 still shows two rounds with summed totals, and 913 (two invocations of round 1) shows **one** round, timed from the run that reached the verdict |

Trap 1's owner, `regression/observability/j-inspect-slice-history.test.js`, is unmodified and green.
The two files Task 4 touched are green. All three together: **29 tests, 29 pass**.

#### Safety-net tests

Ten tests, unchanged in count — seven criterion tests plus three trap tests. This round added
assertions to the existing `slice-401-ac-7` test rather than an eleventh test.

**Break-it check for this round's fix.** I copied the fixed `server.js` and `lcars-dashboard.html`
aside, checked out the round-1 versions from `HEAD`, and ran the new test file against them
(no `git stash` — the stash stack is shared with the other worktrees):

- `slice-401-ac-7` → **RED**: `one build and one decided round is one round, not two — 2 !== 1`.
  That is Nog's finding, caught by the test.
- The other nine stayed green, correctly: round-1 code was already right about everything else,
  and Nog verified all ten red against `main` last round.

Files restored, all ten green again, and the live-register probe re-run after the restore to
confirm the shipped files are the fixed ones.

**What I saw without a browser.** The dashboard has not been restarted, so I checked the live data
the way Nog did instead of clicking: the shipped `buildStagesById`, lifted out of `dashboard/server.js`
and run over `bridge/register.jsonl` through the real `lifecycle-translate` shim. Slice 401 returns
one round with a 6m 59s REJECTED review; slice 163 returns its round 2; slices 399 and 400 return
the brief's table unchanged.

#### Screen hooks

Unchanged from round 1 — no hook was added, removed or renamed. The two the brief left to me:

- **slice-401-ac-4** (the row's cells) — `[data-history-id="<id>"]`, and within it `.col-duration`,
  `.col-tokens`, `.col-cost`; `.cost-partial` wraps the cost when a role's numbers are missing
  (visible whenever the row is drawn; `.cost-partial` only when `totals.missing` is non-empty).
- **slice-401-ac-5** (the expanded row) — `#history-expand-<id>` with `#history-chevron-<id>`;
  inside it `.history-stages` holding one `.history-stage-line[data-stage]` per stage, keyed
  `build-<n>`, `review-<n>`, `qa`, `queued`, `total`, each with `.history-stage-role`,
  `.history-stage-time`, `.history-stage-tokens`, `.history-stage-cost`; `.history-stage-verdict`
  inside the review line; `.history-stage-total` on the last line. Visible after the row is clicked.

One note for Julian, from this round's change: `data-stage` keys carry the **real** round number, so
a slice whose earlier rounds predate the register wipe can have `build-2` with no `build-1`. Select
by the key you expect, never by position.

#### Tests moved or weakened

None this round. No existing test was moved, renamed, weakened or removed; the only test edit is
additive — a fixture slice and new assertions inside a test that already existed. Round 1's two
`extractFn` lifts in `j-history-chronological-order.test.js` and `j-ten-rows-a-page.test.js` are
unchanged and still green.

#### Commit

Branch `slice/401`, on top of round 1's `f12d6db`. The AC trailers are declared on the commit.

## Nog's verdict and review

_None recorded._

## Julian's result

_Julian's stage has not recorded a result for this slice yet._
