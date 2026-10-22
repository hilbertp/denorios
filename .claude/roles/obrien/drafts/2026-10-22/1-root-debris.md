# Three dead files leave the repo root

<!-- Lane: surface (docs/adr/ADR-PROOF-LANES.md). Deletes files no code or test reads; no branch of logic changes. Shakedown slice 1 of 5 for the WSL machine. -->

## What is broken / Goal

The repo root carries three files that were test props or one-off tools and now mislead a newcomer: `hello-watcher.txt`, `ROLLBACK-TEST-MARKER.md` and `recover-branches.sh`. After this lands they are gone and nothing else changes.

## Why (evidence)

- `hello-watcher.txt` (16 bytes, "hello, watcher!") was added by 0c80f6b on 2026-04-09 as a smoke-test file for the first watcher. Nothing references it: `grep -rn hello-watcher --exclude-dir=.git --exclude-dir=node_modules .` finds only the file.
- `ROLLBACK-TEST-MARKER.md` was added by f825eac, reverted by 05d5f14 and reapplied by 4dc0344, all on 2026-06-13, to exercise ADR-ROLLBACK-MODEL once. Its own text says "If this exists on main after the rollback, the revert-forward failed"; it has sat on main for four months. Nothing references it (same grep).
- `recover-branches.sh` (May 2026) merges nine branches named `slice/099-queue-panel` to `slice/106-health-pill-amendment`. None of them exists on origin any more (`git ls-remote --heads origin` lists dev, main, `slice/261`, `265`, `266`, `272`, `296` and `bashir/phase-1-catalog`). Nothing references the script in `docs/`, `scripts/` or `.claude/`.
- The gate buckets all three as INERT (`lib/tests-needed.js` `bucketOf`, lines 25-42: not under `scripts/`, `lib/`, `bridge/*.js`, `dashboard/` or the workflows), so no trailer is needed for the deletion.

## Tasks

1. `git rm hello-watcher.txt ROLLBACK-TEST-MARKER.md recover-branches.sh`.
2. Before committing, run the same grep for each name across the repo (excluding `.git`, `node_modules` and `bridge/queue`); if any live file references one of them, stop and report it under a BLOCKED status instead of deleting.

Write a safety-net test only for a criterion that asserts behaviour; otherwise write none, then stop.

## Traps

1. `bridge/queue/` and `bridge/trash/` records may mention these files as history; that is not a reference to keep them for. Only files outside the queue count.

## What Rom does not do

- Rom writes safety-net tests as the brief's lane says: core lane, one per acceptance criterion plus one per trap; surface lane, only where a criterion asserts behaviour. Then he stops.
- Rom never writes or commits a browser test (a *.spec.js under e2e/). Browser tests are Julian's, written after the slice is on dev.
- Rom never runs the full safety-net suite and never the browser suite. He runs only the test file he wrote. GitHub runs the safety-net suite when the slice lands on dev; the Promote button runs both.
- Rom may look in a browser to check his own work and says what he saw under ## Safety-net tests. He does not prove it with a test.
- Core lane only: before committing, Rom stashes his fix, runs his new test file, confirms every new test goes red, restores the fix, and lists which tests went red under ## Safety-net tests.
- Rom moves his own safety-net tests when his change requires it and lists every move under ## Tests moved or weakened. He never edits a browser test.

## Acceptance criteria

- slice-NNN-ac-1: `hello-watcher.txt`, `ROLLBACK-TEST-MARKER.md` and `recover-branches.sh` do not exist at the repo root on the slice branch, and `git diff --stat dev` shows exactly those three files deleted plus the queue record.
- slice-NNN-ac-2: No file outside `.git/`, `node_modules/`, `bridge/queue/` and `bridge/trash/` contains the string `hello-watcher`, `ROLLBACK-TEST-MARKER` or `recover-branches`.

## Quality + goal check

- Goal check: `ls` at the repo root shows no `.txt` file and no `.sh` file; the README's project-structure block still describes what is there.
- Quality check: nothing else touched; no test written (no criterion asserts behaviour).

## Files expected to change

- `hello-watcher.txt` (deleted)
- `ROLLBACK-TEST-MARKER.md` (deleted)
- `recover-branches.sh` (deleted)

## Custody

No criterion is retired or reworded. No trailer is authorized or needed: all three files are INERT to the gate.

## REQUIRED — declare the ACs as commit trailers

    AC: slice-NNN-ac-1: `hello-watcher.txt`, `ROLLBACK-TEST-MARKER.md` and `recover-branches.sh` do not exist at the repo root on the slice branch, and `git diff --stat dev` shows exactly those three files deleted plus the queue record.
    AC: slice-NNN-ac-2: No file outside `.git/`, `node_modules/`, `bridge/queue/` and `bridge/trash/` contains the string `hello-watcher`, `ROLLBACK-TEST-MARKER` or `recover-branches`.
    Lane: surface
