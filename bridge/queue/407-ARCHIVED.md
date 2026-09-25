---
id: "407"
title: "Files Julian's stage leaves behind never block a landing"
from: rom
to: nog
status: DONE
slice_id: "407"
branch: "slice/407"
completed: "2026-09-25T22:20:22.000Z"
tokens_in: 148
tokens_out: 82837
elapsed_ms: 3104213
estimated_human_hours: 5.0
compaction_occurred: false
tokens_cache_read: 8504029
cost_usd: 8.0119915
---

<!-- ds9:sticker v1 -->

# Files Julian's stage leaves behind never block a landing — slice record

The whole sticker: the brief with every review round, the builder's report, the
reviewer's verdict, and Julian's result. This file is the slice's permanent record.

## Brief (with every review round)

---
id: "407"
title: "Files Julian's stage leaves behind never block a landing"
goal: "Whatever Julian's stage leaves uncommitted in the working tree is moved aside when the stage ends, so the next landing never fails on it."
from: obrien
to: rom
priority: critical
lane: core
created: "2026-09-25T21:10:18.780Z"
timeout_min: 25
status: "QUEUED"
approval_provenance: "human-click"
approval_ts: "2026-09-25T21:12:26.076Z"
approval_sig: "fe2b51b9e4a667da0a619e7db474b13e0180b05d2e23109944be7ab886cc67df"
rom_session_id: "ce0d94ee-7768-476d-bced-66804a909462"
rounds:
  - round: 1
    attempt_number: 1
    commissioned_at: ""
    done_at: "2026-09-25T22:20:22.000Z"
    durationMs: 3104213
    tokensIn: 148
    tokensOut: 82837
    costUsd: 8.0119915
    nog_verdict: "NOG_DECISION_ACCEPTED"
    nog_reason: "All seven ACs met and the intent achieved — the sweep runs inside settle before finishQaStage's synchronous drain, which is what actually unblocks the next landing; all seven @ac-hash values recompute, 7/7 new tests pass, the untouched neighbour still passes 13/13, and scope is exactly the two expected files plus the DONE report."
total_durationMs: 3104213
total_tokensIn: 148
total_tokensOut: 82837
total_costUsd: 8.011992
round: 1
---

### Files Julian's stage leaves behind never block a landing

<!-- Lane: core. Changes what the orchestrator does when Julian's stage ends (docs/adr/ADR-PROOF-LANES.md §2). -->

#### Goal

Philipp, 2026-09-24: Julian must never hold up a landing. Philipp, 2026-09-25, on the third blocked landing: "do you need my help or do you understand and fix yourself?"
After this lands, whatever Julian's stage leaves uncommitted in the working tree is moved aside when the stage ends, so the next landing never fails on it.

#### Context

- Three of three Julian stages since the 09-24 restart ended `stage_error` / `heartbeat_stale` (401, 368, 396; `bridge/state/qa-stage-<id>.json`) and left an untracked `e2e/*.spec.js` in the working tree.
- The landing then refuses: `bridge/orchestrator.js:9217` `uncommitted lock-deriver inputs in the working tree: …` (`isLockDeriverInput` :9029, `porcelainPaths` :1397). This blocked 402 (by `e2e/history-truth.spec.js`) and 397 and 405 (by `e2e/streamed-session.spec.js`). That guard is right and stays: a stray file must not be written into the locks.
- Julian's stage: `startQaStage` :8374; he runs in `PROJECT_DIR`, the same working tree the landing uses (`defaultQaSpawn` :8521). The stage ends through `settle` (:8478), which is called on heartbeat_stale (:8495), timeout (:8503), exit (:8507) and spawn error (:8509). `settle` runs right after `child.kill('SIGTERM')`, so Julian may still write a file after it.
- The working tree is shared (a person, Sam's autocommit before checkout), so only what Julian created or changed during the stage is his; moving a tracked file would delete a committed test, hence ac-4 and ac-5.
- The files moved by hand so far are in `bridge/quarantine-2026-09-24/` (README there).
- Restart the daemon after landing: `launchctl kickstart -k gui/$(id -u)/dev.denorios.orchestrator`.

#### Out of scope

- Proposed follow-up: why Julian's heartbeat goes stale every time (the file-mtime check at :8488-8497). ADR-JULIAN-ALONGSIDE (Proposed) rebuilds Julian's stage; fixing it here may be thrown away.
- Not planned: running Julian in his own worktree. That is ADR-JULIAN-ALONGSIDE step D.
- Not planned: any change to the landing's dirty-input guard at :9205-9218.
- Not planned: moving the three files already in `bridge/quarantine-2026-09-24/`.

#### Tasks

1. `bridge/orchestrator.js` `startQaStage` (:8374): when the stage starts, record which lock-deriver inputs are already uncommitted in the working tree (use `git status --porcelain -uall`, `porcelainPaths` and `isLockDeriverInput`, as the guard at :9205-9218 does).
2. When the stage has ended and Julian's process has exited (or 10 seconds after the stage ended, if it has not), move every lock-deriver input that is uncommitted now and was not in the start set to `bridge/quarantine/qa-<id>/`, keeping its path under that folder, and write one register event `QA_LEFTOVERS_QUARANTINED` with `slice_id` and `paths`.

Write one safety-net test per acceptance criterion, plus one for each trap, then stop.

#### What Rom does not do

- Rom writes safety-net tests as the brief's lane says: core lane, one per acceptance criterion plus one per trap; surface lane, only where a criterion asserts behaviour. Then he stops.
- Rom never writes or commits a browser test (a *.spec.js under e2e/). Browser tests are Julian's, written after the slice is on dev.
- Rom never runs the full safety-net suite and never the browser suite. He runs only the test file he wrote. GitHub runs the safety-net suite when the slice lands on dev; the Promote button runs both.
- Rom may look in a browser to check his own work and says what he saw under ## Safety-net tests. He does not prove it with a test.
- Core lane only: before committing, Rom stashes his fix, runs his new test file, confirms every new test goes red, restores the fix, and lists which tests went red under ## Safety-net tests.
- Rom moves his own safety-net tests when his change requires it and lists every move under ## Tests moved or weakened. He never edits a browser test.

#### Acceptance criteria

- slice-407-ac-1: When Julian's stage ends with heartbeat_stale, timeout, a non-zero exit or a spawn error, and it created an untracked file e2e/x.spec.js during the stage, that file is no longer in the working tree, it is at bridge/quarantine/qa-<id>/e2e/x.spec.js with identical content, and one QA_LEFTOVERS_QUARANTINED event with that slice_id lists "e2e/x.spec.js" in paths.
- slice-407-ac-2: The same holds when the stage ends recorded (exit 0) and Julian left an untracked lock-deriver input uncommitted.
- slice-407-ac-3: A file Julian writes after the stage has ended but before his process exits is quarantined too; if his process has not exited 10 seconds after the stage ended, whatever is uncommitted at that moment is quarantined then.
- slice-407-ac-4: A lock-deriver input that was already uncommitted when the stage started stays where it is and unchanged by the stage's cleanup, and is not listed in the event, whether or not it changed during the stage.
- slice-407-ac-5: A tracked lock-deriver input that Julian modified and did not commit is restored to its committed content in the working tree, and his modified version is at bridge/quarantine/qa-<id>/<path>.
- slice-407-ac-6: Uncommitted files that are not lock-deriver inputs (for example bridge/state/bashir-heartbeat.json or regression/TEST-DRIFT.json) are left untouched; a stage that leaves no new lock-deriver input writes no QA_LEFTOVERS_QUARANTINED event.
- slice-407-ac-7: After a stage that left e2e/x.spec.js ends, the next landing of an accepted slice squashes to dev without a lock_regen_failed error.

#### Files expected to change

- bridge/orchestrator.js (modified)
- one new safety-net test file under regression/ (added)

#### REQUIRED — declare the ACs as commit trailers

    AC: slice-407-ac-1: When Julian's stage ends with heartbeat_stale, timeout, a non-zero exit or a spawn error, and it created an untracked file e2e/x.spec.js during the stage, that file is no longer in the working tree, it is at bridge/quarantine/qa-<id>/e2e/x.spec.js with identical content, and one QA_LEFTOVERS_QUARANTINED event with that slice_id lists "e2e/x.spec.js" in paths.
    AC: slice-407-ac-2: The same holds when the stage ends recorded (exit 0) and Julian left an untracked lock-deriver input uncommitted.
    AC: slice-407-ac-3: A file Julian writes after the stage has ended but before his process exits is quarantined too; if his process has not exited 10 seconds after the stage ended, whatever is uncommitted at that moment is quarantined then.
    AC: slice-407-ac-4: A lock-deriver input that was already uncommitted when the stage started stays where it is and unchanged by the stage's cleanup, and is not listed in the event, whether or not it changed during the stage.
    AC: slice-407-ac-5: A tracked lock-deriver input that Julian modified and did not commit is restored to its committed content in the working tree, and his modified version is at bridge/quarantine/qa-<id>/<path>.
    AC: slice-407-ac-6: Uncommitted files that are not lock-deriver inputs (for example bridge/state/bashir-heartbeat.json or regression/TEST-DRIFT.json) are left untouched; a stage that leaves no new lock-deriver input writes no QA_LEFTOVERS_QUARANTINED event.
    AC: slice-407-ac-7: After a stage that left e2e/x.spec.js ends, the next landing of an accepted slice squashes to dev without a lock_regen_failed error.

---

#### Nog Review — Round 1

**Verdict:** ACCEPTED

Reviewed the diff (`81f23e1..741b09e`), not the report. Ran the new test file and the one
untouched neighbour that drives the same function. No suite, no browser suite, no lock builder.

##### AC Check

- **slice-407-ac-1** (all four bad endings → file gone, at `bridge/quarantine/qa-<id>/e2e/x.spec.js`, one event) → ✓ Satisfied. All four endings route through the one `settle` (`bridge/orchestrator.js:8615`): heartbeat_stale :8676, timeout :8687, non-zero exit :8691, spawn error :8697. `settle` sweeps at :8622 before anything else. Quarantine path is `path.join('bridge','quarantine',`qa-${id}`)` + the original rel path (:8409–8411, :8437). Event carries `slice_id` and `paths` (:8465). The test drives all four for real — the stale clock and the cap are turned down, not simulated — and asserts the recorded `outcome`/`detail` so each row proves which ending ran.
- **slice-407-ac-2** (exit 0 / `recorded`) → ✓ Satisfied. Same `settle`; the test asserts `outcome === 'recorded'`, so it cannot pass by accident on an error path.
- **slice-407-ac-3** (written after the stage ends, before exit; else swept 10s after the stage ended) → ✓ Satisfied. `child.on('exit')` calls `finalSweep('julian_exited')` after `settle` (:8693). `armFinalSweep()` is called inside `settle` (:8623), so the 10s grace is measured from the stage ending, which is exactly what the criterion says. `QA_LEFTOVER_GRACE_MS = 10 * 1000` (:8331). Both halves are driven.
- **slice-407-ac-4** (already-dirty paths untouched and unclaimed) → ✓ Satisfied. Baseline recorded at :8515–8524, before the packet; `already.has(rel) → continue` at :8432. Test covers both flavours — an untracked file that changes again during the stage, and a modified tracked file — and asserts the event lists only Julian's own path.
- **slice-407-ac-5** (tracked modified → committed content back, his version kept) → ✓ Satisfied. `git checkout HEAD --` at :8454 after the copy at :8442. Test asserts the committed body is back, his body is at the quarantine path, and `git status --porcelain` for that path is empty.
- **slice-407-ac-6** (non-inputs untouched; clean stage writes no event) → ✓ Satisfied. `isLockDeriverInput` (:9208) excludes `regression/TEST-DRIFT.json` and `bridge/state/bashir-heartbeat.json`; the event is guarded by `if (moved.length)` (:8463) and `mkdirSync` only runs inside the loop, so no folder appears either.
- **slice-407-ac-7** (next landing squashes without `lock_regen_failed`) → ✓ Satisfied. The test runs the real `regenerateLocksAtLanding` with Julian still alive and no exit emitted — the drain's actual situation — and carries a negative control that puts an unswept `e2e/y.spec.js` back and matches the error by name, so the guard is proven still intact rather than merely quiet. Verified independently that the quarantine folder cannot become the next blocker: `bridge/quarantine/…` is not an `isLockDeriverInput`, the only other porcelain guards are the lock-file check at :9423 and `autoCommitDirtyTree`, and that one drops `??` lines and uses `git add -u`, so an untracked quarantine file can never be committed by the pipeline.

**@ac-hash:** all seven recomputed with the repo's own `acHashOf` (`scripts/build-ac-manifest.js:52-57`) against the seven `AC:` trailers on `2304633`. **All seven match.** Trailers are the final paragraph with `Co-Authored-By` in the same block, so they parse.

##### Intent

Achieved, and Rom found the thing the brief's own ordering would have missed. `finishQaStage`
ends with a synchronous `drainDeferredAfterGate()` (`bridge/orchestrator.js:8770`), and the
whole chain `settle → finishQaStage → drain → squashSliceToDev → regenerateLocksAtLanding` is
plain synchronous code — no `async`, no `await`. A sweep that only ran on Julian's exit or
after a 10s grace could not have fired before that landing, so the next landing would have
failed exactly as 402, 397 and 405 did. Sweeping inside `settle` before `finishQaStage` is
what actually makes ac-7 true. The guard was right and is untouched; what was missing was
someone tidying the tree, and that is what shipped.

I checked the inverse risk specifically, because it would have been a real corruption bug:
the grace `setTimeout` firing mid-landing and running `git checkout HEAD -- <lock>` against a
half-built index. It cannot — the drain never yields the event loop, so the timer can only run
after the landing has returned.

##### Code Quality Findings

None blocking. `dirtyLockDeriverInputs` (:8383) is a faithful mirror of the landing guard at
:9385 — same `-uall`, same `porcelainPaths`, same `isLockDeriverInput` — so the two cannot
drift on what counts as dirty. Copy-before-clear (:8442 before :8444/:8454) is the right order.
A baseline that fails to read disables the sweep instead of defaulting to empty (:8519), which
is the right failure mode for a shared tree. `settle` referencing `sweepLeftovers`/`armFinalSweep`
from above their `const` declarations is safe — it is only ever invoked from async callbacks,
the same pattern the existing code already uses for `heartbeatPoll` and `absoluteTimeout`.

**Linting:** PASS — no eslint config in the repo; `node --check` passes on both changed files.

**Safety-net tests / screen hooks:** PASS. 7 tests, 7 criteria, 0 traps (the brief lists none) —
the right count. Every test carries its `slice-407-ac-N` tag in the title and its `@ac-hash`
line. Break-it list present, 7 red of 7, with the reason each one failed. Ran the file myself:
7/7 pass, 8.4s. Ran the untouched neighbour `j-julian-stage-in-qa.test.js`: 13/13 pass, Rom's
claim confirmed. `## Screen hooks` correctly says None — nothing here reaches the dashboard, and
`QA_LEFTOVERS_QUARANTINED` is rightly not added to `STAGE_EVENTS` (`dashboard/server.js:2782`),
which is stage timing only. All seven report headings present. No test moved, weakened or
skipped, so no Test-Update trailer is owed and none is present.

Rom rewriting ac-6 after it stayed green with the fix removed, and saying so in the report, is
the break-it round doing its job. Recorded here so it is not lost.

##### Scope

Exactly the three expected files. 718 insertions, 7 deletions — and all seven deletions are
lines their seam-aware replacements supersede, plus the exports line. Nothing lost. The four
liveness seams (`heartbeatPath`, `heartbeatStaleMs`, `heartbeatPollMs`, `timeoutMs`) go beyond
the brief's two tasks, but they are named and justified under `## What changed`, default to the
live constants, and are confined to the function this slice changes. Without `heartbeatPath` a
test driving this stage would write the real `bridge/state/bashir-heartbeat.json` and make a
dead session look alive. Accounted for, not creep.

No `e2e/` file was written, edited or committed. The `e2e/x.spec.js` the criteria name is a
one-line fixture inside a tmpdir.

##### Flags (not findings)

1. **For O'Brien — two leftover shapes the sweep does not clear.** A tracked deriver input Julian *deletes* (` D regression/foo.test.js`) is skipped at :8435 (`!fs.existsSync → continue`), and one he `git add`s without committing (`A  e2e/new.spec.js`) reads as tracked at :8388, so :8454 runs `git checkout HEAD --` against a path not in HEAD, which fails; the catch logs a warning and the file stays in both the tree and the index. Either would still block the next landing. Neither is named by any AC, and `bridge/templates/bashir-prompt.md` never tells Julian to `git add` or delete anything — his write scope is creating and extending files under `e2e/` — so the observed shape (3/3 stages: an untracked `e2e/*.spec.js`) is fully covered. Worth a follow-up brief, not rework here.
2. **For O'Brien — `bridge/quarantine/` has no retention policy.** It is deliberately not gitignored (the report explains why: Philipp should see it), and it is not in `PIPELINE_OWNED_PREFIXES` (`bridge/state/seed-runtime-state.js:175`), so it accumulates one untracked folder per littering stage and stays in `git status` forever. Harmless — nothing can commit it and nothing reads it — but it will grow.
3. **For O'Brien — ac-3's break-it row proves less than it reads.** The first assertion in that test reads `QA_LEFTOVER_GRACE_MS` off the module, so with the fix removed the test aborts there and neither behavioural half ever ran. The test is not hollow — both halves `waitFor` a quarantine path only the sweep can create, so both would have timed out red — but putting the constant check last would have made the row mean what it says.
4. **Minor — new stderr noise.** `execSync` at :8385 has no `stdio`, so git's stderr reaches the parent's. Running `j-julian-stage-in-qa.test.js` now prints two bare `fatal: not a git repository` lines from step 1b against its non-repo fixture. It matches the landing guard's shape at :9385 exactly, so it is convention rather than a defect, but a future reader will wonder whether something failed.
5. **For Julian.** The second sweep runs *after* the drain, so anything a landing itself left dirty in a deriver path would be quarantined under this stage's slice id. Non-destructive — the content is copied before it is cleared — and I could not construct a case where a successful landing leaves one, but it is the one place the event's `slice_id` could name a stage that did not write the file.

## Rom's DONE report

#### Summary

Julian's stage now clears up after itself. When the stage ends, every lock-deriver input that is uncommitted in the working tree and was **not** already uncommitted when the stage started is moved to `bridge/quarantine/qa-<id>/<path>` and recorded as one `QA_LEFTOVERS_QUARANTINED` register event. Nothing is deleted: an untracked file is moved, a tracked file is moved and the committed content put back. The landing's dirty-input guard (`regenerateLocksAtLanding` step 1, `bridge/orchestrator.js:9205-9218`) is untouched — it was right, and 402, 397 and 405 were blocked by it correctly. What was missing was anyone tidying the tree.

One thing the brief's ordering does not cover, which I found while reading the end of the stage and have built for: `finishQaStage` finishes by calling `drainDeferredAfterGate()`, which squashes the slices that deferred behind the stage **in the same tick**. So the very next landing can run before Julian's process has exited and before any 10-second grace. A sweep that only ran after his exit would still have let that landing fail. The clear-up therefore runs twice — once the instant the stage ends (so the drain sees a clean tree) and once when he is actually gone, or after the grace if he never is. Both passes are no-ops when there is nothing of his to move, so ac-1 and ac-2 still produce exactly one event, and ac-3's late-write case is caught by the second pass exactly as the criterion describes. This is additive to task 2, not instead of it.

#### What changed

- `bridge/orchestrator.js`
  - `dirtyLockDeriverInputs(cwd)` (new): the uncommitted lock-deriver inputs in a tree, read the way the landing's own guard reads them — `git status --porcelain -uall`, `porcelainPaths`, `isLockDeriverInput` — plus whether each path is untracked, taken off the XY code. The raw output is deliberately not trimmed (trimming eats the lead space off the first line and would read ` M x` as untracked).
  - `quarantineQaLeftovers(id, startSet, opts)` (new): copies each leftover to `bridge/quarantine/qa-<id>/<path>` and then clears it — `fs.rmSync` plus `git rm --cached --ignore-unmatch` for an untracked file, `git checkout HEAD --` for a tracked one. Copy before clear, so a failure leaves the content in both places rather than nowhere. Paths in `startSet` are skipped. Writes `QA_LEFTOVERS_QUARANTINED` (`slice_id`, `paths`, `dir`, `reason`) only when something moved.
  - `startQaStage` step 1b (new): records the baseline of already-uncommitted lock-deriver inputs at the start of the stage. A read that **fails** leaves the baseline null and disables the sweep entirely — an empty baseline would read a person's unfinished test as Julian's litter and move it.
  - `startQaStage` liveness block: `settle` now sweeps and arms the second pass before recording the stage; `child.on('exit')` runs the final pass; a `QA_LEFTOVER_GRACE_MS` (10s) timer is the backstop for a process that never exits. The grace timer is `unref`'d so a stage ending never holds the daemon open on its own account.
  - `QA_LEFTOVER_GRACE_MS` (new constant, 10s) and `opts.leftoverGraceMs` (seam).
  - Test seams, needed to test this at all and flagged here as the one thing beyond the two tasks: `opts.heartbeatPath`, `opts.heartbeatStaleMs`, `opts.heartbeatPollMs`, `opts.timeoutMs`, all defaulting to today's constants. Without the first, a test that drives the stage with a child writes the **real** `bridge/state/bashir-heartbeat.json` — a tracked file whose mtime is what tells the daemon whether a Julian is alive — and without the other two the `heartbeat_stale` and `timeout` endings ac-1 names could not be driven at all (30s poll, 60min cap). No behaviour changes when they are absent.
  - Exports: `quarantineQaLeftovers`, `dirtyLockDeriverInputs`, `QA_LEFTOVER_GRACE_MS`.
- `regression/gate-merge/j-qa-leftovers-quarantined.test.js` (new): seven tests, one per criterion. No `e2e/` file was written, edited or committed; the `e2e/x.spec.js` the criteria name is a one-line fixture file inside a throwaway tmpdir, created and destroyed by the test.

Not changed, deliberately: the landing's dirty-input guard, the three files already in `bridge/quarantine-2026-09-24/`, and `.gitignore` — the quarantine folder stays visible in `git status` on purpose, so a stage that left something behind is something Philipp can see. It is under `bridge/`, so neither lock deriver walks it (`walkTests` roots at `regression/`, `walkSpecs` at `e2e/`) and it can never become the next blocker; ac-7 asserts that.

#### Acceptance criteria verification

Command for every row: `node --test regression/gate-merge/j-qa-leftovers-quarantined.test.js`. All seven pass; nothing else was run.

| Criterion | Test file | Result |
|---|---|---|
| slice-407-ac-1 | `regression/gate-merge/j-qa-leftovers-quarantined.test.js` | PASS — all four endings driven for real: `heartbeat_stale` (stale clock turned down), `timeout` (cap turned down), non-zero exit, spawn error. Each asserts the file gone from the tree, identical content at `bridge/quarantine/qa-99407/e2e/x.spec.js`, `git status` clean at that path, exactly one event with that `slice_id` and `paths`, and the recorded `outcome`/`detail` proving which ending ran. |
| slice-407-ac-2 | same | PASS — exit 0, outcome `recorded`, an untracked `regression/qa-left-this.test.js` quarantined with its event. |
| slice-407-ac-3 | same | PASS — (a) the stage ends, no event yet, the file is written **then**, his process exits, the file is quarantined; (b) he never exits, the file appears after the stage ended, the grace sweeps it and the event's `reason` is `grace_expired`. The shipped default is asserted to be 10 000 ms, read off the module. |
| slice-407-ac-4 | same | PASS — an untracked spec and a modified tracked test both already dirty before the stage: the spec keeps the change it gained during the stage and stays put, the tracked edit is not reverted, neither is in the quarantine, and the event lists only Julian's own file. |
| slice-407-ac-5 | same | PASS — the tree holds the committed content again, his version is at the quarantine path, and `git status --porcelain` for that path is empty. |
| slice-407-ac-6 | same | PASS — two stages. One where a real leftover **is** swept alongside `regression/TEST-DRIFT.json` and the stage's own `bridge/state/bashir-heartbeat.json` (both untouched, neither in the event), proving the sweep ran and still left them; one that leaves only those two, which writes no event and creates no quarantine folder. |
| slice-407-ac-7 | same | PASS — the stage ends on a stale heartbeat with Julian still alive (no exit emitted — the drain's real situation), then `regenerateLocksAtLanding` returns `{ success: true }` with no ERROR event, and the quarantined copy is still on disk without blocking it. Negative control in the same test: an unswept `e2e/y.spec.js` still fails `lock_regen_failed: uncommitted lock-deriver inputs`, by name. |

#### Safety-net tests

Seven tests, one per criterion. The brief lists no traps, so there are no trap tests.

`regression/gate-merge/j-qa-leftovers-quarantined.test.js` — every fixture is a throwaway git repo in a per-test tmpdir with the orchestrator's queue, staged and trash dirs, register file, project dir, gate mutex, spawn, heartbeat file and both liveness clocks redirected into it. Slice id `99407`, far outside the live range. After the full run `git status` in this worktree shows only my two files: nothing here touched live state, and in particular nothing wrote the real `bashir-heartbeat.json`.

Break-it round (core lane), fix set aside with `git checkout HEAD -- bridge/orchestrator.js`, checksum-verified on restore:

| Test | With the fix removed |
|---|---|
| slice-407-ac-1 | RED — `timed out waiting for heartbeat_stale: e2e/x.spec.js to be quarantined` |
| slice-407-ac-2 | RED — `timed out waiting for the leftover to be quarantined` |
| slice-407-ac-3 | RED — `AssertionError: the grace the criterion names is ten seconds` |
| slice-407-ac-4 | RED — `timed out waiting for his own file to be quarantined` |
| slice-407-ac-5 | RED — `timed out waiting for the modified test to be quarantined` |
| slice-407-ac-6 | RED — `timed out waiting for the sweep to run` |
| slice-407-ac-7 | RED — `timed out waiting for the stage to end` |

7 red of 7, then 7 green of 7 with the fix back (`shasum -c` confirmed the restored file is byte-identical).

Worth recording, because the first version of the suite was weaker: ac-6 originally asserted only absences — nothing moved, no event — and it stayed **green** with the fix removed, since nothing moving is exactly what the broken code does. I rewrote it with a positive control in the same criterion (a real leftover swept alongside the files that must not be) and it now goes red. That is the whole point of the break-it round, and it caught a test that proved nothing.

I did not look in a browser: this slice has no screen surface.

#### Screen hooks

None. Nothing in this slice reaches the dashboard. The new register event `QA_LEFTOVERS_QUARANTINED` is not rendered anywhere and this slice does not ask for it to be.

#### Tests moved or weakened

None. No existing test was moved, renamed, changed or removed. `regression/gate-merge/j-julian-stage-in-qa.test.js` still passes untouched — it drives `startQaStage` with `spawn: () => null`, which returns before the liveness block, so the new seams and the sweep never come into play there.

#### Commit

- `2304633` — Files Julian's stage leaves behind never block a landing (`bridge/orchestrator.js`, `regression/gate-merge/j-qa-leftovers-quarantined.test.js`), carrying all seven `AC:` trailers as the final paragraph, verified with `git log -1 --format='%(trailers:key=AC,valueonly)'`.
- Branch `slice/407`, cut from dev at `81f23e1` (dev has since moved to `ea8f550`). Not merged.
- The daemon needs a restart after this lands: `launchctl kickstart -k gui/$(id -u)/dev.denorios.orchestrator`.
- `regression/*.lock` untouched and neither lock script was run, as the brief instructs.

## Nog's verdict and review

_None recorded._

## Julian's result

_Julian's stage has not recorded a result for this slice yet._
