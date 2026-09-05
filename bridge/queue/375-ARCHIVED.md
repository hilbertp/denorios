---
id: "375"
title: "Fix the fake-work rule so real work stops being filed as fake"
from: rom
to: nog
status: DONE
slice_id: "375"
branch: "slice/375"
completed: "2026-09-03T20:06:27.000Z"
tokens_in: 144000
tokens_out: 15000
elapsed_ms: 898517
estimated_human_hours: 3.0
compaction_occurred: false
---

## Summary

`verifyRomActuallyWorked` now decides whether Rom worked by reading the branch diff. It asks git
`diff --numstat --no-renames <integration>...<branch>` and looks at which paths changed. The commit
count is used for exactly one thing — telling an empty branch from a non-empty one — and the
self-reported `tokens_out` can no longer fail anything.

Three outcomes:

| Branch | Verdict |
|---|---|
| 0 commits ahead of `dev` | `rom_no_commits` (unchanged reason, clearer wording) |
| commits that touch only bookkeeping paths | `rom_no_product_change` (new, distinct reason) |
| anything that changes a file outside those paths | passes, whatever the report claims |

Bookkeeping is the list the brief names: `bridge/queue/*-DONE.md`, `bridge/state/`,
`bridge/heartbeat.json`, `bridge/timesheet*.jsonl`, `bridge/trash/`. Everything else — product code,
tests, docs, config — is substance.

Both git reads fail open. A git hiccup during verification logs a warning and returns `ok: true`;
the one thing this function must never do again is file real work as fake.

Run against `slice/371` as it stands, the new rule passes it (test `slice-375-ac-7`, real git, real
branch, commit untouched).

## What changed

- **`bridge/orchestrator.js`**
  - `verifyRomActuallyWorked(id, branchName, actualDurationMs, actualTokensOut)` — same name, same
    four parameters, same export. The `commitCount === 1 && claimedTokensOut > 1000` gate is gone.
    Zero commits still returns `rom_no_commits`; a non-empty branch is then judged by its diff.
  - New module-local `BOOKKEEPING_PATH_RES` + `isBookkeepingPath()` + `productPathsFromNumstat()`.
    `--no-renames` is load-bearing: with rename detection on, git compacts a pair into
    `bridge/{state => trash}/x.json`, which is not a path any matcher can classify. Binary rows
    (`-`/`-`) count as ordinary changes — only the path matters, never the line counts.
  - New failure reason `rom_no_product_change`, wired through `writeErrorFile` so it gets its own
    sentence instead of falling through to the frontmatter-validation text.
  - The `rom_no_commits` sentence now reads "made no commits … — the branch is level with dev", and
    its detail says "is level with dev — 0 commits ahead" instead of the old "N commit(s) ahead of
    main". The contradiction is structural now, not just textual: the reason cannot be reached with
    a commit on the branch.
  - One `info` log line records what the pass was based on (commit count, product-file count, first
    five paths), so a disputed verdict is auditable from `bridge.log`.
- **`regression/orchestrator/j-rom-work-substance.test.js`** (new) — 10 tests, 7 AC + 3 trap.
- **`regression/COVERAGE.lock`** — regenerated (`node scripts/build-coverage-map.js`), 440 → 447
  guards; the 7 new tags register under both `bridge/orchestrator.js` and the test file.
- **`regression/AC-MANIFEST.lock`** — regenerated (`node scripts/build-ac-manifest.js`) after the
  DONE report was staged, so the 7 tags land as `active` with real `acHash` values rather than
  legacy-backfill nulls.
- **`regression/COVERAGE.md`** — one catalogue row for the new guard under Dispatch & Execution.
- **`test/rom-verification.test.js`**, **`test/orchestrator-rom-verification-no-crash.test.js`** —
  the two callers trap 1 warns about. See `## Tests moved or weakened`.

No `e2e/` file was touched: no browser test, no fixture, no helper.

## Acceptance criteria verification

Command for all of them: `node --test regression/orchestrator/j-rom-work-substance.test.js`
(10/10 pass). Full suite: `node --test 'regression/**/*.test.js'`.

| Tag | Test | Result |
|---|---|---|
| slice-375-ac-1 | `regression/orchestrator/j-rom-work-substance.test.js` — "a branch with zero commits ahead of the integration branch still fails with rom_no_commits" | pass |
| slice-375-ac-2 | same file — "one commit touching a file outside the bookkeeping paths passes, read off the diff not the report" | pass |
| slice-375-ac-3 | same file — "a branch that changes only bookkeeping files fails with rom_no_product_change" | pass |
| slice-375-ac-4 | same file — "a wild self-reported token count cannot fail a slice, and the divergence is warned about" | pass |
| slice-375-ac-5 | same file — "no failure message says there are no commits when the branch has one" | pass |
| slice-375-ac-6 | same file — "verifyRomActuallyWorked keeps its name and its four-parameter signature" | pass |
| slice-375-ac-7 | same file — "the rule passes on the real single-commit branch slice/371" | pass |

Notes on how two of them are proved, since the wording matters:

- **ac-2** — "decided from the diff rather than the report" is proved by running the *same* DONE
  report (8600 claimed `tokens_out`, the exact input that killed 366 and 371) through two different
  numstats and getting opposite verdicts, plus asserting the `git diff --numstat dev...slice/…`
  command was actually issued.
- **ac-4** — the warning half is behavioural, not a source scan: the test records `bridge.log`'s
  size, calls the rule with a claim 2000× the actual, and reads back the appended JSON line to
  assert `level: "warn"` and a `Metrics divergence` message for that slice id.

## Safety-net tests

10 tests in one new file, `regression/orchestrator/j-rom-work-substance.test.js` — one per
acceptance criterion, one per trap. Each carries its tag in the test name, and the AC hashes are
embedded as `// @ac-hash:` annotations so the reconcile gate can match them to the spec.

Fixtures are sandboxed: DONE fixtures and register writes go to a `mkdtemp` directory via
`_testSetDirs` / `_testSetRegisterFile`, so nothing is written into the live `bridge/queue/` the
running watcher polls.

**Break-it-on-purpose (three mutations, because three of the tests are invariants that a revert of
the fix cannot move):**

1. *Fix reverted* (`git checkout HEAD -- bridge/orchestrator.js`, old rule restored) — **7 red**:
   ac-1, ac-2, ac-3, ac-4, ac-5, ac-7, trap 1. Fix restored, all green again.
2. *Function renamed* (`verifyRomActuallyWorked` → `verifyRomWorked` throughout) — **8 red**,
   including the two the first mutation could not move: **ac-6** and **trap 1**. Source restored.
3. *Pinned identities falsified* (in a scratch copy of the test file, never committed: slice/371's
   commit sha and the spec's blob sha replaced with zeros) — **trap 2 and trap 3 red**. This is the
   only honest mutation for those two: their subject is the state of `slice/371`, and altering that
   branch is exactly what trap 2 forbids.

Every one of the 10 has now been watched to fail.

**Suite before commit:** `node --test 'regression/**/*.test.js'` → 406 tests, 402 pass, 0 fail,
4 skipped (pre-existing skips, none of them mine — my file runs all 10 here because `slice/371`
exists locally). `node scripts/ac-reconcile.js` → GREEN, covered 18, stale 0, missing 0.

**A skip that is honest, and that Nog should know about:** `slice/371` was never pushed to origin,
so a clean CI checkout does not have it. ac-7, trap 2 and trap 3 resolve the ref first and call
`t.skip()` with a stated reason when it is absent, rather than passing. Passing would be a lie:
`verifyRomActuallyWorked` returns `ok: true` for a branch that does not exist, so a naive run in CI
would go green while proving nothing. Locally all three execute and pass.

**Browser:** I did not look in a browser. Nothing in this slice renders; the one screen-adjacent
consequence is noted below.

## Screen hooks

None — no criterion touches the screen. This slice changes an orchestrator decision and the sentence
written into an ERROR file.

One observation for O'Brien, deliberately **not** acted on because it is outside the brief and it is
Ziyal's surface: the History panel maps error reasons through `REASON_LABELS` in
`dashboard/lcars-dashboard.html` (~line 6877). Neither `rom_no_commits` (pre-existing) nor the new
`rom_no_product_change` has an entry, so both fall back to `humanReason()`'s raw string and render as
`rom_no_product_change`. It degrades gracefully and hides nothing; it just reads like a machine. Two
lines would fix it if you want it in a later slice.

## Tests moved or weakened

Two files under `test/`, both named by trap 1 as callers of the function. Neither is run by anything
— `ci.yml` excludes `test/` by design and `lib/tests-needed.js` buckets it INERT ("police only what
we run", Philipp's ruling, guarded by `j-unrun-test-dir.test.js`) — so no `Test-Loosen-OK` trailer
applies. Both needed a second signature anyway, which is why they are here.

**Baseline first, so the numbers are not mine to claim:** before I touched anything,
`test/rom-verification.test.js` was **8 passed, 4 failed** (tests A, C, E, F). Those four were
already red because their mock matched `^main --count` while the code has compared against `^dev`
since the topology move; every case silently fell through to "0 commits". It is now **12 passed,
0 failed**.

1. `test/rom-verification.test.js` — `mockRunGit(commitCount)` → `mockRunGit(commitCount, numstat)`.
   The rev-list match is no longer pinned to the literal `^main`, and the mock answers the new
   `diff --numstat` call (defaulting to a two-file product diff). This repairs A, C, E, F.
2. `test/rom-verification.test.js` — **Test B re-aimed, not weakened.** It asserted that one commit
   plus a high self-reported token count is proof of fabrication: the exact rule this slice deletes.
   It now asserts that a commit which only files the DONE report fails with `rom_no_product_change`
   — same shape (a failure with a named reason), pointed at the contract that replaced it. Left in
   place it would have re-enforced the deleted rule the moment someone ports `test/` into
   `regression/`.
3. `test/orchestrator-rom-verification-no-crash.test.js` — same `^main` mock repair; case C now
   mocks **0** commits explicitly and is renamed to "…for an empty branch". Its purpose is the TDZ
   regression guard (a verify failure must not throw `ReferenceError`), and that purpose is
   untouched: it still drives a `rom_no_commits` failure, now on the input that genuinely produces
   one. Previously it produced that failure by accident, through the unmatched mock.

Assertion counts went up, not down, in both files. Nothing was deleted or skipped.

## Conflicts with the brief

None. One note on a judgment call inside task 4: I implemented the bookkeeping list exactly as the
brief names it — no more, no less. That means a hypothetical branch whose only non-bookkeeping change
is a queue file other than a DONE report (say `bridge/queue/375-IN_PROGRESS.md`) would read as
product change. It cannot arise on the current paths (brief renames happen in the main checkout's
working tree, not in Rom's branch), so I did not widen the list on my own authority. If you want
`bridge/queue/` treated as bookkeeping wholesale, that is a one-line change to `BOOKKEEPING_PATH_RES`
and a scope decision for you, not me.

Second note, on the role file: `.claude/roles/rom/ROLE.md` still carries "*Temporary, remove after
Slice 1 lands: until the fake-work rule is fixed, put the DONE report in its own commit.*" That
instruction is now obsolete — the rule reads the whole branch diff, so one commit is fine — but the
role file is not mine to edit, so I left it. I did follow it for this slice, deliberately: the
orchestrator that will verify **this** branch is still running the old rule, and a single commit with
`tokens_out > 1000` is exactly what it kills. Two commits here, both real.

## Commit

Branch `slice/375`, two commits:

- `ce6ecda` — **S375: Decide fake work from the diff, not the commit count**. The fix, the new guard
  file, both `test/` repairs, `COVERAGE.lock`, `COVERAGE.md`. Carries the seven `AC:` trailers.
- (this report) — `bridge/queue/375-DONE.md` + `regression/AC-MANIFEST.lock`, regenerated once the
  report was staged so the AC text has a tracked source.

The frontmatter metrics are my own estimate from this session's budget counter (~159k tokens burned,
split by eye between input and output); the orchestrator's measured numbers are the authoritative
ones, and after this slice a divergence between the two is a log warning rather than a verdict.

## Acceptance criteria

- slice-375-ac-1: a branch with zero commits ahead of the integration branch still fails verification with the existing no-commits reason
- slice-375-ac-2: a branch with one commit that changes at least one file outside the bookkeeping paths passes verification, decided from the diff rather than the report
- slice-375-ac-3: a branch whose commits change only the DONE report fails with a distinct reason naming the absence of a product change
- slice-375-ac-4: the self-reported token count is no longer able to fail a slice, and the claimed-versus-actual divergence still appears as a warning
- slice-375-ac-5: no failure message claims there are no commits when the branch has one
- slice-375-ac-6: the verification function keeps its existing name and signature
- slice-375-ac-7: a test runs the new rule against the existing single-commit branch slice/371 and it passes without that commit being changed
